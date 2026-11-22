"""Read-only evidence retrieval with a bounded optional provider interface."""

import re
from typing import Literal, Protocol

from pydantic import Field, ValidationError

from . import database as db
from .domain import Plan, Record, windows
from .service import Service, now, uid

ToolName = Literal[
    "get_order",
    "get_schedule",
    "get_machine_calendar",
    "explain_order_delay",
    "get_bottlenecks",
    "get_simulation_risk",
    "compare_schedules",
    "explain_assignment",
]


class Query(Record):
    schedule: str
    tool: ToolName | None = None
    question: str = Field(default="", max_length=1000)
    order: str | None = None
    machine: str | None = None
    other_schedule: str | None = None
    stage: int | None = Field(default=None, ge=0)


class ToolProvider(Protocol):
    def select(self, question: str, tools: tuple[str, ...]) -> dict: ...


TOOLS = (
    "get_order",
    "get_schedule",
    "get_machine_calendar",
    "explain_order_delay",
    "get_bottlenecks",
    "get_simulation_risk",
    "compare_schedules",
    "explain_assignment",
)


def resolve(request, provider):
    if request.tool:
        return request
    if provider:
        try:
            selection = provider.select(request.question, TOOLS)
            selected = Query.model_validate(
                {**selection, "schedule": request.schedule, "question": request.question}
            )
            if selected.tool:
                return selected
        except (TypeError, ValidationError, ValueError):
            pass
    text = request.question.lower()
    order = re.search(r"\b(?:ord[- ]?|order\s+)(\d+)\b", text)
    machine = re.search(r"\b(?:m[- ]?)(\d+)\b", text)
    if re.match(r"^why\s", text) and order and "late" in text:
        return request.model_copy(
            update={"tool": "explain_order_delay", "order": f"ORD-{order[1]}"}
        )
    if any(word in text for word in ("bottleneck", "utilization")) and re.match(
        r"^(which|what|show)", text
    ):
        return request.model_copy(update={"tool": "get_bottlenecks"})
    if ("risk" in text or "deadlines" in text) and re.match(r"^(which|what|show)", text):
        return request.model_copy(update={"tool": "get_simulation_risk"})
    if "calendar" in text and machine and re.match(r"^(which|what|show|get)", text):
        return request.model_copy(
            update={"tool": "get_machine_calendar", "machine": f"M-{int(machine[1]):02}"}
        )
    return request


def answer(
    service: Service, request: Query, provider: ToolProvider | None = None, *, persist: bool = True
):
    query = resolve(request, provider)
    run = service.schedule(query.schedule)
    factory = service.factory(run["dataset"])
    plan = Plan.model_validate(run["payload"]["plan"])
    orders = {o.id: o for o in factory.orders}
    machines = {m.id: m for m in factory.machines}
    evidence = {
        "schedule": run["id"],
        "dataset": run["dataset"],
        "solver_status": plan.status,
        "model": run["model"],
        "violations": run["payload"]["validation"],
    }
    classification = "verified_record"
    result: object
    if query.tool == "get_schedule":
        result = plan.model_dump()
    elif query.tool == "get_machine_calendar" and query.machine in machines:
        machine = machines[query.machine]
        result = {
            "machine": machine.model_dump(),
            "working_windows": list(windows(machine, factory.horizon)),
        }
    elif (
        query.tool in ("get_order", "explain_order_delay", "explain_assignment")
        and query.order in orders
    ):
        order = orders[query.order]
        ops = sorted(
            (op for op in plan.operations if op.order == order.id), key=lambda op: op.stage
        )
        if query.tool == "explain_assignment":
            chosen = next((op for op in ops if op.stage == query.stage), None)
            options = [
                r
                for r in run["payload"]["predictions"]
                if r["order"] == order.id and r["stage"] == query.stage
            ]
            classification = "observed_assignment"
            result = {
                "chosen": chosen.model_dump() if chosen else None,
                "eligible_estimates": options,
                "interpretation": "A forced-assignment counterfactual would quantify its tradeoff.",
            }
        else:
            context = []
            ready = order.release
            for op in ops:
                before = max(
                    (
                        other
                        for other in plan.operations
                        if other.machine == op.machine and other.end <= op.setup_start
                    ),
                    key=lambda x: x.end,
                    default=None,
                )
                context.append(
                    {
                        "operation": op.model_dump(),
                        "wait_after_release_or_predecessor": op.setup_start - ready,
                        "preceding_machine_operation": before.model_dump() if before else None,
                    }
                )
                ready = op.end
            result = {
                "order": order.model_dump(),
                "completion": plan.completion.get(order.id),
                "tardiness": plan.tardiness.get(order.id),
                "timeline": context,
                "material": next(p.material for p in factory.products if p.id == order.product),
                "classification": "observed_timeline",
            }
    elif query.tool == "get_bottlenecks":
        classification = "utilization_heuristic"
        workload = []
        for machine in factory.machines:
            capacity = sum(
                b - a for a, b in windows(machine, max(plan.completion.values(), default=0))
            )
            load = sum(
                op.end - op.setup_start for op in plan.operations if op.machine == machine.id
            )
            workload.append(
                {
                    "machine": machine.id,
                    "busy": load,
                    "available": capacity,
                    "utilization": load / capacity if capacity else 0,
                }
            )
        result = sorted(workload, key=lambda x: (-x["utilization"], x["machine"]))
    elif query.tool == "get_simulation_risk":
        classification = "simulation_estimate"
        try:
            risk = service.risk(query.schedule)
            result = {
                "simulation": risk["id"],
                "config": risk["config"],
                "orders": sorted(risk["risk"], key=lambda x: -x["p_late"]),
            }
        except LookupError:
            result, classification = {"reason": "No stored simulation"}, "unavailable"
    elif query.tool == "compare_schedules" and query.other_schedule:
        other = service.schedule(query.other_schedule)
        from .scenarios import difference

        if run["payload"]["validation"] or other["payload"]["validation"]:
            result, classification = {"reason": "Both plans must pass validation"}, "unavailable"
        else:
            result = {
                "other": other["id"],
                "other_dataset": other["dataset"],
                **difference(plan, Plan.model_validate(other["payload"]["plan"])),
            }
    else:
        classification = "unsupported"
        result = {
            "supported_tools": TOOLS,
            "scenario_endpoint": "/api/v1/scenarios/what-if",
            "reason": "Use a supported tool with its required order, machine, or schedule ID.",
        }
    response = {"classification": classification, "evidence": evidence, "result": result}
    if persist:
        with service.store.transaction(True) as conn:
            db.put(
                conn,
                db.interactions,
                uid(),
                {"query": request.model_dump(), "answer": response, "at": now()},
                schedule=query.schedule,
            )
    return response
