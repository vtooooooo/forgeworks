# Command center integration plan

The frontend builds on main at `cae9760`, which contains the reviewed FastAPI backend. The API reference, Pydantic contracts, persisted 40-order rerun, architecture, operations guide and current deployment were checked before implementation.

| Existing contract | Console use |
|---|---|
| GET /health | Database health check |
| GET /schedules/{id}, POST /schedules/{id}/validate | Immutable operations, solver metadata, independent validation |
| GET /machines, GET /orders | Planning inputs scoped by dataset ID |
| POST /schedules/optimize | OptimizeRequest, includes fixed assignment scope |
| POST /schedules/{id}/simulate, GET /schedules/{id}/risk | SimulationConfig, metrics and per-order risk |
| POST /predictions/durations, GET /models | Model version, estimates, intervals and synthetic evaluations |
| POST /copilot/query | Deterministic structured tools and optional provider |
| POST /scenarios/what-if, POST /schedules/{id}/reschedule | Discriminated change payload and persisted isolated comparison |
| POST /schedules/{id}/approve, /release, /reject | Backend state machine with planner token |
| GET /schedules/{id}/export, GET /benchmarks | Persisted downloads and benchmark index |

Optimization, simulation and scenarios return HTTP 202 with a job ID. Poll GET /jobs/{id} for terminal state. Send one idempotency key for each submission. A successful job may contain UNKNOWN or INFEASIBLE solver status. The frontend never equates job completion with valid production output.

The API has no schedule discovery or simulation series endpoint and does not publish response models for all legacy reads. Add narrowly scoped typed console reads for catalog, selected schedule context, realized replication series, prediction comparisons and historical group measurements. Use OpenAPI-generated types for typed contracts. Existing services continue to own optimization, simulation, releases and explanation logic.

Same-origin reverse proxying avoids CORS and keeps approval credentials on the server. An explicit local console setting enables a guarded route that delegates to the existing transition service. The public read-only setting disables state-changing requests and records no copilot interactions. Compose binds the interactive console to loopback.

The interview fixture restores persisted synthetic runs, risk evidence, model registry and trusted model artifact from the verified 40-order rerun. It initializes only a separate empty demo database. Live jobs share the same backend implementation. Completed real orders and live disruptions are unavailable in this synthetic environment. Distinguish nominal schedule lateness, simulation-estimated risk, and observed history.
