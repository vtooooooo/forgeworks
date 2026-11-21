"""Factory contracts. All intervals are half-open integer minutes from the UTC epoch."""

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, model_validator

EPOCH = datetime(2026, 1, 5, 11, tzinfo=UTC)
FACTORY_ZONE = ZoneInfo("America/New_York")


def timestamp(minute: int) -> str:
    return (EPOCH + timedelta(minutes=minute)).isoformat()


class Record(BaseModel):
    model_config = {"extra": "forbid", "frozen": True}


class Window(Record):
    start: int = Field(ge=0)
    end: int = Field(gt=0)

    @model_validator(mode="after")
    def ordered(self):
        if self.end <= self.start:
            raise ValueError("window end must follow start")
        return self


class Machine(Record):
    id: str
    department: str
    capabilities: tuple[str, ...]
    families: tuple[str, ...]
    shifts: tuple[Window, ...]
    maintenance: tuple[Window, ...] = ()
    rate: float = Field(gt=0)
    condition: float = Field(ge=0, le=1)
    cost_per_hour: float = Field(ge=0)
    overtime: bool = True
    capacity: int = Field(gt=0)


class Product(Record):
    id: str
    family: str
    material: str
    units: int = Field(gt=0)
    route: tuple[str, ...] = Field(min_length=1)


class Order(Record):
    id: str
    product: str
    quantity: int = Field(gt=0, le=5000)
    release: int = Field(ge=0)
    due: int = Field(ge=0)
    priority: int = Field(ge=1, le=10)
    customer: str = "standard"
    status: Literal["open"] = "open"
    hard_due: bool = False


class Receipt(Record):
    id: str
    material: str
    at: int = Field(ge=0)
    quantity: int = Field(gt=0)


class Factory(Record):
    seed: int
    name: str
    horizon: int = Field(gt=0)
    machines: tuple[Machine, ...]
    products: tuple[Product, ...]
    orders: tuple[Order, ...]
    inventory: dict[str, int]
    receipts: tuple[Receipt, ...]
    variability: float = Field(ge=0)
    outages: dict[str, tuple[Window, ...]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def references(self):
        for records in (self.orders, self.machines, self.products, self.receipts):
            if len({row.id for row in records}) != len(records):
                raise ValueError("duplicate ID")
        products = {p.id for p in self.products}
        if any(o.product not in products for o in self.orders):
            raise ValueError("unknown order product")
        if (
            any(p.material not in self.inventory for p in self.products)
            or any(r.material not in self.inventory for r in self.receipts)
            or min(self.inventory.values(), default=0) < 0
        ):
            raise ValueError("invalid materials")
        if self.outages.keys() - {m.id for m in self.machines}:
            raise ValueError("unknown outage machine")
        return self

    @property
    def version(self) -> str:
        return sha256(self.model_dump_json().encode()).hexdigest()


class Operation(Record):
    order: str
    stage: int
    machine: str
    setup_start: int
    start: int
    end: int

    @property
    def key(self) -> tuple[str, int]:
        return self.order, self.stage


class Weights(Record):
    tardiness: int = Field(default=20, ge=1, le=1000)
    makespan: int = Field(default=1, ge=1, le=1000)
    setup: int = Field(default=1, ge=0, le=1000)
    move: int = Field(default=2, ge=0, le=1000)
    reassign: int = Field(default=30, ge=0, le=1000)


DEFAULT_WEIGHTS = Weights()


class Plan(Record):
    method: str
    status: str
    operations: tuple[Operation, ...] = ()
    completion: dict[str, int] = Field(default_factory=dict)
    tardiness: dict[str, int] = Field(default_factory=dict)
    objective: int | None = None
    bound: float | None = None
    gap: float | None = None
    seconds: float
    weights: Weights = Weights()
    detail: str = ""
    limit_seconds: float | None = None
    solver_seed: int | None = None


def windows(machine: Machine, horizon: int, extra: tuple[Window, ...] = ()):
    merged: list[tuple[int, int]] = []
    for shift in sorted(machine.shifts, key=lambda window: window.start):
        if merged and shift.start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], shift.end))
        else:
            merged.append((shift.start, shift.end))
    blocks = sorted((*machine.maintenance, *extra), key=lambda window: window.start)
    for start, end in merged:
        end = min(end, horizon)
        for block in blocks:
            if block.end <= start or block.start >= end:
                continue
            if start < block.start:
                yield start, block.start
            start = max(start, block.end)
        if start < end:
            yield start, end


def eligible(machine: Machine, product: Product, stage: int, quantity: int) -> bool:
    return (
        product.route[stage] in machine.capabilities
        and product.family in machine.families
        and quantity <= machine.capacity
    )


def setup(previous: str | None, following: str) -> int:
    if previous is None:
        return 5
    if previous == following:
        return 0
    return 8 + (sum(map(ord, previous)) * 3 + sum(map(ord, following))) % 9


def erp(product: Product, stage: int, quantity: int) -> float:
    return 10 + (5 + stage * 3) * quantity / 5 + 2 * len(product.family)
