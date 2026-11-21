# Command center deployment

## Local interview demo

```bash
docker compose -p forgeworks-console-demo --profile console up --build command-center
```

Visit `http://127.0.0.1:4173`. This starts a loopback Nginx frontend and a separate FastAPI service, migrates its dedicated SQLite volume and loads verified evidence. No CP-SAT solve is needed for the first view. For a trusted local exercise that includes live approvals, set `FORGEWORKS_CONSOLE_PLANNER_TOKEN` in the operator environment before starting Compose. The value is consumed by the API process. Live what-if and simulation are available in the local profile without approval authority.

To restore the interview fixture, stop and remove the dedicated demo project with `docker compose -p forgeworks-console-demo --profile console down --volumes`, then start it again. This command removes the disposable project's volume. Use the named demo project and keep operational volumes in another Compose project.

The existing `api` and `api-postgres` services retain their normal CLI and API workflows. PostgreSQL for a console deployment requires a separately configured database URL, migration, and production identity integration. The fixture loader is SQLAlchemy-based and only runs against an explicitly opted-in empty database. The standard console quickstart uses SQLite.

The local backend can also run without Docker using `sh examples/start_console_api.sh` and `npm --prefix frontend run dev` after installation. Set `FORGEWORKS_API_URL` on the Vite server if the backend uses a different origin. If a managed dependency proxy uses a private CA, provide a BuildKit secret named `build_ca` to both builds via a local Compose override.

## Public exposure

Use a dedicated synthetic instance with `FORGEWORKS_CONSOLE_MODE=read-only`. A hosted reverse proxy needs an explicit host and Origin allowlist. Expose only the read-only gateway and enforce request limits. Free static hosts can serve the React bundle, while queued optimization and persistence need a separate long-running process. The verified deliverable is the local Compose experience. No hosted infrastructure was deployed.
