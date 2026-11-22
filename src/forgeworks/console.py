"""Read models and a same-origin local approval boundary for the command center."""

import os
import re
from importlib.metadata import version
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from . import database as db
from .contracts import ApprovalRequest
from .domain import EPOCH, FACTORY_ZONE, Factory, Plan, Record, erp, windows
from .generation import features
from .service import Service, required

router = APIRouter(prefix="/api/v1/console", tags=["command center"])


def mode():
    return os.getenv("FORGEWORKS_CONSOLE_MODE", "backend")


def guarded_writes(request):
    origin = request.headers.get("origin")
    allowed = os.getenv(
        "FORGEWORKS_CONSOLE_ORIGINS",
        "http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:5173,http://localhost:5173",
    ).split(",")
    return (
        request.headers.get("x-forgeworks-console") == "1"
        and origin in allowed
        and request.headers.get("sec-fetch-site") in (None, "same-origin")
    )


def configure_console(app):
    @app.middleware("http")
    async def command_center_boundary(request, next_call):
        if mode() == "backend" or request.method in ("GET", "HEAD", "OPTIONS"):
            return await next_call(request)
        path = request.url.path
        readable = path in ("/api/v1/copilot/query", "/api/v1/predictions/durations") or bool(
            re.fullmatch(r"/api/v1/schedules/[^/]+/validate", path)
        )
        writable = path in ("/api/v1/schedules/optimize", "/api/v1/scenarios/what-if") or bool(
            re.fullmatch(r"/api/v1/schedules/[^/]+/(simulate|reschedule)", path)
            or re.fullmatch(r"/api/v1/console/schedules/[^/]+/(approve|release|reject)", path)
        )
        if (
            request.method == "POST"
            and guarded_writes(request)
            and (readable or (mode() == "local" and writable))
        ):
            return await next_call(request)
        return JSONResponse(
            {"detail": "This console does not permit this action."}, status_code=403
        )

    app.include_router(router)


class ScheduleSummary(Record):
    id: str
    dataset: str
    parent: str | None
    state: str
    model: str | None
    created_at: str
    solver: str
    operation_count: int
    valid: bool
    precomputed: bool


class Catalog(Record):
    version: str
    database: str
    mode: str
    demo: bool
    can_plan: bool
    can_approve: bool
    schedules: list[ScheduleSummary]
    preferred: str | None
    active_model: str | None
    latest_benchmark: str | None


@router.get("/catalog", response_model=Catalog)
def catalog(request: Request):
    service: Service = request.app.state.service
    with service.store.transaction() as conn:
        rows = conn.execute(
            db.schedules.select()
            .order_by(db.schedules.c.payload["created_at"].as_string().desc())
            .limit(100)
        ).mappings()
        demo = db.row(conn, db.settings, "console_seed")
        seeded = set(demo["payload"].get("schedule_ids", [])) if demo else set()
        schedules = [
            ScheduleSummary(
                id=r["id"],
                dataset=r["dataset"],
                parent=r["parent"],
                state=r["state"],
                model=r["model"],
                created_at=r["payload"]["created_at"],
                solver=r["payload"]["plan"]["status"],
                operation_count=len(r["payload"]["plan"]["operations"]),
                valid=not r["payload"]["validation"],
                precomputed=r["id"] in seeded,
            )
            for r in rows
        ]
        model = db.row(conn, db.settings, "model")
        benchmark_ids = conn.execute(db.benchmarks.select()).mappings().all()
        last_benchmark = max(
            benchmark_ids, key=lambda r: (r["payload"].get("created_at", ""), r["id"]), default=None
        )
    preferred = next((r.id for r in schedules if r.state == "RELEASED"), None) or next(
        (r.id for r in schedules if r.valid and r.operation_count), None
    )
    return Catalog(
        version=version("forgeworks"),
        database=service.store.engine.dialect.name,
        mode=mode(),
        demo=bool(demo),
        can_plan=mode() == "local",
        can_approve=mode() == "local" and bool(os.getenv("FORGEWORKS_PLANNER_TOKEN")),
        schedules=schedules,
        preferred=preferred,
        active_model=model["payload"] if model else None,
        latest_benchmark=last_benchmark["id"] if last_benchmark else None,
    )


class MachineLoad(Record):
    machine: str
    department: str
    busy: int
    available: int


class ConsoleSchedule(Record):
    id: str
    dataset: str
    parent: str | None
    model: str | None
    state: str
    plan: Plan
    factory: Factory
    epoch: str
    timezone: str
    validation: list[dict]
    high_risk: bool
    frozen: int
    load: list[MachineLoad]
    simulations: list[dict]
    approvals: list[dict]
    changes: list[dict]


