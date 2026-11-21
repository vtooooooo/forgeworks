"""SQLAlchemy repository; immutable input and schedule snapshots anchor all runs."""

import os
from contextlib import contextmanager

from sqlalchemy import (
    JSON,
    Column,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    event,
)
from sqlalchemy.engine import Connection

metadata = MetaData()
datasets = Table(
    "datasets",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("payload", JSON, nullable=False),
)


def master(name, *columns, links=None):
    return Table(
        name,
        metadata,
        Column("dataset", ForeignKey("datasets.id"), primary_key=True),
        Column("id", String(120), primary_key=True),
        *columns,
        Column("payload", JSON, nullable=False),
        *(
            ForeignKeyConstraint(["dataset", field], [f"{target}.dataset", f"{target}.id"])
            for field, target in (links or {}).items()
        ),
    )


products = master("products")
machines = master("machines")
materials = master("materials")
orders = master(
    "production_orders",
    Column("product_id", String(120), index=True, nullable=False),
    links={"product_id": "products"},
)
receipts = master(
    "material_receipts",
    Column("material_id", String(120), index=True, nullable=False),
    links={"material_id": "materials"},
)
capabilities = master(
    "machine_capabilities",
    Column("machine_id", String(120), index=True, nullable=False),
    links={"machine_id": "machines"},
)
calendars = master(
    "shift_calendars",
    Column("machine_id", String(120), index=True, nullable=False),
    links={"machine_id": "machines"},
)
maintenance = master(
    "maintenance_windows",
    Column("machine_id", String(120), index=True, nullable=False),
    links={"machine_id": "machines"},
)
routings = master(
    "routings",
    Column("product_id", String(120), index=True, nullable=False),
    links={"product_id": "products"},
)
stages = master(
    "routing_operations",
    Column("route_id", String(120), index=True, nullable=False),
    links={"route_id": "routings"},
)
bills = master(
    "bills_of_materials",
    Column("product_id", String(120), index=True, nullable=False),
    Column("material_id", String(120), index=True, nullable=False),
    links={"product_id": "products", "material_id": "materials"},
)
inventory = master(
    "inventory_balances",
    Column("material_id", String(120), nullable=False),
    links={"material_id": "materials"},
)
history = master("execution_events", Column("at", Integer, index=True))
models = Table(
    "model_versions",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("dataset", ForeignKey("datasets.id"), index=True, nullable=False),
    Column("payload", JSON, nullable=False),
)
training = Table(
    "training_runs",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("model", ForeignKey("model_versions.id"), nullable=False, index=True),
    Column("payload", JSON, nullable=False),
)
schedules = Table(
    "scheduling_runs",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("dataset", ForeignKey("datasets.id"), nullable=False, index=True),
    Column("model", ForeignKey("model_versions.id"), index=True),
    Column("parent", ForeignKey("scheduling_runs.id"), index=True),
    Column("state", String(24), nullable=False),
    Column("payload", JSON, nullable=False),
)


def linked(name):
    return Table(
        name,
        metadata,
        Column("id", String(100), primary_key=True),
        Column("schedule", ForeignKey("scheduling_runs.id"), nullable=False, index=True),
        Column("payload", JSON, nullable=False),
    )


operations = linked("scheduled_operations")
simulations = linked("simulation_runs")
outcomes = Table(
    "simulation_outcomes",
    metadata,
    Column("id", String(100), primary_key=True),
    Column("simulation", ForeignKey("simulation_runs.id"), nullable=False, index=True),
    Column("payload", JSON, nullable=False),
)
scenarios = linked("what_if_scenarios")
interactions = linked("copilot_interactions")
approvals = linked("planner_approvals")
rescheduling = linked("rescheduling_events")
settings = Table(
    "settings",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("payload", JSON, nullable=False),
)
jobs = Table(
    "jobs",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("payload", JSON, nullable=False),
)
benchmarks = Table(
    "benchmarks",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("payload", JSON, nullable=False),
)


def engine(url=None):
    result = create_engine(url or os.getenv("FORGEWORKS_DATABASE_URL", "sqlite:///forgeworks.db"))
    if result.dialect.name == "sqlite":

        @event.listens_for(result, "connect")
        def sqlite_constraints(dbapi, _):
            dbapi.execute("PRAGMA foreign_keys=ON")
            dbapi.execute("PRAGMA busy_timeout=10000")

    return result


class Store:
    def __init__(self, url=None):
        self.engine = engine(url)
        metadata.create_all(self.engine)

    @contextmanager
    def transaction(self, write=False):
        with self.engine.begin() as conn:
            if write and conn.dialect.name == "sqlite":
                conn.exec_driver_sql("BEGIN IMMEDIATE")
            elif write and conn.dialect.name == "postgresql":
                conn.exec_driver_sql("SELECT pg_advisory_xact_lock(462481316)")
            yield conn


def row(conn: Connection, table: Table, key: str):
    return conn.execute(table.select().where(table.c.id == key)).mappings().first()


def put(conn: Connection, table: Table, key: str, payload, **fields):
    conn.execute(table.insert().values(id=key, payload=payload, **fields))


def setting(conn: Connection, key: str, value):
    if (
        conn.execute(settings.update().where(settings.c.id == key).values(payload=value)).rowcount
        == 0
    ):
        put(conn, settings, key, value)
