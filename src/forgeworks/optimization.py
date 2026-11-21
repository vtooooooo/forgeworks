"""CP-SAT flexible job shop and calendar-aware dispatch baselines."""

from collections import defaultdict
from itertools import pairwise
from math import ceil
from time import perf_counter
from typing import Literal

from ortools.sat.python import cp_model

from .domain import (
    DEFAULT_WEIGHTS,
    Factory,
    Operation,
    Plan,
    Weights,
    eligible,
    erp,
    setup,
    windows,
)
from .validation import DurationMap, material_events, totals, validate

Method = Literal["FCFS", "EDD", "SPT", "CP-SAT"]


def standard(factory: Factory) -> DurationMap:
    products = {p.id: p for p in factory.products}
    return {
        (o.id, i, m.id): ceil(erp(products[o.product], i, o.quantity))
        for o in factory.orders
        for i in range(len(products[o.product].route))
        for m in factory.machines
        if eligible(m, products[o.product], i, o.quantity)
    }


def optimize(
    factory: Factory,
    durations: DurationMap,
    method: Method = "CP-SAT",
    seconds: float = 5,
    weights: Weights = DEFAULT_WEIGHTS,
    frozen: tuple[Operation, ...] = (),
    previous: tuple[Operation, ...] = (),
    earliest: int = 0,
) -> Plan:
    started = perf_counter()
    products = {p.id: p for p in factory.products}
    orders = {o.id: o for o in factory.orders}
    machines = {m.id: m for m in factory.machines}
    keys = [(o.id, i) for o in factory.orders for i in range(len(products[o.product].route))]
    calendars = {m.id: list(windows(m, factory.horizon)) for m in machines.values()}

    def failure(status, detail):
        return Plan(
            method=method,
            status=status,
            detail=detail,
            weights=weights,
            seconds=perf_counter() - started,
            limit_seconds=seconds,
            solver_seed=0,
        )

    def result(operations, status, bound=None):
        completion, tardiness, objective = totals(factory, operations, weights, previous)
        return Plan(
            method=method,
            status=status,
            operations=operations,
            completion=completion,
            tardiness=tardiness,
            objective=objective,
            bound=bound,
            gap=None if bound is None else max(0.0, objective - bound) / max(1, objective),
            seconds=perf_counter() - started,
            weights=weights,
            limit_seconds=seconds,
            solver_seed=0,
        )

    if not keys:
        return result(
            (), "OPTIMAL" if method == "CP-SAT" else "FEASIBLE", 0.0 if method == "CP-SAT" else None
        )
    candidates = defaultdict(list)
    for (order_id, stage, machine_id), duration in durations.items():
        if (
            duration > 0
            and eligible(
                machines[machine_id],
                products[orders[order_id].product],
                stage,
                orders[order_id].quantity,
            )
            and any(end - start >= duration for start, end in calendars[machine_id])
        ):
            candidates[order_id, stage].append((machine_id, duration))
    for key in keys:
        if not candidates[key]:
            return failure("INFEASIBLE", f"No eligible machine with a continuous window for {key}")
    families = {o.id: products[o.product].family for o in factory.orders}
    if method != "CP-SAT":
        sequence = sorted(
            factory.orders,
            key=lambda o: {
                "FCFS": (o.release, o.id),
                "EDD": (o.due, o.id),
                "SPT": (
                    sum(
                        min(d for _, d in candidates[o.id, i])
                        for i in range(len(products[o.product].route))
                    ),
                    o.id,
                ),
            }[method],
        )
        booked = list(frozen)
        frozen_index = {op.key: op for op in frozen}
        tail = {op.machine: op for op in sorted(frozen, key=lambda op: op.end)}
        for o in sequence:
            ready = o.release
            for stage in range(len(products[o.product].route)):
                fixed_op = frozen_index.get((o.id, stage))
                if fixed_op is not None:
                    ready = fixed_op.end
                    continue
                options = []
                for mid, duration in candidates[o.id, stage]:
                    last = tail.get(mid)
                    change = setup(families[last.order] if last else None, families[o.id])
                    for a, b in calendars[mid]:
                        first = max(a, ready, earliest, last.end if last else 0)
                        if stage == 0:
                            # Inventory can become feasible at a receipt; also check booked future draws.
                            times = sorted(
                                {first, *(max(first, r.at - change) for r in factory.receipts)}
                            )
                        else:
                            times = [first]
                        for at in times:
                            op = Operation(
                                order=o.id,
                                stage=stage,
                                machine=mid,
                                setup_start=at,
                                start=at + change,
                                end=at + change + duration,
                            )
                            if op.end > min(b, o.due if o.hard_due else b):
                                break
                            if stage == 0:
                                stock = factory.inventory.copy()
                                for _, _, material, delta, _ in sorted(
                                    material_events(factory, (*booked, op))
                                ):
                                    stock[material] += delta
                                    if stock[material] < 0:
                                        break
                                else:
                                    options.append(op)
                                    break
                            else:
                                options.append(op)
                                break
                if not options:
                    return failure(
                        "NO_FEASIBLE_DISPATCH", f"Dispatch could not place {(o.id, stage)}"
                    )
                choice = min(options, key=lambda op: (op.end, op.start, op.machine))
                booked.append(choice)
                tail[choice.machine] = choice
                ready = choice.end
        return result(tuple(booked), "FEASIBLE")

    per_machine: dict[str, int] = defaultdict(int)
    for choices in candidates.values():
        for mid, _ in choices:
            per_machine[mid] += 1
    if sum(count * count for count in per_machine.values()) > 180_000:
        return failure("UNKNOWN", "Circuit construction budget exceeded before search")

    hint = previous
    complete_hint = False
    if len(keys) <= 200:
        baseline = optimize(
            factory,
            durations,
            "EDD",
            weights=weights,
            frozen=frozen,
            previous=previous,
            earliest=earliest,
        )
        if not validate(factory, baseline, durations, frozen, previous, earliest):
            hint = baseline.operations
            complete_hint = True
    hinted = {op.key: op for op in hint}
    machine_hint: dict[str, list[Operation]] = defaultdict(list)
    for op in hint:
        machine_hint[op.machine].append(op)
    model = cp_model.CpModel()
    horizon = factory.horizon
    starts, ends, preparations = {}, {}, {}
    resources = defaultdict(list)
    assigned = {}
    intervals = defaultdict(list)
    fixed = {op.key: op for op in frozen}
    old = {op.key: op for op in previous}
    stability: list[cp_model.LinearExpr | int] = []
    for key in keys:
        oid, stage = key
        label = f"{oid}/{stage}"
        start = starts[key] = model.new_int_var(0, horizon, f"start/{label}")
        end = ends[key] = model.new_int_var(0, horizon, f"end/{label}")
        prep = preparations[key] = model.new_int_var(0, horizon, f"setup/{label}")
        model.add(prep <= start)
        model.add(prep >= max(orders[oid].release, 0 if key in fixed else earliest))
        if stage:
            model.add(prep >= ends[oid, stage - 1])
        if orders[oid].hard_due:
            model.add(end <= orders[oid].due)
        assignment_choices: list[cp_model.IntVar] = []
        for mid, duration in candidates[key]:
            lit = assigned[key, mid] = model.new_bool_var(f"on/{label}/{mid}")
            model.add(end == start + duration).only_enforce_if(lit)
            length = model.new_int_var(1, horizon, f"length/{label}/{mid}")
            intervals[mid].append(
                model.new_optional_interval_var(prep, length, end, lit, f"work/{label}/{mid}")
            )
            if complete_hint:
                op = hinted[key]
                model.add_hint(length, op.end - op.setup_start if op.machine == mid else duration)
            resources[mid].append((key, lit))
            assignment_choices.append(lit)
        model.add_exactly_one(assignment_choices)
        if key in fixed:
            op = fixed[key]
            if (key, op.machine) not in assigned:
                return failure("INFEASIBLE", f"Frozen assignment unavailable for {key}")
            model.add(assigned[key, op.machine] == 1)
            model.add(start == op.start)
            model.add(end == op.end)
            model.add(prep == op.setup_start)
        if key in old:
            shift = model.new_int_var(0, horizon, f"move/{label}")
            model.add_abs_equality(shift, start - old[key].start)
            if complete_hint:
                model.add_hint(shift, abs(hinted[key].start - old[key].start))
            stability.extend(
                (
                    weights.move * shift,
                    weights.reassign * (1 - assigned.get((key, old[key].machine), 0)),
                )
            )
    for mid, nodes in resources.items():
        calendar_tail = 0
        for a, b in [*calendars[mid], (horizon, horizon)]:
            if calendar_tail < a:
                intervals[mid].append(
                    model.new_fixed_size_interval_var(
                        calendar_tail, a - calendar_tail, f"off/{mid}/{calendar_tail}"
                    )
                )
            calendar_tail = b
        model.add_no_overlap(intervals[mid])
        unused = model.new_bool_var(f"unused/{mid}")
        arcs: list[tuple[int, int, cp_model.LiteralT]] = [(0, 0, unused)]
        indexes = {key: i for i, (key, _) in enumerate(nodes, 1)}
        ordered = [
            indexes[op.key]
            for op in sorted(machine_hint[mid], key=lambda op: op.start)
            if op.key in indexes
        ]
        path = [0, *ordered, 0]
        selected_arcs = set(pairwise(path))
        if complete_hint:
            model.add_hint(unused, int(not ordered))
        model.add(sum(lit for _, lit in nodes) == 0).only_enforce_if(unused)
        for i, (key, lit) in enumerate(nodes, 1):
            initial = model.new_bool_var(f"first/{mid}/{i}")
            final = model.new_bool_var(f"last/{mid}/{i}")
            arcs.extend(((i, i, ~lit), (0, i, initial), (i, 0, final)))
            if complete_hint:
                model.add_hint(initial, int((0, i) in selected_arcs))
                model.add_hint(final, int((i, 0) in selected_arcs))
            model.add(
                starts[key] - preparations[key] == setup(None, families[key[0]])
            ).only_enforce_if(initial)
            for j, (following, _) in enumerate(nodes, 1):
                if i == j or (key[0] == following[0] and key[1] > following[1]):
                    continue
                arc = model.new_bool_var(f"next/{mid}/{i}/{j}")
                arcs.append((i, j, arc))
                if complete_hint:
                    model.add_hint(arc, int((i, j) in selected_arcs))
                model.add(preparations[following] >= ends[key]).only_enforce_if(arc)
                model.add(
                    starts[following] - preparations[following]
                    == setup(families[key[0]], families[following[0]])
                ).only_enforce_if(arc)
        model.add_circuit(arcs)
    for material, inventory in factory.inventory.items():
        times = [0]
        changes = [inventory]
        for receipt in factory.receipts:
            if receipt.material == material:
                times.append(2 * receipt.at)
                changes.append(receipt.quantity)
        for order in factory.orders:
            product = products[order.product]
            if product.material == material:
                times.append(2 * starts[order.id, 0] + 1)
                changes.append(-order.quantity * product.units)
        model.add_reservoir_constraint(times, changes, 0, sum(max(0, q) for q in changes))
    delays = []
    for order in factory.orders:
        end = ends[order.id, len(products[order.product].route) - 1]
        late = model.new_int_var(0, horizon, f"late/{order.id}")
        model.add_max_equality(late, [0, end - order.due])
        delays.append(order.priority * late)
        if complete_hint:
            model.add_hint(
                late,
                max(0, hinted[order.id, len(products[order.product].route) - 1].end - order.due),
            )
    makespan = model.new_int_var(0, horizon, "makespan")
    model.add_max_equality(makespan, list(ends.values()))
    model.minimize(
        weights.tardiness * sum(delays)
        + weights.makespan * makespan
        + weights.setup * sum(starts[k] - preparations[k] for k in keys)
        + sum(stability)
    )
    if complete_hint:
        model.add_hint(makespan, max(op.end for op in hint))
    for op in hint:
        key = op.key
        if key in starts:
            model.add_hint(starts[key], op.start)
            model.add_hint(ends[key], op.end)
            model.add_hint(preparations[key], op.setup_start)
            for mid, _ in candidates[key]:
                model.add_hint(assigned[key, mid], int(mid == op.machine))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = seconds
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0
    if complete_hint and len(keys) > 100:
        # Large circuits spend most of a short budget in presolve before checking a hint.
        solver.parameters.cp_model_presolve = False
        solver.parameters.linearization_level = 0
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return failure(solver.status_name(status), solver.solution_info())
    operations = tuple(
        Operation(
            order=key[0],
            stage=key[1],
            machine=mid,
            setup_start=solver.value(preparations[key]),
            start=solver.value(starts[key]),
            end=solver.value(ends[key]),
        )
        for (key, mid), lit in assigned.items()
        if solver.boolean_value(lit)
    )
    return result(operations, solver.status_name(status), solver.best_objective_bound)
