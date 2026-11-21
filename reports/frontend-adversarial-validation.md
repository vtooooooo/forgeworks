# Frontend adversarial validation

| Check | Evidence and observed behavior |
|---|---|
| Missing backend | Playwright interrupted the catalog request and verified the explicit failure state and retry against the real API. |
| Empty database or invalid version | Backend tests verified an empty catalog and HTTP 404 for unknown schedules. Browser tests recovered an invalid deep link through the active-version selector. |
| Solver without a solution | The browser submitted unrestricted CP-SAT for a 200-order factory, observed UNKNOWN from the construction guard, and showed an explicit record without a validated timeline. |
| Missing prediction and risk evidence | Console API tests checked an unknown simulation ID and absent historical observations. The frontend renders missing means and intervals as unavailable. |
| Disconnected or expired job | Playwright restored a nonexistent job ID and verified the error while leaving new optimization available. |
| Timeline and responsive layout | Actual Chromium screenshots captured persisted data. The mobile test verified document width at 390 pixels, with scrolling contained inside the timeline. A separate 715-operation plan rendered a clipped viewport and revealed different operations after scrolling. |
| Repeated submission and refresh | The real scenario flow reloaded after HTTP 202. The first browser pass exposed a source-version fallback that compared the result to the wrong parent. The corrected flow restores the persisted parent and uses the paired risk runs. The backend idempotency tests passed. |
| Invalid event input | Vitest rejects an unknown machine and a breakdown beyond the horizon. Python validators cover unsupported scenario inputs and constraint checking. |
| Unauthorized authority | The real browser request without trusted local headers returned 403. Backend tests denied cross-origin, cross-site, legacy-token, and read-only writes. |
| Corrupted release candidate | Existing tests revalidated the saved payload and prevented a tampered approved schedule from replacing the active plan. Console authorization calls that same implementation. |
| Read-only mutability | Backend tests blocked job creation, data writes, and release in read-only mode and verified that deterministic copilot queries did not append interactions. |
| Evidence and timezone | Vitest checked timezone conversion, evidence labels, and unknown status. Playwright displayed persisted prediction evidence, simulation distributions, planner decisions, and copilot references. |

The managed preview relay did not become available. Application screenshots and browser verification used the requested Playwright suite with the real FastAPI backend. An early rootless Docker build exhausted workspace disk, and a later boot found that the managed checkout’s private file modes prevented the non-root API user from reading migration assets. Combined image layers reduced temporary storage, and explicit read permissions allowed the non-root startup to complete. The repaired Compose stack passed the migration drift check and five packaged browser cases. The 715-operation case ran against the separately seeded local backend. The isolated reset was exercised after the browser suite changed the demo release. It restored exactly three precomputed 148-operation versions and the original active release. A built-asset scan found neither planner fixture values nor planner token identifiers.

This review covers the tested local and synthetic read-only boundaries. User authentication, production authorization, actual machine-state reconciliation, cross-browser coverage beyond Chromium, and field calibration remain outside the verified scope.
