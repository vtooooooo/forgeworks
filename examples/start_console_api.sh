#!/bin/sh
set -eu
# This runner seeds a dedicated database. Specify a fresh directory to persist a demo across starts.
state_dir=${FORGEWORKS_CONSOLE_STATE:-$(mktemp -d)}
mkdir -p "$state_dir"
state_dir=$(cd "$state_dir" && pwd)
export FORGEWORKS_DATABASE_URL="sqlite:///$state_dir/console.db"
export FORGEWORKS_MODEL_DIR="$state_dir/models"
export FORGEWORKS_DEMO_SEED=1
export FORGEWORKS_CONSOLE_MODE=${FORGEWORKS_CONSOLE_MODE:-local}
python_executable=${FORGEWORKS_PYTHON:-python}
"$python_executable" -m alembic upgrade head
"$python_executable" examples/console_seed.py
if [ "${FORGEWORKS_CONSOLE_TEST_SCALE:-0}" = 1 ]; then
    "$python_executable" - <<'PYTHON'
from forgeworks.service import Service

service = Service()
dataset = service.generate(count=200, activate=False)["dataset"]
plan = service.optimize(dataset, model="erp", method="EDD")
if service.validate(plan["id"]):
    raise RuntimeError("Large browser test schedule could not be validated")
PYTHON
fi
exec "$python_executable" -m uvicorn forgeworks.api:app --host 127.0.0.1 --port "${FORGEWORKS_CONSOLE_API_PORT:-8000}"
