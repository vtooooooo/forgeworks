from itertools import pairwise

import pytest

from forgeworks.domain import Factory, Machine, Operation, Order, Product, Receipt, Window
from forgeworks.generation import generate, history
from forgeworks.ml import SCHEMA, inputs, train
from forgeworks.optimization import optimize, standard
from forgeworks.simulation import SimulationConfig, replay, simulate
from forgeworks.validation import validate


@pytest.fixture
def tiny():
    m = Machine(
        id="M-01",
        department="Cut",
        capabilities=("cut",),
        families=("a", "b"),
        shifts=(Window(start=0, end=180),),
        rate=1,
        condition=1,
        cost_per_hour=60,
        capacity=100,
    )
    p = Product(id="P", family="a", material="stock", units=1, route=("cut",))
    o = Order(id="A", product="P", quantity=1, release=0, due=20, priority=1)
    return Factory(
        seed=2,
        name="test",
        horizon=180,
        machines=(m,),
        products=(p,),
        orders=(o,),
        inventory={"stock": 1},
        receipts=(),
        variability=0.2,
    )


def test_known_optimum_and_empty(tiny):
    durations = {("A", 0, "M-01"): 10}
    plan = optimize(tiny, durations, seconds=3)
    assert plan.status == "OPTIMAL"
    assert plan.objective == 20 and plan.bound == 20 and plan.gap == 0
    assert plan.operations[0].start == 5
    assert not validate(tiny, plan, durations)
    empty = tiny.model_copy(update={"orders": ()})
    assert optimize(empty, {}).objective == 0


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"machine": "bad"}, "REFERENCE"),
        ({"setup_start": 4}, "SETUP"),
        ({"setup_start": -1}, "HORIZON"),
        ({"end": 178}, "DURATION"),
    ],
)
def test_validator_corruption(tiny, changes, code):
    durations = {("A", 0, "M-01"): 10}
    plan = optimize(tiny, durations)
    corrupt = plan.model_copy(
        update={"operations": (plan.operations[0].model_copy(update=changes),)}
    )
    assert code in {v["code"] for v in validate(tiny, corrupt, durations)}


def test_calendars_and_frozen(tiny):
    durations = {("A", 0, "M-01"): 10}
    plan = optimize(tiny, durations)
    op = plan.operations[0]
    modified = plan.model_copy(
        update={"operations": (op.model_copy(update={"setup_start": 10, "start": 15, "end": 25}),)}
    )
    assert "FROZEN" in {v["code"] for v in validate(tiny, modified, durations, (op,))}
    for field, windows in [
        ("shifts", (Window(start=0, end=9),)),
        ("maintenance", (Window(start=2, end=100),)),
    ]:
        changed = tiny.model_copy(
            update={"machines": (tiny.machines[0].model_copy(update={field: windows}),)}
        )
        assert "CALENDAR" in {v["code"] for v in validate(changed, plan, durations)}
    assert optimize(changed, durations, frozen=(op,)).status == "INFEASIBLE"


def test_material_reservoir_and_timeout(tiny):
    second = tiny.orders[0].model_copy(update={"id": "B"})
    constrained = tiny.model_copy(
        update={
            "orders": (*tiny.orders, second),
            "receipts": (Receipt(id="R", material="stock", at=45, quantity=1),),
        }
    )
    durations = {("A", 0, "M-01"): 10, ("B", 0, "M-01"): 10}
    for method in ("FCFS", "EDD", "SPT", "CP-SAT"):
        plan = optimize(constrained, durations, method)
        assert sorted(o.start for o in plan.operations) == [5, 45]
        assert not validate(constrained, plan, durations)
        assert "MATERIAL" in {
            v["code"]
            for v in validate(constrained.model_copy(update={"receipts": ()}), plan, durations)
        }
    assert (
        optimize(constrained.model_copy(update={"receipts": ()}), durations).status == "INFEASIBLE"
    )
    assert optimize(constrained, durations, seconds=1e-9).status == "UNKNOWN"
    assert optimize(tiny, {}).status == "INFEASIBLE"


