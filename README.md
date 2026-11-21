# ForgeWorks AI

ForgeWorks is a local production-planning backend for a synthetic precision-metal factory. It estimates processing durations, solves and independently validates flexible job-shop schedules, evaluates delivery risk in a digital twin, and records planner approval and release. The CLI and REST API use the same services.

## Quickstart

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock
pip install --no-deps -e .
alembic upgrade head
python -m forgeworks generate --scenario normal --seed 42 --count 6
python -m forgeworks optimize --seconds 5
uvicorn forgeworks.api:app --host 127.0.0.1 --port 8000
```

The local [Swagger UI](http://127.0.0.1:8000/docs) shows typed requests and job polling. The default SQLite file is `forgeworks.db`.

```bash
export FORGEWORKS_PLANNER_TOKEN=local-demo-only
python examples/demo.py --output demo-output --runs 300 --seconds 8
python -m forgeworks benchmark --count 6 --runs 100 --seconds 5 --scale \
  --output demo-output/benchmark-results.json
```

The demo writes exports, validation evidence, approval records, paired Monte Carlo comparisons, and execution feedback. Dataset contents and Monte Carlo draws are seed-reproducible. Run IDs, wall time and time-limited solver incumbents can vary. The planner token is a demonstration control for localhost or a trusted internal network.

| Topic | Reference |
|---|---|
| Results and audit | [Delivery report](reports/final-delivery.md), [Adversarial audit](reports/final-adversarial-validation.md) |
| Factory and workflow | [Business case](docs/business-case.md), [Architecture](docs/system-architecture.md), [Data model](docs/data-model.md) |
| Modeling | [Duration prediction](docs/ml-methodology.md), [Optimization](docs/optimization-model.md), [Digital twin](docs/digital-twin.md) |
| Planner use | [Copilot](docs/copilot-design.md), [API](docs/api-reference.md), [Operations](docs/operations-guide.md) |
| Scope | [Limitations](docs/limitations.md), [Case study](docs/portfolio-case-study.md) |
