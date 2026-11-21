"""FastAPI transport. Run with one application process and one bounded job worker."""

from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy import text

from . import database as db
from .contracts import (
    ApprovalRequest,
    BenchmarkRequest,
    DatasetRequest,
    ExecutionRequest,
    OptimizeRequest,
    PredictRequest,
    PromotionRequest,
    RescheduleRequest,
    TrainRequest,
    WhatIfRequest,
)
from .copilot import Query, answer
from .domain import Order
from .exports import artifacts, zip_artifacts
from .jobs import Conflict, Jobs, QueueFull
from .provider import configured_provider
from .service import Service, required
from .simulation import SimulationConfig

Idempotency = Annotated[str | None, Header(alias="Idempotency-Key", max_length=160)]
Planner = Annotated[str | None, Header(alias="X-Planner-Token", max_length=500)]


class JobAccepted(BaseModel):
    id: str
    kind: str
    state: str


def create_app(service: Service | None = None):
    @asynccontextmanager
    async def lifespan(application):
        application.state.service = service or Service()
        application.state.jobs = Jobs(application.state.service)
        application.state.jobs.recover()
        yield
        application.state.jobs.stop()

    app = FastAPI(title="ForgeWorks AI", version="0.1.0", lifespan=lifespan)
    base = "/api/v1"

    def svc(request: Request) -> Service:
        return request.app.state.service

    def queue(request: Request) -> Jobs:
        return request.app.state.jobs

    Svc = Annotated[Service, Depends(svc)]
    JobQueue = Annotated[Jobs, Depends(queue)]

    @app.exception_handler(ValueError)
    @app.exception_handler(LookupError)
    @app.exception_handler(PermissionError)
    @app.exception_handler(QueueFull)
    def error_handler(request, exc):
        code = (
            404
            if isinstance(exc, LookupError)
            else 403
            if isinstance(exc, PermissionError)
            else 429
            if isinstance(exc, QueueFull)
            else 409
            if isinstance(exc, Conflict)
            else 422
        )
        return JSONResponse(
            status_code=code, content={"error": type(exc).__name__, "detail": str(exc)}
        )

    @app.get("/health")
    def health(service: Svc):
        with service.store.transaction() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok"}

    @app.post(base + "/datasets", status_code=201)
    def datasets(body: DatasetRequest, service: Svc):
        return service.generate(body.scenario, body.seed, body.count)

    @app.get(base + "/machines")
    def machines(service: Svc, dataset: str | None = None):
        return {"machines": service.factory(dataset).machines}

    @app.get(base + "/orders")
    def orders(service: Svc, dataset: str | None = None):
        return {"orders": service.factory(dataset).orders}

    @app.post(base + "/orders", status_code=201)
    def add_order(body: Order, service: Svc, dataset: str | None = None):
        return service.add_order(body, dataset)

    @app.post(base + "/execution")
    def execution(body: ExecutionRequest, service: Svc):
        return service.record_execution(body.dataset, body.observations)

    @app.get(base + "/models")
    def models(service: Svc):
        return service.list_models()

    @app.post(base + "/models/train", status_code=202, response_model=JobAccepted)
    def train(body: TrainRequest, jobs: JobQueue, key: Idempotency = None):
        return jobs.submit("train", body, key)

    @app.post(base + "/models/promote")
    def promote(body: PromotionRequest, service: Svc):
        return service.promote(body.model, body.rollback)

    @app.post(base + "/predictions/durations")
    def predict(body: PredictRequest, service: Svc):
        return service.predict(**body.model_dump())

    @app.post(base + "/schedules/optimize", status_code=202, response_model=JobAccepted)
    def optimize(body: OptimizeRequest, jobs: JobQueue, key: Idempotency = None):
        return jobs.submit("optimize", body, key)

    @app.get(base + "/jobs/{job_id}")
    def job(job_id: str, jobs: JobQueue):
        return jobs.get(job_id)

    @app.get(base + "/schedules/{schedule_id}")
    def schedule(schedule_id: str, service: Svc):
        return service.schedule(schedule_id)

    @app.post(base + "/schedules/{schedule_id}/validate")
    def validate(schedule_id: str, service: Svc):
        violations = service.validate(schedule_id)
        return {"schedule": schedule_id, "valid": not violations, "violations": violations}

    @app.post(
        base + "/schedules/{schedule_id}/simulate", status_code=202, response_model=JobAccepted
    )
    def simulate(schedule_id: str, body: SimulationConfig, jobs: JobQueue, key: Idempotency = None):
        return jobs.submit("simulate", body, key, schedule_id)

    @app.get(base + "/schedules/{schedule_id}/risk")
    def risk(schedule_id: str, service: Svc, simulation_id: str | None = None):
        return service.risk(schedule_id, simulation_id)

    @app.post(base + "/scenarios/what-if", status_code=202, response_model=JobAccepted)
    def what_if(body: WhatIfRequest, jobs: JobQueue, key: Idempotency = None):
        return jobs.submit("what-if", body, key)

    @app.post(
        base + "/schedules/{schedule_id}/reschedule", status_code=202, response_model=JobAccepted
    )
    def reschedule(
        schedule_id: str, body: RescheduleRequest, jobs: JobQueue, key: Idempotency = None
    ):
        return jobs.submit("reschedule", body, key, schedule_id)

    @app.post(base + "/copilot/query")
    def copilot(body: Query, service: Svc):
        return answer(service, body, configured_provider())

    @app.post(base + "/schedules/{schedule_id}/approve")
    def approve(schedule_id: str, body: ApprovalRequest, service: Svc, token: Planner = None):
        return service.transition(schedule_id, "approve", body.identity, token, body.simulation_id)

    @app.post(base + "/schedules/{schedule_id}/release")
    def release(schedule_id: str, body: ApprovalRequest, service: Svc, token: Planner = None):
        return service.transition(schedule_id, "release", body.identity, token)

    @app.post(base + "/schedules/{schedule_id}/reject")
    def reject(schedule_id: str, body: ApprovalRequest, service: Svc, token: Planner = None):
        return service.transition(schedule_id, "reject", body.identity, token)

    @app.get(base + "/schedules/{schedule_id}/export")
    def export(schedule_id: str, service: Svc, format: str = "zip"):
        if format == "zip":
            content, media = zip_artifacts(service, schedule_id), "application/zip"
        elif format in ("csv", "json"):
            content = artifacts(service, schedule_id)["production_schedule." + format]
            media = "text/csv" if format == "csv" else "application/json"
        else:
            raise HTTPException(422, "Format must be zip, csv or json")
        return Response(
            content,
            media_type=media,
            headers={
                "Content-Disposition": f'attachment; filename="schedule-{schedule_id}.{format}"'
            },
        )

    @app.get(base + "/benchmarks")
    def benchmarks(service: Svc):
        with service.store.transaction() as conn:
            return [
                {"id": row["id"], "scenario": row["payload"]["scenario"]}
                for row in conn.execute(db.benchmarks.select()).mappings()
            ]

    @app.get(base + "/benchmarks/{run_id}")
    def benchmark_result(run_id: str, service: Svc):
        with service.store.transaction() as conn:
            return required(conn, db.benchmarks, run_id)["payload"]

    @app.post(base + "/benchmarks", status_code=202, response_model=JobAccepted)
    def benchmark(body: BenchmarkRequest, jobs: JobQueue, key: Idempotency = None):
        return jobs.submit("benchmark", body, key)

    return app


app = create_app()
