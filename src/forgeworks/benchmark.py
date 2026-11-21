"""Reproducible predictive, scheduling, robustness and integrated experiments."""

from time import perf_counter
from typing import Any

from .generation import generate, history
from .ml import predictions, train
from .optimization import Method, optimize, standard
from .simulation import SimulationConfig, interval, simulate
from .validation import DurationMap, validate


def benchmark(count=6, runs=30, seconds=4.0, seed=42, scenario="tight", scale=False):
    from .domain import Weights
    from .service import uid

    began = perf_counter()
    factory = generate(scenario, seed, count)
    bundle, ml = train(history(generate("normal", seed)), seed)
    erp = standard(factory)
    predicted = predictions(factory, bundle)
    learned = {(r["order"], r["stage"], r["machine"]): r["minutes"] for r in predicted}
    buffered = {
        (r["order"], r["stage"], r["machine"]): r["minutes"]
        for r in predictions(factory, bundle, 0.5)
    }
    nominal, robustness, held_out = {}, {}, {}
    tuning = SimulationConfig(runs=runs, seed=seed + 1)
    testing = SimulationConfig(runs=runs, seed=seed + 2)
    variants: dict[str, tuple[Method, DurationMap]] = {
        "FCFS": ("FCFS", erp),
        "EDD": ("EDD", erp),
        "SPT": ("SPT", erp),
        "CP-SAT": ("CP-SAT", erp),
        "ML CP-SAT": ("CP-SAT", learned),
        "ML buffered CP-SAT": ("CP-SAT", buffered),
    }
    valid = {}
    priorities = {o.id: o.priority for o in factory.orders}
    for name, (method, durations) in variants.items():
        plan = optimize(factory, durations, method, seconds=seconds, weights=Weights())
        problems = validate(factory, plan, durations)
        nominal[name] = {
            "status": plan.status,
            "seconds": plan.seconds,
            "gap": plan.gap,
            "objective": plan.objective,
            "valid": not problems,
            "validation": problems,
        }
        if problems:
            continue
        valid[name] = plan
        nominal[name].update(
            weighted_tardiness=sum(priorities[o] * t for o, t in plan.tardiness.items()),
            makespan=max(plan.completion.values(), default=0),
            setup_minutes=sum(o.start - o.setup_start for o in plan.operations),
            on_time=sum(t == 0 for t in plan.tardiness.values()) / max(1, count),
        )
    candidates = ("ML CP-SAT", "ML buffered CP-SAT")
    selection = {}
    for name in candidates:
        if name in valid:
            simulation = simulate(factory, valid[name], tuning)
            selection[name] = simulation["summary"]["weighted_tardiness"]["mean"]
    selected = min(selection, key=selection.__getitem__) if selection else None
    for name, plan in valid.items():
        start = perf_counter()
        simulation = simulate(factory, plan, testing)
        held_out[name] = simulation["replications"]
        robustness[name] = {
            "metrics": simulation["summary"],
            "p95_weighted_tardiness": simulation["p95_weighted_tardiness"],
            "simulation_seconds": perf_counter() - start,
        }
    approaches = {"A": "EDD", "B": "CP-SAT", "C": "ML CP-SAT", "D": selected}
    integrated = {}
    for label, approach in approaches.items():
        result: dict[str, Any] = {"plan": approach, "valid": approach in robustness}
        if approach is not None and approach in robustness:
            result.update(robustness[approach])
            result["planning_seconds"] = nominal[approach]["seconds"]
            if "EDD" in held_out:
                result["paired_delta_vs_A"] = {
                    metric: interval(
                        [
                            new[metric] - base[metric]
                            for new, base in zip(held_out[approach], held_out["EDD"])
                        ]
                    )
                    for metric in ("weighted_tardiness", "on_time", "cost", "disrupted_fraction")
                }
        integrated[label] = result
    scales = []
    if scale:
        for size in (6, 40, 200):
            instance = generate("normal", seed, size)
            durations = standard(instance)
            methods: tuple[Method, ...] = ("EDD", "CP-SAT")
            for method in methods:
                plan = optimize(instance, durations, method, seconds=seconds)
                scales.append(
                    {
                        "orders": size,
                        "method": method,
                        "status": plan.status,
                        "detail": plan.detail,
                        "seconds": plan.seconds,
                        "gap": plan.gap,
                        "valid": not validate(instance, plan, durations),
                    }
                )
    return {
        "id": uid(),
        "factory": factory.version,
        "orders": count,
        "scenario": scenario,
        "seed": seed,
        "machines": len(factory.machines),
        "products": len(factory.products),
        "history_rows": sum(ml["split_sizes"]),
        "seconds": perf_counter() - began,
        "ml": ml,
        "scheduling": nominal,
        "robustness": robustness,
        "integrated": integrated,
        "selection_scores": selection,
        "tuning": tuning.model_dump(),
        "held_out": testing.model_dump(),
        "scale": scales,
    }