@router.get("/schedules/{schedule_id}", response_model=ConsoleSchedule)
def schedule(schedule_id: str, request: Request):
    service: Service = request.app.state.service
    record = service.schedule(schedule_id)
    payload = record["payload"]
    plan = Plan.model_validate(payload["plan"])
    factory = service.factory(record["dataset"])
    span = max(plan.completion.values(), default=0)
    load = [
        MachineLoad(
            machine=m.id,
            department=m.department,
            busy=sum(op.end - op.setup_start for op in plan.operations if op.machine == m.id),
            available=sum(end - start for start, end in windows(m, span)),
        )
        for m in factory.machines
    ]
    with service.store.transaction() as conn:
        sims = conn.execute(
            db.simulations.select().where(db.simulations.c.schedule == schedule_id)
        ).mappings()
        simulations = sorted(
            (
                {
                    "id": r["id"],
                    "created_at": r["payload"]["created_at"],
                    "config": r["payload"]["config"],
                }
                for r in sims
            ),
            key=lambda r: r["created_at"],
            reverse=True,
        )
        approvals = sorted(
            (
                r["payload"]
                for r in conn.execute(
                    db.approvals.select().where(db.approvals.c.schedule == schedule_id)
                ).mappings()
            ),
            key=lambda r: r["at"],
            reverse=True,
        )
        changes = [
            r["payload"]
            for table in (db.scenarios, db.rescheduling)
            for r in conn.execute(table.select().where(table.c.schedule == schedule_id)).mappings()
        ]
    return ConsoleSchedule(
        id=record["id"],
        dataset=record["dataset"],
        parent=record["parent"],
        model=record["model"],
        state=record["state"],
        plan=plan,
        factory=factory,
        epoch=EPOCH.isoformat(),
        timezone=FACTORY_ZONE.key,
        validation=payload["validation"],
        high_risk=payload.get("high_risk", False),
        frozen=len(payload.get("frozen", [])),
        load=load,
        simulations=simulations,
        approvals=approvals,
        changes=changes,
    )


class RiskMetric(Record):
    mean: float
    ci95: list[float] | None


class OrderRisk(Record):
    order: str
    p_late: float
    ci95: list[float]
    p50_completion: int | None
    p95_completion: int | None
    completed_runs: int


class ConsoleRisk(Record):
    id: str
    schedule: str
    config: dict
    summary: dict[str, RiskMetric]
    risk: list[OrderRisk]
    p95_weighted_tardiness: float
    series: list[dict]


@router.get("/schedules/{schedule_id}/risk", response_model=ConsoleRisk)
def risk(
    schedule_id: str, request: Request, simulation_id: str | None = None, order: str | None = None
):
    result = request.app.state.service.risk(schedule_id, simulation_id, include_rows=True)
    rows = result.pop("replications")
    result.pop("created_at")
    result["series"] = [
        {
            "replication": r["replication"],
            "makespan": r["makespan"],
            "weighted_tardiness": r["weighted_tardiness"],
            "on_time": r["on_time"],
            "completion": r["completion"].get(order) if order else None,
        }
        for r in rows
    ]
    return ConsoleRisk.model_validate(result)


@router.get("/schedules/{schedule_id}/predictions")
def predictions(schedule_id: str, order: str, request: Request, shift: int | None = None):
    if shift not in (None, 0, 1):
        raise ValueError("Shift must be 0 or 1")
    service: Service = request.app.state.service
    record = service.schedule(schedule_id)
    factory = service.factory(record["dataset"])
    demand = next((o for o in factory.orders if o.id == order), None)
    if demand is None:
        raise LookupError("Unknown order")
    product = next(p for p in factory.products if p.id == demand.product)
    machines = {m.id: m for m in factory.machines}
    with service.store.transaction() as conn:
        model = required(conn, db.models, record["model"]) if record["model"] else None
        historical_dataset = model["dataset"] if model else factory.version
        history = [
            r["payload"]
            for r in conn.execute(
                db.history.select()
                .where(db.history.c.dataset == historical_dataset, db.history.c.at < 0)
                .order_by(db.history.c.at.desc())
                .limit(10000)
            ).mappings()
            if r["payload"]["family"] == product.family
            and (shift is None or r["payload"]["shift"] == shift)
        ]
    groups: dict[tuple[str, str], list[float]] = {}
    for row in history:
        groups.setdefault((row["machine"], row["operation"]), []).append(row["duration"])
    confirmed = []
    for row in record["payload"]["predictions"]:
        if row["order"] != order:
            continue
        stage = row["stage"]
        machine = machines[row["machine"]]
        observed = groups.get((machine.id, product.route[stage]), [])
        confirmed.append(
            {
                **row,
                "operation": product.route[stage],
                "erp": erp(product, stage, demand.quantity),
                "history_mean": sum(observed) / len(observed) if observed else None,
                "history_count": len(observed),
                "features": features(product, stage, demand.quantity, machine),
            }
        )
    return {
        "order": order,
        "family": product.family,
        "product": product.id,
        "model": record["model"],
        "historical_dataset": historical_dataset,
        "predictions": confirmed,
        "evaluation": model["payload"] if model else None,
    }


@router.post("/schedules/{schedule_id}/{action}")
def govern(
    schedule_id: str,
    action: Literal["approve", "release", "reject"],
    body: ApprovalRequest,
    request: Request,
):
    if mode() != "local" or not guarded_writes(request):
        raise HTTPException(403, "Planner actions are disabled for this console")
    return request.app.state.service.transition(
        schedule_id,
        action,
        body.identity,
        os.getenv("FORGEWORKS_PLANNER_TOKEN"),
        body.simulation_id,
    )