def test_validate_overlap_precedence_and_missing(tiny):
    product = tiny.products[0].model_copy(update={"route": ("cut", "cut")})
    instance = tiny.model_copy(update={"products": (product,)})
    durations = {("A", i, "M-01"): 10 for i in range(2)}
    plan = optimize(instance, durations)
    assert not validate(instance, plan, durations)
    good, next_op = sorted(plan.operations, key=lambda x: x.stage)
    clash = next_op.model_copy(update={"setup_start": 7, "start": 7, "end": 17})
    bad = plan.model_copy(update={"operations": (good, clash)})
    assert {"OVERLAP", "PRECEDENCE"} <= {v["code"] for v in validate(instance, bad, durations)}
    assert "OPERATION_COUNT" in {
        v["code"]
        for v in validate(instance, plan.model_copy(update={"operations": (good,)}), durations)
    }


def test_simultaneous_receipt_zero_uncertainty_and_replay(tiny):
    f = tiny.model_copy(
        update={
            "inventory": {"stock": 0},
            "receipts": (Receipt(id="R", material="stock", at=5, quantity=1),),
        }
    )
    d = {("A", 0, "M-01"): 10}
    p = optimize(f, d)
    zero = simulate(f, p, SimulationConfig(runs=2, uncertain=False, trace=True))
    assert zero["replications"][0]["operations"] == [p.operations[0].model_dump()]
    config = SimulationConfig(
        runs=5, seed=43, receipt_delay_probability=1, breakdown_probability=0, trace=True
    )
    first = simulate(f, p, config)
    assert first == simulate(f, p, config)
    assert all(row["operations"][0]["start"] >= 35 for row in first["replications"])


def test_breakdown_shifts_and_actual_resources(tiny):
    f = tiny.model_copy(update={"outages": {"M-01": (Window(start=0, end=100),)}})
    p = optimize(f, {("A", 0, "M-01"): 10})
    config = SimulationConfig(runs=1, seed=1, breakdown_probability=0, trace=True)
    trace = replay(f, p, config, 0)
    op = Operation.model_validate(trace["operations"][0])
    assert op.setup_start >= 100 and op.end <= 180


def test_factory_reproducibility_and_no_leakage():
    f = generate(count=12)
    assert f == generate(count=12)
    assert f.version != generate(seed=1, count=12).version
    rows = history(f, 500)
    assert set(inputs(rows[0])) == set(SCHEMA)
    assert {"at", "duration", "shift"}.isdisjoint(inputs(rows[0]))
    assert all(r["at"] < 0 for r in rows)
    _, evaluation = train(rows)
    assert sum(evaluation["split_sizes"]) == 500
    assert all("synthetic_shift_stress" in model for model in evaluation["models"].values())
    ideal_erp = [{**row, "duration": row["erp"]} for row in rows]
    bundle, report = train(ideal_erp)
    assert not report["eligible_for_promotion"] and bundle["selected"] == "erp"


def test_multi_order_uncertain_trace_has_no_physical_conflicts():
    f = generate("multiple", count=8)
    p = optimize(f, standard(f), "EDD")
    assert not validate(f, p, standard(f))
    cfg = SimulationConfig(
        runs=3, seed=70, breakdown_probability=0, receipt_delay_probability=0, trace=True
    )
    for replication in simulate(f, p, cfg)["replications"]:
        ops = tuple(Operation.model_validate(r) for r in replication["operations"])
        for machine in f.machines:
            ordered = sorted(
                (o for o in ops if o.machine == machine.id), key=lambda x: x.setup_start
            )
            assert all(a.end <= b.setup_start for a, b in pairwise(ordered))
            for trace in replication["processing"]:
                if trace["machine"] == machine.id:
                    assert all(
                        not (b.start < last and first < b.end)
                        for first, last in trace["segments"]
                        for b in (*machine.maintenance, *f.outages.get(machine.id, ()))
                    )
        for order in f.orders:
            ordered = sorted((o for o in ops if o.order == order.id), key=lambda x: x.stage)
            assert all(a.end <= b.setup_start for a, b in pairwise(ordered))


def test_breakdown_interrupts_active_processing(tiny):
    f = tiny.model_copy(update={"outages": {"M-01": (Window(start=7, end=30),)}})
    p = optimize(f, {("A", 0, "M-01"): 10})
    cfg = SimulationConfig(runs=1, seed=17, breakdown_probability=0, trace=True)
    row = replay(f, p, cfg, 0)
    trace = row["processing"][0]
    assert trace["segments"][0] == (5, 7)
    assert trace["segments"][1][0] == 30
    assert sum(b - a for a, b in trace["segments"]) == trace["active_minutes"]
