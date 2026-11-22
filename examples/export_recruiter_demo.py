"""Build read-only browser assets from the verified synthetic FastAPI fixture."""

import argparse
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from console_seed import seed
from fastapi.testclient import TestClient

from forgeworks.api import create_app
from forgeworks.copilot import Query, answer
from forgeworks.service import Service


def export(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory() as temp:
        os.environ.update(
            FORGEWORKS_DATABASE_URL=f"sqlite:///{temp}/demo.db",
            FORGEWORKS_MODEL_DIR=f"{temp}/models",
            FORGEWORKS_CONSOLE_MODE="read-only",
            FORGEWORKS_DEMO_SEED="1",
        )
        seed()
        service = Service()
        with TestClient(create_app(service)) as client:

            def get(path, **params):
                response = client.get(path, params=params)
                response.raise_for_status()
                return response.json()

            def save(name, value):
                (directory / f"{name}.json").write_text(
                    json.dumps(value, separators=(",", ":"), allow_nan=False) + "\n"
                )

            root = "/api/v1"
            catalog = get(f"{root}/console/catalog")
            catalog.update(database="Immutable synthetic snapshot", mode="public-snapshot")
            assert catalog["demo"] and not catalog["can_plan"] and not catalog["can_approve"]
            assert all(item["precomputed"] and item["valid"] for item in catalog["schedules"])
            benchmark = catalog["latest_benchmark"]
            save(
                "index",
                {
                    "catalog": catalog,
                    "models": get(f"{root}/models"),
                    "benchmark": get(f"{root}/benchmarks/{benchmark}"),
                    "health": get("/health"),
                },
            )
            for item in catalog["schedules"]:
                key = item["id"]
                path = f"{root}/console/schedules/{key}"
                schedule = get(path)
                evidence = {}

                def explain(tool, reference="", *, results=evidence, schedule_id=key, **args):
                    results[f"{tool}:{reference}"] = answer(
                        service, Query(schedule=schedule_id, tool=tool, **args), persist=False
                    )

                explain("get_bottlenecks")
                explain("get_simulation_risk")
                for other in catalog["schedules"]:
                    if other["id"] != key:
                        explain("compare_schedules", other["id"], other_schedule=other["id"])
                for operation in schedule["plan"]["operations"]:
                    order, stage = operation["order"], operation["stage"]
                    explain("explain_assignment", f"{order}:{stage}", order=order, stage=stage)
                predictions = {}
                evaluation = None
                for order in schedule["factory"]["orders"]:
                    order_id = order["id"]
                    explain("explain_order_delay", order_id, order=order_id)
                    predictions[order_id] = {}
                    for shift, params in (("all", {}), ("0", {"shift": 0}), ("1", {"shift": 1})):
                        prediction = get(f"{path}/predictions", order=order_id, **params)
                        evaluation = prediction.pop("evaluation")
                        predictions[order_id][shift] = prediction
                risks = {}
                for simulation in schedule["simulations"]:
                    sim_id = simulation["id"]
                    run = service.risk(key, sim_id, include_rows=True)
                    risks[sim_id] = {
                        "projection": get(f"{path}/risk", simulation_id=sim_id),
                        "completions": [row["completion"] for row in run["replications"]],
                    }
                save(
                    key,
                    {
                        "schedule": schedule,
                        "evidence": evidence,
                        "predictions": predictions,
                        "evaluation": evaluation,
                        "risks": risks,
                        "validation": {"valid": not service.validate(key)},
                    },
                )
                response = client.get(f"{root}/schedules/{key}/export")
                response.raise_for_status()
                (directory / f"{key}.zip").write_bytes(response.content)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    export(parser.parse_args().directory)
