# Operations guide

Run one application process. Set FORGEWORKS_DATABASE_URL and FORGEWORKS_MODEL_DIR to choose persistent paths. The Docker entry point applies Alembic migrations and starts the API. Docker Compose exposes SQLite on 8000. The postgres profile exposes its PostgreSQL-backed API on 8001.

```bash
docker build -t forgeworks:local .
docker compose up --build
docker compose --profile postgres up --build api-postgres
```

A managed network using a private CA can supply its trust bundle as a BuildKit secret.

```bash
docker build --secret id=build_ca,src=/etc/ssl/certs/ca-certificates.crt -t forgeworks:local .
```

```bash
python -m forgeworks generate --scenario normal --seed 42 --count 6
python -m forgeworks train
python -m forgeworks promote --model MODEL_ID
python -m forgeworks predict --order-id ORD-105
python -m forgeworks optimize --seconds 8
python -m forgeworks validate --schedule-id SCHEDULE_ID
python -m forgeworks simulate --schedule-id SCHEDULE_ID --runs 300
python -m forgeworks explain --schedule-id SCHEDULE_ID --order-id ORD-105
python -m forgeworks what-if --schedule-id SCHEDULE_ID --event examples/add-shift.json --runs 100
python -m forgeworks approve --schedule-id SCHEDULE_ID --identity planner --simulation-id SIMULATION_ID
python -m forgeworks release --schedule-id SCHEDULE_ID --identity planner
python -m forgeworks reschedule --schedule-id SCHEDULE_ID --event examples/breakdown.json --at 300 --runs 100
python -m forgeworks export --schedule-id SCHEDULE_ID --output plan.zip
```

Set FORGEWORKS_PLANNER_TOKEN before approval or release. Valid schedules start VALIDATED, may advance to SIMULATED, and need APPROVED before RELEASED. A subsequent release marks the previous active plan SUPERSEDED. Failed solves stay DRAFT. Rejection is available for unreleased versions. High-risk approval requires a referenced uncertain simulation of at least ten replications.

Replanning freezes setup-started work and commitments before the option cutoff. In-progress work keeps its scheduled bounds and can conflict with an outage. A failed replan preserves the source. The active lineage is checked when releasing a replan. Feedback can be submitted using record-execution and supports reviewed retraining. Keep local model files trusted.

Run the PostgreSQL integration scenario against a fresh disposable Compose project.

```bash
export FORGEWORKS_PLANNER_TOKEN=local-compose-planner
docker compose -p forgeworks-review up -d --build --wait api-postgres
docker compose -p forgeworks-review exec -T api-postgres alembic check
python examples/compose_smoke.py
docker compose -p forgeworks-review down --volumes
```

The smoke script records fixture jobs and releases both an initial plan and a breakdown replan. Use a fresh project when repeating it because its idempotency keys are fixed and the test expects a new workflow. The final command deletes the disposable database.
