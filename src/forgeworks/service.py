"""Application services shared by the API, CLI, and experiments."""

import hmac
import json
import os
import pickle
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

from . import database as db
from .domain import DEFAULT_WEIGHTS, Factory, Operation, Order, Plan
from .generation import generate, history
from .ml import predictions, train
from .optimization import optimize
from .scenarios import Overrun, apply, difference
from .simulation import SimulationConfig, interval, simulate
from .validation import validate


def uid():
    return uuid4().hex


def now():
    return datetime.now(UTC).isoformat()


def required(conn, table, key):
    record = db.row(conn, table, key)
    if record is None:
        raise LookupError(f"Unknown {table.name} ID {key}")
    return record


class Service:
    def __init__(self, url=None, model_dir=None):
        self.store = db.Store(url)
        self.model_dir = Path(model_dir or os.getenv("FORGEWORKS_MODEL_DIR", ".forgeworks/models"))

    def save_factory(self, factory: Factory):
        key = factory.version
        with self.store.transaction(True) as conn:
            if db.row(conn, db.datasets, key):
                return key
            db.put(conn, db.datasets, key, factory.model_dump(mode="json"))
            for table, records in (
                (db.products, factory.products),
                (db.machines, factory.machines),
                (db.orders, factory.orders),
            ):
                for record in records:
                    extra = {"product_id": record.product} if isinstance(record, Order) else {}
                    db.put(
                        conn, table, record.id, record.model_dump(mode="json"), dataset=key, **extra
                    )
            for material, quantity in factory.inventory.items():
                db.put(conn, db.materials, material, {"unit": "stock unit"}, dataset=key)
                db.put(
                    conn,
                    db.inventory,
                    material,
                    {"quantity": quantity},
                    dataset=key,
                    material_id=material,
                )
            for receipt in factory.receipts:
                db.put(
                    conn,
                    db.receipts,
                    receipt.id,
                    receipt.model_dump(),
                    dataset=key,
                    material_id=receipt.material,
                )
            for product in factory.products:
                db.put(
                    conn,
                    db.routings,
                    product.id,
                    {"product": product.id},
                    dataset=key,
                    product_id=product.id,
                )
                db.put(
                    conn,
                    db.bills,
                    product.id,
                    {"material": product.material, "units": product.units},
                    dataset=key,
                    product_id=product.id,
                    material_id=product.material,
                )
                for i, operation in enumerate(product.route):
                    db.put(
                        conn,
                        db.stages,
                        f"{product.id}/{i}",
                        {"operation": operation},
                        dataset=key,
                        route_id=product.id,
                    )
            for machine in factory.machines:
                for name in machine.capabilities:
                    db.put(
                        conn,
                        db.capabilities,
                        f"{machine.id}/{name}",
                        {"machine": machine.id, "operation": name},
                        dataset=key,
                        machine_id=machine.id,
                    )
                for table, calendar in (
                    (db.calendars, machine.shifts),
                    (db.maintenance, machine.maintenance),
                ):
                    for i, window in enumerate(calendar):
                        db.put(
                            conn,
                            table,
                            f"{machine.id}/{i}",
                            window.model_dump(),
                            dataset=key,
                            machine_id=machine.id,
                        )
        return key

    def generate(self, name="normal", seed=42, count=12, activate=True):
        factory = generate(name, seed, count)
        key = self.save_factory(factory)
        if activate:
            with self.store.transaction(True) as conn:
                db.setting(conn, "dataset", key)
        return {
            "dataset": key,
            "orders": len(factory.orders),
            "machines": len(factory.machines),
            "products": len(factory.products),
            "scenario": name,
        }

    def factory(self, dataset=None):
        with self.store.transaction() as conn:
            selected = db.row(conn, db.settings, "dataset")
            key = dataset or (selected["payload"] if selected else None)
            if not key:
                raise LookupError("Generate a dataset first")
            return Factory.model_validate(required(conn, db.datasets, key)["payload"])

    def add_order(self, order: Order, dataset=None):
        factory = self.factory(dataset)
        existing = next((o for o in factory.orders if o.id == order.id), None)
        if existing and existing != order:
            raise ValueError("Order ID already exists with different details")
        if len(factory.orders) >= 300 and existing is None:
            raise ValueError("Dataset capacity is 300 orders")
        if existing is None:
            factory = Factory.model_validate(
                {**factory.model_dump(), "orders": (*factory.orders, order)}
            )
        key = self.save_factory(factory)
        # This operation forks a dataset. Explicit generation selects a new default.
        return {"dataset": key, "order": order.model_dump()}

    def record_execution(self, dataset, observations):
        factory = self.factory(dataset)
        if not observations or len(observations) > 500:
            raise ValueError("Submit 1 to 500 execution observations")
        from .domain import eligible
        from .generation import features

        products = {p.id: p for p in factory.products}
        orders = {o.id: o for o in factory.orders}
        machines = {m.id: m for m in factory.machines}
        with self.store.transaction(True) as conn:
            for observation in observations:
                o = orders.get(observation.order)
                m = machines.get(observation.machine)
                if o is None or m is None:
                    raise ValueError("Unknown order or machine")
                p = products[o.product]
                if observation.stage >= len(p.route) or not eligible(
                    m, p, observation.stage, o.quantity
                ):
                    raise ValueError("Invalid observed stage or machine")
                values = {
                    **features(p, observation.stage, o.quantity, m),
                    "duration": observation.duration,
                    "at": observation.at,
                    "shift": observation.shift,
                    "source": observation.source,
                }
                existing = (
                    conn.execute(
                        db.history.select().where(
                            db.history.c.dataset == factory.version,
                            db.history.c.id == observation.id,
                        )
                    )
                    .mappings()
                    .first()
                )
                if existing and existing["payload"] != values:
                    raise ValueError("Execution ID already has different contents")
                if existing is None:
                    db.put(
                        conn,
                        db.history,
                        observation.id,
                        values,
                        dataset=factory.version,
                        at=observation.at,
                    )
            rows = (
                conn.execute(
                    db.history.select()
                    .where(db.history.c.dataset == factory.version, db.history.c.at >= 0)
                    .limit(5000)
                )
                .mappings()
                .all()
            )
        bundle, _ = self.model(None)
        drift = None
        if bundle and rows:
            from .ml import predict

            observed = [r["payload"] for r in rows]
            name = bundle["selected"]
            radius = bundle["radii"][name]
            estimates = predict(bundle, name, observed)
            coverage = sum(
                abs(p - r["duration"]) <= radius for p, r in zip(estimates, observed)
            ) / len(observed)
            drift = {"coverage": coverage, "n": len(observed), "coverage_threshold": 0.82}
        return {
            "dataset": factory.version,
            "observations": len(rows),
            "drift": drift,
            "retraining_review": (
                len(rows) >= 100 or bool(drift and drift["n"] >= 20 and drift["coverage"] < 0.82)
            ),
        }

    def train(self, dataset=None, count=2400, seed=42):
        factory = self.factory(dataset)
        historical = history(factory, count)
        with self.store.transaction() as conn:
            recent = [
                r["payload"]
                for r in conn.execute(
                    db.history.select()
                    .where(db.history.c.dataset == factory.version, db.history.c.at >= 0)
                    .order_by(db.history.c.at.desc())
                    .limit(5000)
                ).mappings()
            ]
        # Deterministic tie breaking preserves the observation order across repeated runs.
        for i, observation in enumerate(
            sorted(recent, key=lambda row: (row["at"], json.dumps(row, sort_keys=True)))
        ):
            historical.append({**observation, "at": i})
        bundle, metrics = train(historical, seed)
        artifact = pickle.dumps(bundle, protocol=5)
        checksum = sha256(artifact).hexdigest()
        key = uid()
        self.model_dir.mkdir(parents=True, exist_ok=True)
        path = self.model_dir / f"{key}.pkl"
        path.write_bytes(artifact)
        evaluation = {
            "id": key,
            "dataset": factory.version,
            "trained_at": now(),
            "sha256": checksum,
            "history_sha256": sha256(json.dumps(historical, sort_keys=True).encode()).hexdigest(),
            **metrics,
        }
        with self.store.transaction(True) as conn:
            db.put(conn, db.models, key, evaluation, dataset=factory.version)
            db.put(conn, db.training, uid(), evaluation, model=key)
            for i, record in enumerate(historical[:count]):
                history_id = f"synthetic/{count}/{i}"
                existing = conn.execute(
                    db.history.select().where(
                        db.history.c.dataset == factory.version, db.history.c.id == history_id
                    )
                ).first()
                if existing is None:
                    db.put(
                        conn,
                        db.history,
                        history_id,
                        record,
                        dataset=factory.version,
                        at=record["at"],
                    )
        return evaluation

    def list_models(self):
        with self.store.transaction() as conn:
            return [r["payload"] for r in conn.execute(db.models.select()).mappings()]

    def promote(self, model_id, rollback=False):
        with self.store.transaction(True) as conn:
            current = db.row(conn, db.settings, "model")
            previous = db.row(conn, db.settings, "previous_model")
            key = (previous["payload"] if previous else None) if rollback else model_id
            if key is not None:
                record = required(conn, db.models, key)
                if not record["payload"]["eligible_for_promotion"]:
                    raise ValueError("Model failed the promotion quality gates")
            if not rollback and key is None:
                raise ValueError("Model ID is required")
            db.setting(conn, "previous_model", current["payload"] if current else None)
            db.setting(conn, "model", key)
        return {"model": key}

    def model(self, selection):
        with self.store.transaction() as conn:
            active = db.row(conn, db.settings, "model")
            selected = selection or (active["payload"] if active else None)
            if not selected or selected == "erp":
                return None, None
            record = required(conn, db.models, selected)["payload"]
        path = self.model_dir / f"{selected}.pkl"
        artifact = path.read_bytes()
        if sha256(artifact).hexdigest() != record["sha256"]:
            raise ValueError("Model artifact checksum mismatch")
        # Registry files are trusted local artifacts generated by this service.
        return pickle.loads(artifact), selected

    def predict(self, dataset=None, model=None, order=None):
        factory = self.factory(dataset)
        if order:
            if order not in {o.id for o in factory.orders}:
                raise LookupError(f"Unknown order {order}")
            factory = factory.model_copy(
                update={"orders": tuple(o for o in factory.orders if o.id == order)}
            )
        bundle, model_key = self.model(model)
        return {"model": model_key, "predictions": predictions(factory, bundle)}

    def optimize(
        self,
        dataset=None,
        model=None,
        method="CP-SAT",
        seconds=5.0,
        buffer=0.0,
        weights=DEFAULT_WEIGHTS,
        parent=None,
        frozen=(),
        previous=(),
        earliest=0,
        change=None,
        replan=False,
    ):
        factory = self.factory(dataset)
        bundle, model_key = self.model(model)
        estimates = predictions(factory, bundle, buffer)
        by_key = {(r["order"], r["stage"], r["machine"]): r for r in estimates}
        for op in frozen:
            if (*op.key, op.machine) in by_key:
                by_key[*op.key, op.machine]["minutes"] = op.end - op.start
        if isinstance(change, Overrun):
            affected = [
                r for r in estimates if (r["order"], r["stage"]) == (change.order, change.stage)
            ]
            if not affected or any(op.key == (change.order, change.stage) for op in frozen):
                raise ValueError("Overrun must identify an unprotected operation")
            for estimate in affected:
                estimate["minutes"] += change.minutes
        durations = {key: r["minutes"] for key, r in by_key.items()}
        plan = optimize(factory, durations, method, seconds, weights, frozen, previous, earliest)
        violations = validate(factory, plan, durations, frozen, previous, earliest)
        key = uid()
        payload = {
            "plan": plan.model_dump(mode="json"),
            "predictions": estimates,
            "validation": violations,
            "frozen": [o.model_dump() for o in frozen],
            "previous": [o.model_dump() for o in previous],
            "earliest": earliest,
            "replan": replan,
            "created_at": now(),
            "buffer": buffer,
            "high_risk": factory.name in ("shortage", "breakdown", "multiple", "variable")
            or replan
            or change is not None,
        }
        with self.store.transaction(True) as conn:
            db.put(
                conn,
                db.schedules,
                key,
                payload,
                dataset=factory.version,
                model=model_key,
                state="DRAFT" if violations else "VALIDATED",
                parent=parent,
            )
            for i, op in enumerate(plan.operations):
                db.put(conn, db.operations, f"{key}/{i}", op.model_dump(), schedule=key)
        return self.schedule(key)

    def schedule(self, key):
        with self.store.transaction() as conn:
            return dict(required(conn, db.schedules, key))

    def validate(self, key):
        record = self.schedule(key)
        p = record["payload"]
        return validate(
            self.factory(record["dataset"]),
            Plan.model_validate(p["plan"]),
            {(r["order"], r["stage"], r["machine"]): r["minutes"] for r in p["predictions"]},
            tuple(Operation.model_validate(o) for o in p["frozen"]),
            tuple(Operation.model_validate(o) for o in p["previous"]),
            p["earliest"],
        )

    def simulate(self, key, config: SimulationConfig):
        record = self.schedule(key)
        if self.validate(key):
            raise ValueError("Simulation requires a valid schedule")
        plan = Plan.model_validate(record["payload"]["plan"])
        if config.trace and config.runs * len(plan.operations) > 20_000:
            raise ValueError("Trace workload exceeds 20,000 operation replications")
        result = simulate(self.factory(record["dataset"]), plan, config)
        simulation_id = uid()
        with self.store.transaction(True) as conn:
            summary = {k: v for k, v in result.items() if k != "replications"}
            summary["created_at"] = now()
            db.put(conn, db.simulations, simulation_id, summary, schedule=key)
            for i, outcome in enumerate(result["replications"]):
                db.put(conn, db.outcomes, f"{simulation_id}/{i}", outcome, simulation=simulation_id)
            conn.execute(
                db.schedules.update()
                .where(db.schedules.c.id == key, db.schedules.c.state == "VALIDATED")
                .values(state="SIMULATED")
            )
        return {"id": simulation_id, "schedule": key, **result}

    def risk(self, key, simulation_id=None, include_rows=False):
        self.schedule(key)
        with self.store.transaction() as conn:
            query = db.simulations.select().where(db.simulations.c.schedule == key)
            if simulation_id:
                query = query.where(db.simulations.c.id == simulation_id)
            rows = conn.execute(query).mappings().all()
            if not rows:
                raise LookupError("No matching simulation")
            record = max(rows, key=lambda r: (r["payload"]["created_at"], r["id"]))
            result = {"id": record["id"], "schedule": key, **record["payload"]}
            if include_rows:
                result["replications"] = sorted(
                    (
                        r["payload"]
                        for r in conn.execute(
                            db.outcomes.select().where(db.outcomes.c.simulation == record["id"])
                        ).mappings()
                    ),
                    key=lambda r: r["replication"],
                )
            return result

    def alternative(self, key, change, seconds=5.0, config=None, at=None, freeze_until=None):
        source = self.schedule(key)
        parent = Plan.model_validate(source["payload"]["plan"])
        if self.validate(key):
            raise ValueError("A valid parent schedule is required")
        if at is not None and source["state"] != "RELEASED":
            raise ValueError("Rescheduling requires the active released schedule")
        factory = self.factory(source["dataset"])
        if at is not None and not 0 <= at <= factory.horizon:
            raise ValueError("Disruption is outside the planning horizon")
        if freeze_until is not None and (at is None or not at <= freeze_until <= factory.horizon):
            raise ValueError("Freeze end must follow the disruption within the horizon")
        protected = tuple(
            o
            for o in parent.operations
            if at is not None and o.setup_start < max(at, freeze_until or at)
        )
        if at is not None and getattr(change, "start", at) < at:
            raise ValueError("A disruption cannot revise a historical interval")
        updated = apply(factory, change, protected)
        if len(updated.orders) > 300:
            raise ValueError("Dataset capacity is 300 orders")
        if at is not None:
            original_receipts = {r.id: r for r in factory.receipts}
            if any(
                r != original_receipts[r.id] and original_receipts[r.id].at < at
                for r in updated.receipts
            ):
                raise ValueError("Cannot delay an already received shipment")
        dataset = self.save_factory(updated)
        revised = self.optimize(
            dataset,
            source["model"] or "erp",
            seconds=seconds,
            buffer=source["payload"]["buffer"],
            weights=parent.weights,
            parent=key,
            frozen=protected,
            previous=parent.operations if at is not None else (),
            earliest=at or 0,
            change=change,
            replan=at is not None,
        )
        plan = Plan.model_validate(revised["payload"]["plan"])
        valid = not revised["payload"]["validation"]
        diff = difference(parent, plan) if valid else None
        result = {
            "parent": key,
            "schedule": revised["id"],
            "valid": valid,
            "status": plan.status,
            "change": change.model_dump(),
            "difference": diff,
            "protected": len(protected),
            "as_of": at,
            "freeze_until": freeze_until,
            "validation": revised["payload"]["validation"],
        }
        if config is not None and valid:
            base = self.simulate(key, config)
            new = self.simulate(revised["id"], config)
            result["simulation"] = {
                "baseline": base["id"],
                "alternative": new["id"],
                "paired_delta": {
                    m: interval(
                        [b[m] - a[m] for a, b in zip(base["replications"], new["replications"])]
                    )
                    for m in ("weighted_tardiness", "on_time", "cost")
                },
            }
        with self.store.transaction(True) as conn:
            db.put(
                conn,
                db.rescheduling if at is not None else db.scenarios,
                uid(),
                result,
                schedule=revised["id"],
            )
        return result

    def transition(self, key, action, identity, token, simulation_id=None):
        secret = os.getenv("FORGEWORKS_PLANNER_TOKEN")
        if not secret or not token or not hmac.compare_digest(secret, token):
            raise PermissionError("Planner authorization required")
        if not identity.strip():
            raise ValueError("Approver identity is required")
        with self.store.transaction(True) as conn:
            record = required(conn, db.schedules, key)
            state = record["state"]
            if action == "approve":
                if state in ("APPROVED", "RELEASED"):
                    return {"schedule": key, "state": state}
                if state not in ("VALIDATED", "SIMULATED") or record["payload"]["validation"]:
                    raise ValueError("Approval requires independent validation")
                if simulation_id:
                    sim = required(conn, db.simulations, simulation_id)
                    if sim["schedule"] != key:
                        raise ValueError("Simulation belongs to another schedule")
                if record["payload"]["high_risk"] and not simulation_id:
                    raise ValueError("This scenario requires a simulation reference")
                if record["payload"]["high_risk"] and (
                    not sim["payload"]["config"]["uncertain"]
                    or sim["payload"]["config"]["runs"] < 10
                ):
                    raise ValueError(
                        "High-risk approval requires at least 10 uncertain replications"
                    )
                target = "APPROVED"
            elif action == "release":
                if state == "RELEASED":
                    return {"schedule": key, "state": state}
                if state != "APPROVED":
                    raise ValueError("Release requires planner approval")
                parent = record["parent"]
                if record["payload"]["replan"] and (
                    not parent or required(conn, db.schedules, parent)["state"] != "RELEASED"
                ):
                    raise ValueError("Rescheduling parent has been superseded")
                conn.execute(
                    db.schedules.update()
                    .where(db.schedules.c.state == "RELEASED")
                    .values(state="SUPERSEDED")
                )
                target = "RELEASED"
            elif action == "reject" and state == "REJECTED":
                return {"schedule": key, "state": state}
            elif action == "reject" and state in ("DRAFT", "VALIDATED", "SIMULATED", "APPROVED"):
                target = "REJECTED"
            else:
                raise ValueError("Invalid schedule transition")
            changed = conn.execute(
                db.schedules.update()
                .where(db.schedules.c.id == key, db.schedules.c.state == state)
                .values(state=target)
            ).rowcount
            if changed != 1:
                raise ValueError("Schedule state changed concurrently")
            log = {
                "action": action,
                "identity": identity,
                "at": now(),
                "simulation": simulation_id,
                "state": target,
                "validated": not record["payload"]["validation"],
            }
            db.put(conn, db.approvals, uid(), log, schedule=key)
        return {"schedule": key, **log}
