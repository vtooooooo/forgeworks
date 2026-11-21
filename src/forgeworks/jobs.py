"""Single-process bounded executor with persistent status and idempotency keys."""

import hashlib
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from threading import BoundedSemaphore

from . import database as db
from .benchmark import benchmark
from .contracts import (
    BenchmarkRequest,
    OptimizeRequest,
    RescheduleRequest,
    TrainRequest,
    WhatIfRequest,
)
from .service import now, required, uid
from .simulation import SimulationConfig

log = logging.getLogger(__name__)


class QueueFull(RuntimeError):
    pass


class Conflict(ValueError):
    pass


class Jobs:
    def __init__(self, service):
        self.service = service
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="forgeworks")
        self.capacity = BoundedSemaphore(4)

    def get(self, key):
        with self.service.store.transaction() as conn:
            return required(conn, db.jobs, key)["payload"]

    def stop(self):
        self.executor.shutdown(wait=True)

    def recover(self):
        with self.service.store.transaction(True) as conn:
            for record in conn.execute(db.jobs.select()).mappings():
                payload = record["payload"]
                if payload["state"] in ("QUEUED", "RUNNING"):
                    conn.execute(
                        db.jobs.update()
                        .where(db.jobs.c.id == record["id"])
                        .values(
                            payload={
                                **payload,
                                "state": "FAILED",
                                "error": "Worker restarted",
                                "finished_at": now(),
                            }
                        )
                    )

    def submit(self, kind, data, key=None, schedule=None):
        request = data.model_dump(mode="json")
        if kind in ("train", "optimize") and request["dataset"] is None:
            request["dataset"] = self.service.factory().version
        if kind == "optimize" and request["model"] is None:
            _, model = self.service.model(None)
            request["model"] = model or "erp"
        digest = hashlib.sha256(
            json.dumps([kind, schedule, data.model_dump(mode="json")], sort_keys=True).encode()
        ).hexdigest()
        job = hashlib.sha256(key.encode()).hexdigest() if key else uid()
        acquired = False
        try:
            with self.service.store.transaction(True) as conn:
                existing = db.row(conn, db.jobs, job)
                if existing:
                    previous = existing["payload"]
                    if previous["request_hash"] != digest:
                        raise Conflict("Idempotency-Key was already used with a different request")
                    return previous
                if not self.capacity.acquire(blocking=False):
                    raise QueueFull("Worker queue is full")
                acquired = True
                payload = {
                    "id": job,
                    "kind": kind,
                    "state": "QUEUED",
                    "request_hash": digest,
                    "submitted_at": now(),
                    "request": request,
                    "schedule": schedule,
                }
                db.put(conn, db.jobs, job, payload)
            self.executor.submit(self.run, payload.copy())
        except BaseException:
            if acquired:
                self.capacity.release()
            raise
        return payload

    def run(self, payload):
        job, kind, data, schedule = (payload[k] for k in ("id", "kind", "request", "schedule"))

        def update(**fields):
            payload.update(fields)
            with self.service.store.transaction(True) as conn:
                conn.execute(db.jobs.update().where(db.jobs.c.id == job).values(payload=payload))

        try:
            update(state="RUNNING", started_at=now())
            if kind == "train":
                result = self.service.train(**TrainRequest.model_validate(data).model_dump())
                output = {"model": result["id"]}
            elif kind == "optimize":
                request = OptimizeRequest.model_validate(data)
                result = self.service.optimize(**dict(request))
                output = {
                    "schedule": result["id"],
                    "solver_status": result["payload"]["plan"]["status"],
                }
            elif kind == "simulate":
                result = self.service.simulate(schedule, SimulationConfig.model_validate(data))
                output = {"simulation": result["id"], "schedule": schedule}
            elif kind in ("what-if", "reschedule"):
                alternative_request = (
                    WhatIfRequest if kind == "what-if" else RescheduleRequest
                ).model_validate(data)
                args = dict(alternative_request)
                request_schedule = args.pop("schedule", schedule)
                output = self.service.alternative(request_schedule, **args)
            elif kind == "benchmark":
                result = benchmark(**BenchmarkRequest.model_validate(data).model_dump())
                with self.service.store.transaction(True) as conn:
                    db.put(conn, db.benchmarks, result["id"], result)
                output = {"benchmark": result["id"]}
            else:
                raise ValueError("Invalid job kind")
            update(state="SUCCEEDED", result=output, finished_at=now())
        except (ValueError, LookupError, PermissionError) as exc:
            update(state="FAILED", error=str(exc), finished_at=now())
        except Exception:
            log.exception("Job %s failed", job)
            update(state="FAILED", error="Internal job error", finished_at=now())
        finally:
            self.capacity.release()
