"""Discrete-event replay with fixed machine queues and time-phased stock reservations."""

from bisect import insort
from collections import defaultdict
from hashlib import sha256
from math import ceil, sqrt
from random import Random
from statistics import mean, stdev

import simpy
from pydantic import Field

from .domain import Factory, Operation, Plan, Record, Window, windows
from .generation import actual


class SimulationConfig(Record):
    runs: int = Field(default=300, ge=1, le=500)
    seed: int = 42
    uncertain: bool = True
    breakdown_probability: float = Field(default=0.24, ge=0, le=1)
    receipt_delay_probability: float = Field(default=0.30, ge=0, le=1)
    trace: bool = False


def stream(seed: int, replication: int, *key) -> Random:
    return Random(int.from_bytes(sha256(repr((seed, replication, key)).encode()).digest(), "big"))


def processing_segments(at: int, duration: int, available: list[tuple[int, int]]):
    """A breakdown can pause processing; the job holds its machine through recovery."""
    remaining = duration
    segments: list[tuple[int, int]] = []
    for first, last in available:
        if not segments and not first <= at < last:
            continue
        start = max(at, first)
        used = min(remaining, last - start)
        segments.append((start, start + used))
        remaining -= used
        if not remaining:
            return segments
    return []


def replay(
    factory: Factory,
    plan: Plan,
    config: SimulationConfig,
    replication: int,
    extra_minutes: dict[tuple[str, int], int] | None = None,
):
    env = simpy.Environment()
    orders = {o.id: o for o in factory.orders}
    products = {p.id: p for p in factory.products}
    queues: dict[str, list[Operation]] = defaultdict(list)
    for op in sorted(plan.operations, key=lambda op: (op.setup_start, op.start)):
        queues[op.machine].append(op)
    receipts: dict[str, list[tuple[int, int]]] = defaultdict(list)
    outage_events = {}
    for r in factory.receipts:
        rng = stream(config.seed, replication, "receipt", r.id)
        delay = (
            rng.randint(30, 720)
            if config.uncertain and rng.random() < config.receipt_delay_probability
            else 0
        )
        receipts[r.material].append((r.at + delay, r.quantity))
    horizon = factory.horizon
    calendars = {}
    recovery_calendars = {}
    outage_minutes = 0
    for machine in factory.machines:
        rng = stream(config.seed, replication, "outage", machine.id)
        outages = factory.outages.get(machine.id, ()) if config.uncertain else ()
        if config.uncertain and rng.random() < config.breakdown_probability:
            at = rng.randrange(max(1, min(horizon, 4000)))
            outages = (*outages, Window(start=at, end=at + rng.randint(30, 240)))
        outage_minutes += sum(x.end - x.start for x in outages)
        if config.trace:
            outage_events[machine.id] = [x.model_dump() for x in outages]
        # Repeat weekday-pattern capacity beyond the nominal horizon for recovery.
        last_week = 10080
        weeks = max(1, ceil(horizon / last_week))
        recurring = {(w.start % last_week, w.end - w.start) for w in machine.shifts}
        extension = tuple(
            Window(start=i * last_week + a, end=i * last_week + a + length)
            for i in range(weeks, weeks + 4)
            for a, length in sorted(recurring)
        )
        extended = machine.model_copy(update={"shifts": machine.shifts + extension})
        calendars[machine.id] = list(windows(extended, (weeks + 4) * last_week))
        recovery_calendars[machine.id] = (
            list(windows(extended, (weeks + 4) * last_week, outages))
            if outages
            else calendars[machine.id]
        )
    done: dict[tuple[str, int], int] = {}
    machine_free: dict[str, int] = defaultdict(int)
    stock_events = {
        material: sorted((at, 0, quantity) for at, quantity in receipts[material])
        for material in factory.inventory
    }
    duration_cache: dict[tuple[tuple[str, int], int], int] = {}

    def can_reserve(material: str, start: int, consumption: int) -> bool:
        balance = factory.inventory[material]
        for at, kind, quantity in stock_events[material]:
            if (at, kind) >= (start, 1) and balance < consumption:
                return False
            balance += quantity
        return balance >= consumption

    executed = []
    activity = []
    cost = 0.0
    for_machine = {m.id: m for m in factory.machines}

    def dispatcher():
        nonlocal cost
        while any(queues.values()):
            options = []
            for mid, queue in queues.items():
                if not queue:
                    continue
                op = queue[0]
                prev = (op.order, op.stage - 1)
                if op.stage and prev not in done:
                    continue
                order = orders[op.order]
                product = products[order.product]
                prep = op.start - op.setup_start
                ready = max(
                    int(env.now),
                    op.setup_start,
                    order.release,
                    done.get(prev, 0),
                    machine_free[mid],
                )
                for a, b in calendars[mid]:
                    first = max(a, ready)
                    arrivals = receipts[product.material]
                    recovery = recovery_calendars[mid]
                    restarts = {start for start, _ in recovery if first < start < b}
                    candidates = {first, *restarts}
                    if not op.stage:
                        candidates.update(max(first, at - prep) for at, _ in arrivals)
                    times = sorted(candidates)
                    for at in times:
                        if at >= b:
                            break
                        shift = int((at + prep) % 1440 >= 510)
                        if not config.uncertain:
                            duration = op.end - op.start
                        else:
                            cache_key = (op.key, shift)
                            if cache_key not in duration_cache:
                                rng = stream(config.seed, replication, "duration", *op.key)
                                sampled = ceil(
                                    actual(
                                        product,
                                        op.stage,
                                        order.quantity,
                                        for_machine[mid],
                                        shift,
                                        factory.variability,
                                        rng,
                                    )
                                )
                                if rng.random() < 0.04:
                                    sampled += ceil(sampled * 0.25)
                                duration_cache[cache_key] = sampled + (
                                    extra_minutes.get(op.key, 0) if extra_minutes else 0
                                )
                            duration = duration_cache[cache_key]
                        start = at + prep
                        if start + duration > b:
                            continue
                        if not any(a <= at and start < b for a, b in recovery):
                            continue
                        segments = processing_segments(start, duration, recovery)
                        if not segments:
                            continue
                        end = segments[-1][1]
                        if op.stage or can_reserve(
                            product.material, start, order.quantity * product.units
                        ):
                            options.append((at, start, end, mid, op, segments))
                            break
                    else:
                        continue
                    if options and options[-1][3] == mid:
                        break
            if not options:
                break
            at, start, end, mid, op, segments = min(options, key=lambda x: x[:4])
            if at > env.now:
                yield env.timeout(at - env.now)
            queues[mid].pop(0)
            machine_free[mid] = end
            done[op.key] = end
            if not op.stage:
                order = orders[op.order]
                product = products[order.product]
                insort(stock_events[product.material], (start, 1, -order.quantity * product.units))
            executed.append(op.model_copy(update={"setup_start": at, "start": start, "end": end}))
            active_minutes = sum(b - a for a, b in segments)
            if config.trace:
                activity.append(
                    {
                        "order": op.order,
                        "stage": op.stage,
                        "machine": mid,
                        "active_minutes": active_minutes,
                        "segments": segments,
                    }
                )
            cost += (active_minutes + start - at) * for_machine[mid].cost_per_hour / 60

    env.process(dispatcher())
    env.run()
    observed = {
        oid: done[oid, len(products[o.product].route) - 1]
        for oid, o in orders.items()
        if (oid, len(products[o.product].route) - 1) in done
    }
    censor = (weeks + 4) * 10080
    completed = {oid: observed.get(oid, censor) for oid in orders}
    lateness = {oid: max(0, at - orders[oid].due) for oid, at in completed.items()}
    plan_starts = {op.key: op.setup_start for op in plan.operations}
    slippage = [op.setup_start - plan_starts[op.key] for op in executed]
    return {
        "replication": replication,
        "completion": observed,
        "incomplete": len(orders) - len(observed),
        "weighted_tardiness": sum(lateness[k] * o.priority for k, o in orders.items()),
        "makespan": max(completed.values(), default=0),
        "on_time": sum(oid in observed and observed[oid] <= o.due for oid, o in orders.items())
        / max(1, len(orders)),
        "critical_late": any(
            o.priority >= 5 and (oid not in observed or lateness[oid] > 0)
            for oid, o in orders.items()
        ),
        "queue_delay": mean(slippage) if slippage else 0.0,
        "disrupted_fraction": sum(x > 0 for x in slippage) / max(1, len(plan.operations)),
        "outage_minutes": outage_minutes,
        "cost": cost,
        **(
            {
                "operations": [op.model_dump() for op in executed],
                "processing": activity,
                "receipt_arrivals": dict(receipts),
                "outages": outage_events,
            }
            if config.trace
            else {}
        ),
    }


