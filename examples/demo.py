"""Replay the operational workflow and save IDs, paired risk, exports and audit evidence."""

import argparse
import json
import os
from pathlib import Path
from time import perf_counter

from forgeworks.contracts import Observation
from forgeworks.copilot import Query, answer
from forgeworks.domain import Operation
from forgeworks.exports import zip_artifacts
from forgeworks.scenarios import MachineEvent
from forgeworks.service import Service
from forgeworks.simulation import SimulationConfig


def demo(out: Path, runs: int, seconds: float):
    out.mkdir(parents=True, exist_ok=True)
    start = perf_counter()
    token = os.environ["FORGEWORKS_PLANNER_TOKEN"]
    service = Service(f"sqlite:///{(out / 'demo.db').resolve()}", out / "models")
    measurements = []
    dataset = service.generate("normal", count=40)["dataset"]
    model = service.train(dataset=dataset)
    if model["eligible_for_promotion"]:
        service.promote(model["id"])
    sim_config = SimulationConfig(runs=runs, seed=577, trace=False)
    for count in (200, 40, 12, 6):
        generated = service.generate("normal", count=count)
        dataset = generated["dataset"]
        candidate = service.optimize(dataset, seconds=seconds)
        status = candidate["payload"]["plan"]["status"]
        measurements.append(
            {
                "orders": count,
                "schedule": candidate["id"],
                "status": status,
                "detail": candidate["payload"]["plan"]["detail"],
                "nominal_seconds": candidate["payload"]["plan"]["seconds"],
            }
        )
        if service.validate(candidate["id"]):
            continue
        ops = sorted(
            (Operation.model_validate(op) for op in candidate["payload"]["plan"]["operations"]),
            key=lambda op: (op.setup_start, op.machine),
        )
        when = ops[0].setup_start + 1
        busy = {op.machine for op in ops if op.setup_start < when < op.end}
        soon = [op for op in ops if op.machine not in busy and when <= op.setup_start < when + 240]
        if not soon:
            continue
        breakdown = MachineEvent(
            kind="breakdown", machine=soon[0].machine, start=when, end=when + 240
        )
        overtime = MachineEvent(kind="overtime", machine="M-02", start=7200, end=7680)
        variant = service.alternative(candidate["id"], overtime, seconds)
        measurements[-1]["what_if"] = {"status": variant["status"], "schedule": variant["schedule"]}
        if not variant["valid"]:
            continue
        service.transition(candidate["id"], "approve", "demo-planner", token)
        service.transition(candidate["id"], "release", "demo-planner", token)
        revised = service.alternative(
            candidate["id"], breakdown, seconds, at=when, freeze_until=when
        )
        measurements[-1]["replan"] = {"status": revised["status"], "schedule": revised["schedule"]}
        if not revised["valid"]:
            continue
        break
    else:
        raise RuntimeError(f"No scenario completed: {measurements}")
    key = candidate["id"]
    simulation_started = perf_counter()
    original_risk = service.simulate(key, sim_config)
    shift_risk = service.simulate(variant["schedule"], sim_config)
    trace = service.simulate(revised["schedule"], SimulationConfig(runs=1, seed=577, trace=True))
    replan_risk = service.simulate(revised["schedule"], sim_config)
    simulation_seconds = perf_counter() - simulation_started
    order_id = max(original_risk["risk"], key=lambda r: r["p_late"])["order"]
    explanation = answer(service, Query(schedule=key, tool="explain_order_delay", order=order_id))
    risk_evidence = answer(service, Query(schedule=key, tool="get_simulation_risk"))
    approval = service.transition(
        revised["schedule"], "approve", "demo-planner", token, replan_risk["id"]
    )
    release = service.transition(revised["schedule"], "release", "demo-planner", token)
    active = {
        (r["order"], r["stage"]): r["active_minutes"]
        for r in trace["replications"][0]["processing"]
    }
    observations = [
        Observation(
            id=f"{trace['id']}-{i}",
            order=row["order"],
            stage=row["stage"],
            machine=row["machine"],
            duration=active[row["order"], row["stage"]],
            at=row["end"],
            shift=int(row["start"] % 1440 >= 510),
            source="simulated",
        )
        for i, row in enumerate(trace["replications"][0]["operations"])
    ]
    feedback = service.record_execution(
        service.schedule(revised["schedule"])["dataset"], observations
    )
    from forgeworks.simulation import interval

    comparisons = {}
    for name, result in (("shift", shift_risk), ("reschedule", replan_risk)):
        comparisons[name] = {
            m: interval(
                [b[m] - a[m] for a, b in zip(original_risk["replications"], result["replications"])]
            )
            for m in ("weighted_tardiness", "on_time", "cost")
        }
    for label, run in (
        ("original", key),
        ("extra-shift", variant["schedule"]),
        ("rescheduled", revised["schedule"]),
    ):
        (out / f"{label}.zip").write_bytes(zip_artifacts(service, run))
    report = {
        "orders": count,
        "machines": generated["machines"],
        "products": generated["products"],
        "dataset": dataset,
        "model": model["id"],
        "history_rows": sum(model["split_sizes"]),
        "model_eligible": model["eligible_for_promotion"],
        "sizing_attempts": measurements,
        "elapsed_seconds": perf_counter() - start,
        "simulation_seconds": simulation_seconds,
        "replications_per_alternative": runs,
        "seed": sim_config.seed,
        "original": key,
        "extra_shift": variant,
        "rescheduled": revised,
        "approval": approval,
        "release": release,
        "explanation": explanation,
        "risk_evidence": risk_evidence,
        "simulations": {
            name: {"id": result["id"], "summary": result["summary"]}
            for name, result in (
                ("original", original_risk),
                ("shift", shift_risk),
                ("replan", replan_risk),
            )
        },
        "comparisons": comparisons,
        "feedback": feedback,
    }
    (out / "demo-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {k: report[k] for k in ("orders", "original", "elapsed_seconds", "sizing_attempts")},
            indent=2,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("demo-output"))
    parser.add_argument("--runs", type=int, default=300)
    parser.add_argument("--seconds", type=float, default=8)
    args = parser.parse_args()
    if not 10 <= args.runs <= 500 or not 0 < args.seconds <= 45:
        parser.error("Use 10 to 500 runs and a positive time limit of at most 45 seconds")
    demo(args.output, args.runs, args.seconds)
