# Adversarial validation

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

The local test suite passed 18 tests, with one dependency deprecation warning. Ruff and mypy passed. SQLite migration upgrade/check and Docker image build passed. Docker runtime smoke was blocked by disk capacity. The PostgreSQL runtime and live optional copilot provider are unverified.

Release this branch for local evaluation and reproducible synthetic benchmarking. Real production release requires an execution-state integration, factory calibration, authentication and authorization, Docker runtime and PostgreSQL verification, and a larger-scale scheduling strategy.
