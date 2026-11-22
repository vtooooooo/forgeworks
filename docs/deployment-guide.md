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

## Public recruiter release

The public build uses the React console and immutable JSON and ZIP assets produced at build time by the existing Python/FastAPI fixture. It preserves timeline exploration, schedule versions, both historical shifts, simulation replications and version comparisons. The deterministic copilot answers are emitted by the existing backend and exposed as structured choices. Live free-text requests, optimization, simulation, new scenarios, and planner transitions are disabled. The public artifact has no HTTP mutation routes, planner secrets, executable model files or database.

The browser fetches relative, same-origin assets over HTTPS. Cross-origin API access is unnecessary. Hash routes support refresh and deep links even on hosts without SPA rewrites. Health in System Information reflects access to the exported evidence index. There is no live database or process to wake on restart. The synthetic fixture and build workflow are the durable source. Do not publish assets from a production database.

Cloudflare Pages Free allows 500 builds per month, up to 20 minutes per build, and individual assets up to 25 MiB. Its static hosting fits this release. Render can run FastAPI, while its free services sleep after 15 idle minutes and lack persistent disks. Vercel supports FastAPI as a single function, subject to its Python bundle and execution limits. A separate Python service would be useful for live workflows and unnecessary for the public read-only experience. The existing repository's Pages settings could not be enabled using the available GitHub integration. [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/) · [Render Free services](https://render.com/docs/free) · [Vercel FastAPI](https://vercel.com/docs/frameworks/backend/fastapi) · [Vercel function limits](https://vercel.com/docs/functions/limitations)

### Maintenance and alternate hosting

The **Public recruiter demo** GitHub workflow tests the snapshot and publishes the `forgeworks-public-demo` build artifact. For an alternate Cloudflare Pages deployment, download that artifact from Actions, then create a Pages **Direct Upload** project in the Cloudflare dashboard and upload the ZIP. The dashboard assigns the exact `pages.dev` URL. A local toolchain is unnecessary for that path. Run the same workflow's optional published-origin smoke test when available and share the URL after it passes.

To update data, first review a new verified synthetic fixture, then rebuild and redeploy the entire artifact from a single revision. Never upload the working tree, temporary SQLite database, or trusted model pickle. The publisher only needs the static build directory. The local full-stack Compose workflow remains available for authorized planning exercises.