def interval(values: list[float], bounded: bool = False):
    average = mean(values)
    if len(values) < 2:
        return {"mean": average, "ci95": None}
    radius = 1.96 * stdev(values) / sqrt(len(values))
    return {
        "mean": average,
        "ci95": [max(0.0, average - radius), min(1.0, average + radius)]
        if bounded
        else [average - radius, average + radius],
    }


def quantile(values, fraction):
    return sorted(values)[max(0, ceil(len(values) * fraction) - 1)]


def simulate(
    factory: Factory,
    plan: Plan,
    config: SimulationConfig,
    extra_minutes: dict[tuple[str, int], int] | None = None,
):
    rows = [replay(factory, plan, config, i, extra_minutes) for i in range(config.runs)]
    metrics = {
        key: interval(
            [float(row[key]) for row in rows],
            key in ("on_time", "critical_late", "disrupted_fraction"),
        )
        for key in (
            "on_time",
            "critical_late",
            "weighted_tardiness",
            "makespan",
            "queue_delay",
            "disrupted_fraction",
            "outage_minutes",
            "cost",
            "incomplete",
        )
    }
    risk = []
    for o in factory.orders:
        times = [r["completion"][o.id] for r in rows if o.id in r["completion"]]
        late = config.runs - sum(t <= o.due for t in times)
        # Wilson interval for an individual order's binary lateness event.
        n, z = config.runs, 1.96
        p = late / n
        center = (p + z * z / (2 * n)) / (1 + z * z / n)
        width = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
        risk.append(
            {
                "order": o.id,
                "p_late": p,
                "ci95": [max(0, center - width), min(1, center + width)],
                "p50_completion": quantile(times, 0.5) if times else None,
                "p95_completion": quantile(times, 0.95) if times else None,
                "completed_runs": len(times),
            }
        )
    return {
        "config": config.model_dump(),
        "summary": metrics,
        "risk": risk,
        "p95_weighted_tardiness": quantile([r["weighted_tardiness"] for r in rows], 0.95),
        "replications": rows,
    }
