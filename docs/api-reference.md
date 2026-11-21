# API reference

Business paths are relative to /api/v1. Serve Swagger UI at /docs and the schema at /openapi.json.

| Group | Method and route |
|---|---|
| Health | GET /health at the root |
| Factory | POST /datasets, GET /machines, GET and POST /orders |
| Feedback | POST /execution |
| Models | GET /models, POST /models/train, POST /models/promote, POST /predictions/durations |
| Scheduling | POST /schedules/optimize, GET /schedules/{id}, POST /schedules/{id}/validate |
| Simulation | POST /schedules/{id}/simulate, GET /schedules/{id}/risk |
| Scenarios | POST /scenarios/what-if, POST /schedules/{id}/reschedule |
| Planner actions | POST /schedules/{id}/approve, /release, /reject |
| Copilot | POST /copilot/query |
| Exports | GET /schedules/{id}/export?format=zip |
| Jobs and benchmarks | GET /jobs/{id}, GET and POST /benchmarks, GET /benchmarks/{id} |

```bash
curl -s http://127.0.0.1:8000/api/v1/datasets \
  -H 'Content-Type: application/json' -d '{"scenario":"normal","seed":42,"count":6}'
curl -s http://127.0.0.1:8000/api/v1/schedules/optimize \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: planning-001' \
  -d '{"method":"CP-SAT","seconds":5}'
curl -s http://127.0.0.1:8000/api/v1/jobs/JOB_ID
curl -s http://127.0.0.1:8000/api/v1/copilot/query \
  -H 'Content-Type: application/json' \
  -d '{"schedule":"SCHEDULE_ID","question":"Why is Order 105 late?"}'
```

Long requests return HTTP 202 and a job ID. Poll for SUCCEEDED or FAILED. An UNKNOWN or INFEASIBLE solver status can appear in a successful job. Reusing an idempotency key with changed inputs returns 409. Queue exhaustion returns 429. Approval requires a planner identity and the X-Planner-Token header. Order creation forks a dataset and returns its ID for future requests.
