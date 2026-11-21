"""Portable JSON and Excel-compatible CSV exports with checksummed manifests."""

import csv
import hashlib
import io
import json
import zipfile
from typing import Any

from . import database as db
from .domain import Plan, timestamp
from .validation import material_events


def csv_bytes(rows: list[dict], columns: tuple[str, ...] = ()) -> bytes:
    buffer = io.StringIO(newline="")
    names = list(dict.fromkeys((*columns, *(key for row in rows for key in row))))
    writer = csv.DictWriter(buffer, fieldnames=names)
    writer.writeheader()
    for row in rows:
        cells = {
            k: json.dumps(v)
            if isinstance(v, (dict, list, tuple))
            else "'" + v
            if isinstance(v, str) and v.lstrip().startswith(("=", "+", "-", "@"))
            else v
            for k, v in row.items()
        }
        writer.writerow(cells)
    return buffer.getvalue().encode("utf-8-sig")


def artifacts(service, key):
    run = service.schedule(key)
    plan = Plan.model_validate(run["payload"]["plan"])
    factory = service.factory(run["dataset"])
    metadata = {
        "schedule_id": key,
        "dataset": run["dataset"],
        "model": run["model"] or "erp",
        "time_unit": "minutes",
        "time_origin_utc": timestamp(0),
    }
    files: dict[str, bytes] = {}

    def add_json(name, payload):
        files[name + ".json"] = json.dumps(
            {"metadata": metadata, "data": payload}, indent=2
        ).encode()

    def add_csv(name, rows):
        files[name + ".csv"] = csv_bytes([{**metadata, **row} for row in rows], tuple(metadata))

    records = [
        {
            **op.model_dump(),
            "setup_start_utc": timestamp(op.setup_start),
            "start_utc": timestamp(op.start),
            "end_utc": timestamp(op.end),
        }
        for op in plan.operations
    ]
    add_json("production_schedule", records)
    add_csv("production_schedule", records)
    add_csv("machine_assignments", sorted(records, key=lambda row: (row["machine"], row["start"])))
    add_csv("setup_intervals", [r for r in records if r["setup_start"] != r["start"]])
    add_csv(
        "order_completion",
        [
            {
                "order": oid,
                "completion": minute,
                "completion_utc": timestamp(minute),
                "tardiness": plan.tardiness[oid],
            }
            for oid, minute in plan.completion.items()
        ],
    )
    balances = factory.inventory.copy()
    usage = [
        {
            "at": 0,
            "at_utc": timestamp(0),
            "material": m,
            "delta": q,
            "reference": "opening_inventory",
            "balance": q,
        }
        for m, q in balances.items()
    ]
    for at, _, material, delta, reference in sorted(material_events(factory, plan.operations)):
        balances[material] += delta
        usage.append(
            {
                "at": at,
                "at_utc": timestamp(at),
                "material": material,
                "delta": delta,
                "reference": reference,
                "balance": balances[material],
            }
        )
    add_csv("material_usage", usage)
    add_csv("duration_predictions", run["payload"]["predictions"])
    add_json(
        "optimization_summary", {k: v for k, v in plan.model_dump().items() if k != "operations"}
    )
    add_json("constraint_validation", service.validate(key))
    with service.store.transaction() as conn:
        if run["model"]:
            add_json("ml_evaluation", db.row(conn, db.models, run["model"])["payload"])
        logs: dict[str, list[Any]] = {}
        for table in (db.approvals, db.scenarios, db.rescheduling):
            logs[table.name] = [
                r["payload"]
                for r in conn.execute(table.select().where(table.c.schedule == key)).mappings()
            ]
        add_json("planner_approval_record", sorted(logs[db.approvals.name], key=lambda r: r["at"]))
        if logs[db.rescheduling.name]:
            add_json("rescheduling_diff", logs[db.rescheduling.name])
        comparisons = [*logs[db.scenarios.name], *logs[db.rescheduling.name]]
        if comparisons:
            add_csv("schedule_comparison", comparisons)
    try:
        risk = service.risk(key, include_rows=True)
    except LookupError:
        pass
    else:
        add_csv(
            "simulation_results", [{"simulation_id": risk["id"], **r} for r in risk["replications"]]
        )
        add_csv("delivery_risk", [{"simulation_id": risk["id"], **r} for r in risk["risk"]])
    add_json(
        "manifest",
        {
            name: {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
            for name, data in sorted(files.items())
        },
    )
    return files


def zip_artifacts(service, key):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in artifacts(service, key).items():
            archive.writestr(name, data)
    return output.getvalue()
