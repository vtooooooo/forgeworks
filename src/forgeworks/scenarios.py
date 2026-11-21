"""Validated, isolated factory transformations."""

from typing import Annotated, Literal

from pydantic import Field, TypeAdapter

from .domain import Factory, Operation, Order, Record, Window


class MachineEvent(Record):
    kind: Literal[
        "overtime", "extend_shift", "move_maintenance", "maintenance_extension", "breakdown"
    ]
    machine: str
    start: int = Field(ge=0)
    end: int = Field(gt=0)
    index: int = Field(default=0, ge=0)


class OrderEdit(Record):
    kind: Literal["due_date", "quantity", "cancel"]
    order: str
    value: int = Field(default=0, ge=0, le=100000)


class Urgent(Record):
    kind: Literal["urgent_order"]
    order: Order


class MaterialDelay(Record):
    kind: Literal["receipt_delay"]
    receipt: str
    minutes: int = Field(gt=0, le=100000)


class Overrun(Record):
    kind: Literal["overrun"]
    order: str
    stage: int = Field(ge=0)
    minutes: int = Field(gt=0, le=10000)


Change = Annotated[
    MachineEvent | OrderEdit | Urgent | MaterialDelay | Overrun, Field(discriminator="kind")
]
change_adapter = TypeAdapter(Change)


def apply(factory: Factory, change: Change, frozen: tuple[Operation, ...] = ()) -> Factory:
    data = factory.model_dump()
    if isinstance(change, MachineEvent):
        window = Window(start=change.start, end=change.end)
        machine = next((m for m in data["machines"] if m["id"] == change.machine), None)
        if machine is None or window.end > factory.horizon:
            raise ValueError("Unknown machine or interval outside the horizon")
        if change.kind in ("overtime", "extend_shift"):
            if not machine["overtime"]:
                raise ValueError("Machine is not eligible for overtime")
            shifts = list(machine["shifts"])
            if change.kind == "extend_shift":
                if change.index >= len(shifts):
                    raise ValueError("Unknown shift index")
                previous = shifts[change.index]
                if window.start > previous["start"] or window.end < previous["end"]:
                    raise ValueError("Extended shift must include the original shift")
                shifts[change.index] = window.model_dump()
            else:
                shifts.append(window.model_dump())
            machine["shifts"] = shifts
        else:
            blocks = list(machine["maintenance"])
            if change.kind != "breakdown":
                if change.index >= len(blocks):
                    raise ValueError("Unknown maintenance index")
                previous = blocks[change.index]
                if change.kind == "maintenance_extension" and (
                    window.start > previous["start"] or window.end < previous["end"]
                ):
                    raise ValueError("Extension must include the original maintenance window")
                blocks[change.index] = window.model_dump()
            else:
                blocks.append(window.model_dump())
            machine["maintenance"] = blocks
            # A realized disruption is no longer a separate stochastic scenario event.
            if change.kind == "breakdown":
                data["outages"].pop(change.machine, None)
    elif isinstance(change, Urgent):
        data["orders"] = (*data["orders"], change.order.model_dump())
    elif isinstance(change, OrderEdit):
        order = next((o for o in data["orders"] if o["id"] == change.order), None)
        if order is None:
            raise ValueError("Unknown order")
        if change.kind in ("cancel", "quantity") and any(x.order == change.order for x in frozen):
            raise ValueError("Cancellation or quantity change would alter protected work")
        if change.kind == "cancel":
            data["orders"] = tuple(o for o in data["orders"] if o["id"] != change.order)
        else:
            order["due" if change.kind == "due_date" else "quantity"] = change.value
    elif isinstance(change, MaterialDelay):
        receipt = next((r for r in data["receipts"] if r["id"] == change.receipt), None)
        if receipt is None:
            raise ValueError("Unknown receipt")
        receipt["at"] += change.minutes
    return Factory.model_validate(data)


def difference(old, new):
    before = {op.key: op for op in old.operations}
    after = {op.key: op for op in new.operations}
    shared = sorted(before.keys() & after.keys())
    moved = [
        {
            "order": key[0],
            "stage": key[1],
            "minutes": after[key].start - before[key].start,
            "old_machine": before[key].machine,
            "new_machine": after[key].machine,
        }
        for key in shared
        if before[key] != after[key]
    ]
    return {
        "moved": moved,
        "reassignments": sum(x["old_machine"] != x["new_machine"] for x in moved),
        "absolute_movement_minutes": sum(abs(x["minutes"]) for x in moved),
        "added": sorted(after.keys() - before.keys()),
        "removed": sorted(before.keys() - after.keys()),
        "completion_change": {
            o: new.completion[o] - old.completion[o]
            for o in sorted(old.completion.keys() & new.completion.keys())
        },
        "additional_tardiness": sum(new.tardiness.values()) - sum(old.tardiness.values()),
        "seconds": new.seconds,
    }
