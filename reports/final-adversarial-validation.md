# Adversarial validation

## Follow-up production-readiness audit

| Risk | Test and observed result |
|---|---|
| Quadratic model construction | Isolated before-and-after measurements used separate processes, five-second solver budgets, protobuf counts and process peak RSS. Unrestricted 200-order search reached UNKNOWN with the guard raised. Fixed dispatch assignments found a valid 715-operation plan at roughly 244 MiB peak RSS. Its objective tied EDD. |
| Sequence and capacity semantics | Both setup formulations passed directional changeover checks with a hand-computed ten-minute transition. A corrupt setup was flagged for both overlap and setup duration. A restricted solve preserved a frozen machine assignment and all timestamps. A downtime conflict produced no restricted plan. |
| Timeouts | A sub-microsecond search budget produced UNKNOWN with an empty schedule and recorded model statistics. The independent validator rejects UNKNOWN as having no solution. |
| Stock, recovery and paired draws | Across four paired replications, alternate machine assignments shared sampled receipt and outage draws. Competing orders waited for available stock, intervals avoided outage periods, and processing held its machine across repair. An independent 30-replication replay of the same persisted 40-order plan was byte-identical against the prior implementation for unchanged inputs. |
| Chronology | Training formerly assigned fresh ranks to execution records. This could separate identical recorded times across splits. It now preserves timestamps and keeps ties together. Perturbing final-partition outcomes did not affect fitted predictions, candidate selection or calibration radii. All published MAE and coverage figures reproduced. |
| Persisted what-if evidence | A duration overrun previously changed the optimizer inputs while uncertain replay sampled the original demand. The changed duration is now persisted and included in the twin's demand. A regression test verified the exact difference under shared draws, grounded risk in the stored simulation, and verified the original released row was unchanged. |
| Invalid release | Approval and release now revalidate canonical saved plan data inside the write transaction. A tampered approved plan and an empty plan could not replace an active schedule. Foreign, deterministic and undersized risk evidence failed high-risk approval. |
| Short-budget regression | Applying compact setup equalities to small unrestricted schedules changed the ERP benchmark's nominal weighted tardiness from 849 to 857, and holdout mean weighted tardiness from 2,668.36 to 3,233.65. The final implementation keeps the original small formulation. The final rerun reproduced both original ERP values. |
| Docker and PostgreSQL | Hosted Docker Compose started PostgreSQL 16 and the API, reached revision 0001, passed Alembic schema drift checks, and completed the persisted scheduling, risk, evidence, what-if, approval, release, replan and export workflow. [CI evidence](https://github.com/vtooooooo/forgeworks/actions/runs/44951353364) |

Ruff, mypy and all 28 pytest cases passed locally. The sole test warning was the existing Starlette HTTPX deprecation. Checksum verification passed for each rerun demo export. [Profiles, reruns and reproduction](final-delivery.md#production-readiness-and-scalability-review)

Production readiness remains unproven. The unrestricted 200-order solve reached its construction guard, bounds are weak on larger time-limited models, and the simulator uses synthetic data and anticipatory reservations. Approval uses one demonstration token. Replans preserve projected shop-floor commitments, and an integration with authoritative actual execution state remains necessary. The optional live copilot provider was outside this verification.

## Original audit

## Checks and observations

| Area | Adversarial check and observed result |
|---|---|
| Optimization | The hand-solvable one-stage instance proved objective 20. No eligible assignment, missing stock and frozen downtime conflicts returned INFEASIBLE. A very short budget returned UNKNOWN. An empty order set had objective zero. |
| Independent validation | Corrupted machine references, setup length, processing duration, horizon, calendar, material, stage precedence, machine overlap, missing stages and protected timestamps were detected by the automated suite. |
| Materials | A two-order instance consumed scarce stock at minutes 5 and 45. Removing the receipt caused a validator violation and an infeasible CP-SAT solve. Zero-uncertainty replay accepted a receipt at exactly the first consumption time. |
| Replay | Same-seed simulation results matched exactly. Zero uncertainty reproduced plan intervals. A forced failure interrupted processing and active segments resumed after repair. Multi-order traces were checked for machine exclusivity, precedence and active-segment downtime conflicts. |
| ML | The feature allowlist excluded execution time and duration. A synthetic ERP-perfect case rejected both ML alternatives through the quality gate. Bad registry IDs were rejected. Artificially shifted execution observations triggered a drift review. |
| Approval and copilot | An unauthorized release received HTTP 403. Release before approval failed. High-risk alternatives required a qualifying simulation reference. A prompt requesting release and fabricated downtime remained unsupported, and a mock provider could not select a mutation or supply invented evidence. |
| Persistence and alternatives | A cross-dataset product reference was rejected by the SQLite foreign key. Idempotent API jobs returned prior IDs, while conflicting requests returned HTTP 409. A replan preserved protected work and superseded its parent only on explicit release. |
| Benchmarks | All methods were retained, including failures and lower-performing choices. A separate tuning seed selected D, with test metrics and paired uncertainty calculated on a different seed. The 200-order CP-SAT construction guard returned UNKNOWN. |

## Defects found and corrected

- The first normalized data write omitted a routing operation's foreign key. The service now supplies its owning route. SQLite integration and foreign-key tests exercise the write path.
- An early 40-order CP-SAT run exhausted its budget before confirming a feasible solution. Validated EDD dispatch now supplies a complete hint, including circuit arcs and interval lengths, and avoids expensive presolve on larger hinted graphs. The subsequent 40-order scale benchmark found a feasible plan.
- Early simulation treated a mid-operation failure as a requirement to wait before dispatch. The replay now pauses active processing across an outage and records active segments separately from elapsed operation time.
- The managed Docker proxy's trust chain prevented the first dependency install. A BuildKit secret now accepts a custom CA bundle during dependency installation. The Docker image built successfully. The container launch then failed during rootless storage preparation because the runner filesystem was full.
- A one-replication trace originally became the latest risk result in the demonstration. The trace now precedes the final 300-replication rerun so exports link the comparison-sized risk evaluation.

## Verification and release recommendation

The local test suite passed 18 tests, with one dependency deprecation warning. Ruff and mypy passed. SQLite migration upgrade/check and Docker image build passed. The workspace Docker launch was blocked by disk capacity. GitHub Actions built the image, started the SQLite container and verified HTTP health. PostgreSQL was verified in the follow-up audit above. The live optional copilot provider remains unverified. [Hosted verification](https://github.com/vtooooooo/forgeworks/actions/runs/44950431508)

Release this branch for local evaluation and reproducible synthetic benchmarking. Real production release requires an execution-state integration, factory calibration, authentication and authorization, Docker runtime and PostgreSQL verification, and a larger-scale scheduling strategy.
