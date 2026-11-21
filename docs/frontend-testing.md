# Frontend testing

Install Python 3.12 dependencies and the Python package first. Use Node 24 and the frontend lockfile.

```bash
pip install -r requirements.lock
pip install --no-deps -e .
cd frontend
npm ci
npm run build
npm test
npx playwright install --with-deps chromium
npm run e2e
```

Set `FORGEWORKS_PYTHON` to the Python executable when it is outside PATH. The Playwright configuration boots an isolated SQLite backend and a Vite proxy. It imports the verified fixture so browser tests use real persisted data, jobs, comparisons and state transitions. To test a running Compose stack, use `FORGEWORKS_E2E_URL=http://127.0.0.1:4173 npm run e2e` with planner authorization enabled and a fresh demo project. The suite changes only that fixture. `FORGEWORKS_SCREENSHOTS` enables screenshot capture from the running app. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally selects an installed Chromium.

To regenerate API types from the checked-out backend:

```bash
python -c 'import json; from forgeworks.api import app; print(json.dumps(app.openapi()))' > /tmp/forgeworks-openapi.json
npm --prefix frontend run api:types
```

Backend tests cover authorization, read-only behavior, empty and invalid schedules, fixture restoration, and scoped simulation outcomes. Vitest covers formatting, normalization, scenario validation, evidence presentation and operation interactions. Playwright exercises all workspaces, keyboard operation detail, real optimization, validation, simulation, scenario job refresh, paired evidence, and explicit approval and release.
