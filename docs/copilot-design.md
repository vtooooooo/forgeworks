# Planning copilot

Structured tools fetch orders, schedules, machine calendars, utilization, duration estimates for candidate machines, delivery risk and schedule comparisons. A delay answer exposes due date, completion, gaps after readiness and the preceding booked job. Utilization measures scheduled occupancy. These records can motivate a causal scenario comparison.

Local text matching covers delay, utilization, risk and machine calendars. The optional OpenAI-compatible provider receives the question and declared tool schema, and returns a tool selection. The application validates its arguments and produces the result from persisted evidence. Set the full endpoint, model and key through the environment.

Use the typed what-if endpoint for overtime, extending shifts, due-date changes, urgent orders, quantity changes, cancellation, maintenance changes, outages, shipment delay and duration overruns. Alternatives preserve the source plan. Approval and release require explicit planner calls with the local token.
