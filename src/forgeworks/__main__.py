"""ForgeWorks command line entry point."""

import argparse
import json
import os
from pathlib import Path

from . import database as db
from .benchmark import benchmark
from .contracts import (
    BenchmarkRequest,
    DatasetRequest,
    ExecutionRequest,
    OptimizeRequest,
    TrainRequest,
)
from .copilot import Query, answer
from .exports import artifacts, zip_artifacts
from .scenarios import change_adapter
from .service import Service
from .simulation import SimulationConfig


def parser():
    root = argparse.ArgumentParser(prog="python -m forgeworks")
    actions = root.add_subparsers(dest="action", required=True)
    gen = actions.add_parser("generate")
    gen.add_argument("--scenario", default="normal")
    gen.add_argument("--seed", type=int, default=42)
    gen.add_argument("--count", type=int, default=12)
    train = actions.add_parser("train")
    train.add_argument("--dataset")
    train.add_argument("--count", type=int, default=2400)
    train.add_argument("--seed", type=int, default=42)
    promote = actions.add_parser("promote")
    promote.add_argument("--model")
    promote.add_argument("--rollback", action="store_true")
    predict = actions.add_parser("predict")
    predict.add_argument("--order-id", dest="order")
    predict.add_argument("--dataset")
    predict.add_argument("--model")
    opt = actions.add_parser("optimize")
    opt.add_argument("--scenario")
    opt.add_argument("--dataset")
    opt.add_argument("--model")
    opt.add_argument("--method", default="CP-SAT")
    opt.add_argument("--seconds", type=float, default=5.0)
    opt.add_argument("--buffer", type=float, default=0.0)
    opt.add_argument("--assignment-scope", choices=("full", "dispatch"), default="full")
    for name in (
        "get",
        "validate",
        "simulate",
        "explain",
        "what-if",
        "reschedule",
        "approve",
        "release",
        "reject",
        "export",
        "risk",
    ):
        cmd = actions.add_parser(name)
        cmd.add_argument("--schedule-id", required=True)
        if name in ("simulate", "what-if", "reschedule"):
            cmd.add_argument("--runs", type=int, default=300 if name == "simulate" else None)
            cmd.add_argument("--seed", type=int, default=42)
            cmd.add_argument("--zero-uncertainty", action="store_true")
        if name in ("what-if", "reschedule"):
            cmd.add_argument("--event", required=True, type=Path)
            cmd.add_argument("--seconds", type=float, default=5.0)
        if name == "reschedule":
            cmd.add_argument("--at", required=True, type=int)
            cmd.add_argument("--freeze-until", type=int)
        if name in ("approve", "release", "reject"):
            cmd.add_argument("--identity", required=True)
            cmd.add_argument("--simulation-id")
        if name == "explain":
            cmd.add_argument("--order-id")
            cmd.add_argument("--question", default="")
        if name == "export":
            cmd.add_argument("--format", choices=("csv", "json", "zip"), default="zip")
            cmd.add_argument("--output", required=True, type=Path)
    bench = actions.add_parser("benchmark")
    bench.add_argument("--count", type=int, default=6)
    bench.add_argument("--runs", type=int, default=30)
    bench.add_argument("--seconds", type=float, default=4.0)
    bench.add_argument("--seed", type=int, default=42)
    bench.add_argument("--scenario", default="tight")
    bench.add_argument("--scale", action="store_true")
    bench.add_argument("--output", type=Path)
    execution = actions.add_parser("record-execution")
    execution.add_argument("--input", required=True, type=Path)
    return root


def run(service, args):
    action, key = args.action, getattr(args, "schedule_id", None)
    data = {k: v for k, v in vars(args).items() if k != "action"}
    if action == "generate":
        request = DatasetRequest.model_validate(data)
        return service.generate(request.scenario, request.seed, request.count)
    if action == "train":
        return service.train(**TrainRequest.model_validate(data).model_dump())
    if action == "promote":
        return service.promote(args.model, args.rollback)
    if action == "predict":
        return service.predict(**data)
    if action == "optimize":
        scenario = data.pop("scenario")
        if scenario and args.dataset:
            raise ValueError("Select either --scenario or --dataset")
        if scenario:
            selected = DatasetRequest(scenario=scenario)
            data["dataset"] = service.generate(selected.scenario, activate=False)["dataset"]
        result = service.optimize(**dict(OptimizeRequest.model_validate(data)))
        return {
            "schedule": result["id"],
            "state": result["state"],
            "status": result["payload"]["plan"]["status"],
            "objective": result["payload"]["plan"]["objective"],
            "assignment_scope": result["payload"]["plan"]["assignment_scope"],
            "profile": result["payload"]["plan"]["profile"],
            "violations": result["payload"]["validation"],
        }
    if action == "get":
        return service.schedule(key)
    if action == "validate":
        problems = service.validate(key)
        return {"schedule": key, "valid": not problems, "violations": problems}
    if action in ("simulate", "what-if", "reschedule"):
        config = (
            SimulationConfig(runs=args.runs, seed=args.seed, uncertain=not args.zero_uncertainty)
            if args.runs is not None
            else None
        )
        if action == "simulate":
            result = service.simulate(key, config)
            return {k: v for k, v in result.items() if k != "replications"}
        seconds = OptimizeRequest(seconds=args.seconds).seconds
        change = change_adapter.validate_json(args.event.read_bytes())
        return service.alternative(
            key,
            change,
            seconds,
            config,
            getattr(args, "at", None),
            getattr(args, "freeze_until", None),
        )
    if action == "risk":
        return service.risk(key)
    if action == "explain":
        return answer(
            service,
            Query(
                schedule=str(key),
                tool="explain_order_delay" if args.order_id else None,
                order=args.order_id,
                question=args.question,
            ),
        )
    if action in ("approve", "release", "reject"):
        return service.transition(
            key, action, args.identity, os.getenv("FORGEWORKS_PLANNER_TOKEN"), args.simulation_id
        )
    if action == "export":
        content = (
            zip_artifacts(service, key)
            if args.format == "zip"
            else artifacts(service, key)["production_schedule." + args.format]
        )
        args.output.write_bytes(content)
        return {"schedule": key, "output": str(args.output), "bytes": len(content)}
    if action == "record-execution":
        execution_request = ExecutionRequest.model_validate_json(args.input.read_bytes())
        return service.record_execution(execution_request.dataset, execution_request.observations)
    if action == "benchmark":
        output = data.pop("output")
        result = benchmark(**BenchmarkRequest.model_validate(data).model_dump())
        with service.store.transaction(True) as conn:
            db.put(conn, db.benchmarks, result["id"], result)
        if output:
            output.write_text(json.dumps(result, indent=2) + "\n")
        return result
    raise AssertionError(action)


def main():
    cli = parser()
    args = cli.parse_args()
    try:
        payload = run(Service(), args)
    except (ValueError, LookupError, PermissionError) as exc:
        cli.exit(2, json.dumps({"error": type(exc).__name__, "detail": str(exc)}) + "\n")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
