"""Independently recompute schedule feasibility and reported arithmetic."""

from collections import Counter, defaultdict

from .domain import Factory, Operation, Plan, Weights, eligible, setup, windows

DurationMap = dict[tuple[str, int, str], int]


def material_events(factory: Factory, operations: tuple[Operation, ...]):
    orders = {o.id: o for o in factory.orders}
    products = {p.id: p for p in factory.products}
    for r in factory.receipts:
        yield (r.at, 0, r.material, r.quantity, r.id)
    for op in operations:
        if op.stage == 0 and op.order in orders:
            order = orders[op.order]
            product = products[order.product]
            yield (op.start, 1, product.material, -order.quantity * product.units, order.id)


def totals(
    factory: Factory,
    ops: tuple[Operation, ...],
    weights: Weights,
    previous: tuple[Operation, ...] = (),
):
    completion: dict[str, int] = {}
    for op in ops:
        completion[op.order] = max(completion.get(op.order, 0), op.end)
    tardiness = {
        o.id: max(0, completion[o.id] - o.due) for o in factory.orders if o.id in completion
    }
    old = {o.key: o for o in previous}
    objective = (
        weights.tardiness * sum(o.priority * tardiness.get(o.id, 0) for o in factory.orders)
        + weights.makespan * max(completion.values(), default=0)
        + weights.setup * sum(o.start - o.setup_start for o in ops)
        + sum(
            weights.move * abs(o.start - old[o.key].start)
            + weights.reassign * (o.machine != old[o.key].machine)
            for o in ops
            if o.key in old
        )
    )
    return completion, tardiness, objective


def validate(
    factory: Factory,
    plan: Plan,
    durations: DurationMap,
    frozen: tuple[Operation, ...] = (),
    previous: tuple[Operation, ...] = (),
    earliest: int = 0,
) -> list[dict]:
    violations: list[dict] = []

    def flag(code: str, **details):
        violations.append({"code": code, **details})

    if plan.status not in ("OPTIMAL", "FEASIBLE"):
        flag("NO_SOLUTION", status=plan.status)
    products = {p.id: p for p in factory.products}
    orders = {o.id: o for o in factory.orders}
    machines = {m.id: m for m in factory.machines}
    expected = {(o.id, i) for o in factory.orders for i in range(len(products[o.product].route))}
    counts = Counter(op.key for op in plan.operations)
    for key in sorted(expected | counts.keys()):
        if counts[key] != (1 if key in expected else 0):
            flag("OPERATION_COUNT", operation=key, count=counts[key])
    by_machine: dict[str, list[Operation]] = defaultdict(list)
    by_key = {op.key: op for op in plan.operations}
    frozen_keys = {op.key for op in frozen}
    for op in plan.operations:
        if op.key not in expected or op.machine not in machines:
            flag("REFERENCE", operation=op.key, machine=op.machine)
            continue
        order = orders[op.order]
        product = products[order.product]
        machine = machines[op.machine]
        by_machine[op.machine].append(op)
        if not eligible(machine, product, op.stage, order.quantity):
            flag("ELIGIBILITY", operation=op.key, machine=op.machine)
        if op.end - op.start != durations.get((*op.key, op.machine)) or op.end <= op.start:
            flag("DURATION", operation=op.key)
        if not 0 <= op.setup_start <= op.start < op.end <= factory.horizon:
            flag("HORIZON", operation=op.key, start=op.setup_start, end=op.end)
        if not any(
            a <= op.setup_start and op.end <= b for a, b in windows(machine, factory.horizon)
        ):
            flag("CALENDAR", operation=op.key, machine=op.machine, start=op.setup_start)
        if op.setup_start < order.release or (
            op.key not in frozen_keys and op.setup_start < earliest
        ):
            flag("RELEASE", operation=op.key, start=op.setup_start)
        predecessor = by_key.get((op.order, op.stage - 1))
        if predecessor and predecessor.end > op.setup_start:
            flag("PRECEDENCE", operation=op.key, start=op.setup_start)
        if order.hard_due and op.end > order.due:
            flag("HARD_DUE", operation=op.key, end=op.end)
    for machine_id, activities in by_machine.items():
        last_family = None
        last_end = 0
        for op in sorted(activities, key=lambda row: (row.start, row.order, row.stage)):
            family = products[orders[op.order].product].family
            if op.setup_start < last_end:
                flag("OVERLAP", machine=machine_id, operation=op.key, start=op.setup_start)
            if op.start - op.setup_start != setup(last_family, family):
                flag("SETUP", machine=machine_id, operation=op.key, start=op.setup_start)
            last_end = max(last_end, op.end)
            last_family = family
    stock = factory.inventory.copy()
    for at, _, material, quantity, reference in sorted(material_events(factory, plan.operations)):
        stock[material] += quantity
        if stock[material] < 0:
            flag("MATERIAL", material=material, at=at, reference=reference, balance=stock[material])
    for fixed in frozen:
        if by_key.get(fixed.key) != fixed:
            flag("FROZEN", operation=fixed.key)
    values = totals(factory, plan.operations, plan.weights, previous)
    for field, actual, wanted in zip(
        ("completion", "tardiness", "objective"),
        (plan.completion, plan.tardiness, plan.objective),
        values,
    ):
        if actual != wanted:
            flag("RECONCILIATION", field=field, expected=wanted)
    return violations
