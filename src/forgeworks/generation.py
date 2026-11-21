"""Seeded instance and historical execution generation."""

import random
from math import exp
from typing import Literal

from .domain import Factory, Machine, Order, Product, Receipt, Window, eligible, erp

Scenario = Literal[
    "normal", "high-demand", "breakdown", "shortage", "urgent", "tight", "variable", "multiple"
]
OPERATIONS = ("cut", "rough", "finish", "drill", "assemble")
FAMILIES = ("bracket", "housing", "shaft", "enclosure", "fastener")
MATERIALS = ("steel", "aluminum", "alloy")


def generate(name: Scenario = "normal", seed: int = 42, count: int = 12) -> Factory:
    rng = random.Random(seed)
    days = 21 if count >= 100 else 10
    shifts = tuple(
        Window(start=d * 1440 + s, end=d * 1440 + s + 480)
        for d in range(days)
        if d % 7 < 5
        for s in (0, 510)
    )
    machines = tuple(
        Machine(
            id=f"M-{i + 1:02}",
            department=department,
            capabilities=capabilities,
            families=FAMILIES if i % 5 else FAMILIES[:-1],
            shifts=shifts,
            maintenance=(Window(start=240 + i * 12, end=285 + i * 12),),
            rate=rng.uniform(0.8, 1.25),
            condition=rng.uniform(0.4, 1),
            cost_per_hour=40 + i * 5,
            overtime=i % 4 != 0,
            capacity=100 + i * 2,
        )
        for i, (department, capabilities) in enumerate(
            [("Cutting", ("cut",))] * 4
            + [("Machining", ("rough", "drill"))] * 7
            + [("Finishing", ("finish", "assemble"))] * 5
        )
    )
    products = tuple(
        Product(
            id=f"SKU-{i + 1:02}",
            family=FAMILIES[i % 5],
            material=MATERIALS[i % 3],
            units=1 + i % 3,
            route=("cut", "rough")
            + (("drill",) if i % 2 else ())
            + ("finish",)
            + (("assemble",) if i % 4 == 1 else ()),
        )
        for i in range(50)
    )
    orders = []
    for i in range(count):
        release = rng.randrange(0, 240) if count < 100 else rng.randrange(0, 4500)
        due = (
            release + rng.randrange(120, 380)
            if name == "tight"
            else release + rng.randrange(400, 3400)
        )
        orders.append(
            Order(
                id=f"ORD-{i + 101}",
                product=rng.choice(products).id,
                quantity=rng.randint(8, 35 if name != "high-demand" else 65),
                release=release,
                due=due,
                priority=rng.randint(1, 5),
            )
        )
    if orders and name in ("urgent", "multiple"):
        orders[-1] = orders[-1].model_copy(
            update={"due": 420, "priority": 10, "customer": "urgent"}
        )
    demand = {
        material: sum(
            o.quantity * p.units
            for o in orders
            for p in products
            if p.id == o.product and p.material == material
        )
        for material in MATERIALS
    }
    limited = name in ("shortage", "multiple")
    inventory = {m: q // (5 if limited else 2) for m, q in demand.items()}
    receipts = tuple(
        Receipt(
            id=f"RC-{i}", material=m, at=1650 if limited else 230, quantity=q - inventory[m] + 20
        )
        for i, (m, q) in enumerate(demand.items())
    )
    return Factory(
        seed=seed,
        name=name,
        horizon=days * 1440,
        machines=machines,
        products=products,
        orders=tuple(orders),
        inventory=inventory,
        receipts=receipts,
        variability=0.30 if name in ("variable", "multiple") else 0.13,
        outages={"M-07": (Window(start=90, end=330),)} if name in ("breakdown", "multiple") else {},
    )


def features(product: Product, stage: int, quantity: int, machine: Machine) -> dict:
    return {
        "family": product.family,
        "operation": product.route[stage],
        "quantity": quantity,
        "machine": machine.id,
        "rate": machine.rate,
        "material": product.material,
        "condition": machine.condition,
        "erp": erp(product, stage, quantity),
    }


def actual(
    product: Product,
    stage: int,
    quantity: int,
    machine: Machine,
    shift: int,
    noise: float,
    rng: random.Random,
) -> float:
    family_factor = (
        (1.12, 0.86, 1.23, 0.98, 0.79)[FAMILIES.index(product.family)]
        if product.family in FAMILIES
        else 1
    )
    mean = erp(product, stage, quantity) * family_factor / machine.rate
    mean *= 1 + 0.42 * (1 - machine.condition) + 0.07 * shift
    return max(1, mean * exp(rng.gauss(-(noise**2) / 2, noise)))


def history(factory: Factory, count: int = 2400) -> list[dict]:
    rng = random.Random(factory.seed ^ 2718)
    rows = []
    for i in range(count):
        product = rng.choice(factory.products)
        stage = rng.randrange(len(product.route))
        quantity = rng.randint(5, 75)
        machine = rng.choice([m for m in factory.machines if eligible(m, product, stage, quantity)])
        shift = rng.randrange(2)
        row = features(product, stage, quantity, machine)
        row.update(
            shift=shift,
            at=i - count,
            duration=actual(product, stage, quantity, machine, shift, factory.variability, rng),
        )
        rows.append(row)
    return rows
