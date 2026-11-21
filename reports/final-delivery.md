# ForgeWorks AI delivery report

This delivery implements a versioned planning workflow in Python. It includes factory generation, duration estimation and model promotion, flexible job-shop optimization, independent validation, simulation, copilot evidence, what-if and protected rescheduling, planner release, execution feedback and portable exports. REST, CLI and the example use a shared service. The architecture, formulation, endpoint list and runbook are linked from the [repository README](../README.md).

| Path | Contents |
|---|---|
| src/forgeworks | Domain contracts, generation, ML, optimization, validation, simulation, evidence, scenarios, storage, approval, jobs, exports, API and CLI |
| migrations | Alembic configuration and relational schema revision |
| tests | Core correctness, corruption tests, integration, API, ML, persistence, replay and benchmark coverage |
| examples | Executable 40-order workflow and scenario-event fixtures |
| docs | Business, technical and operational documentation |
| reports | Raw measurements, demo bundles and adversarial audit |
| .github/workflows | Bounded lint, type, tests, migration and Docker checks |

## Duration prediction

Benchmark run `66f667e2aeaf49b399ac489d8fce0580` used 2,400 chronological synthetic executions with 360 final quality-gate rows. The factory contains 16 machines, 50 products and 3 materials. Minutes are the error and interval-width units. [Raw benchmark data](benchmark-results.json)

| Model | MAE | RMSE | 90% interval coverage | Mean interval width |
|---|---:|---:|---:|---:|
| ERP | 24.08 | 35.65 | 90.8% | 120.43 |
| Historical group median | 41.83 | 55.66 | 91.1% | 196.19 |
| Ridge | 14.60 | 20.32 | 91.4% | 69.59 |
| Random forest | 14.34 | 20.81 | 90.6% | 66.88 |

Random forest passed the promotion gate. Ridge had the lower RMSE. The raw report includes bias, median error, subgroup metrics and distribution-shift stress results.

## Scheduling

The six-order tight-deadline scenario used the same ERP minutes for the dispatch baselines and ERP CP-SAT. Each listed schedule passed independent validation. Weighted tardiness is in priority-minutes. CP-SAT runtime includes model construction. [Optimization model](../docs/optimization-model.md)

| Method | Status | Weighted tardiness | Makespan, min | Setup, min | On time | Seconds |
|---|---|---:|---:|---:|---:|---:|
| FCFS | FEASIBLE | 1,967 | 600 | 60 | 33.3% | 0.006 |
| EDD | FEASIBLE | 1,229 | 600 | 71 | 33.3% | 0.008 |
| SPT | FEASIBLE | 1,621 | 737 | 103 | 33.3% | 0.007 |
| ERP CP-SAT | FEASIBLE | 849 | 600 | 50 | 33.3% | 5.027 |
| ML CP-SAT | FEASIBLE | 819 | 586 | 70 | 50.0% | 5.037 |
| Buffered ML CP-SAT | FEASIBLE | 1,597 | 625 | 76 | 16.7% | 5.029 |

ERP CP-SAT's reported relative gap was 0.108% on the six-order tight case. In the separate normal scale trial, CP-SAT produced independently valid plans for 6 and 40 orders in 5.04 and 6.01 seconds, with a weak bound at 40 orders. At 200 orders, EDD validated in 2.00 seconds and CP-SAT returned UNKNOWN before search at the graph budget. The measured benchmark took 32.94 seconds.

## Robustness and integrated comparison

There were 100 tuning replications at seed 43 and 100 holdout replications at seed 44. All alternatives used paired resources and operation draws within a batch. Costs are modeled active machine costs. Stability is the fraction of operations whose setup started later than planned. [Per-metric and paired confidence intervals](benchmark-results.json)

| Approach | Holdout on time | Mean weighted tardiness | Paired tardiness difference vs A, 95% CI | Mean cost | Delayed starts |
|---|---:|---:|---:|---:|---:|
| A · ERP EDD | 16.5% | 2,924.67 | Reference | 1,617.92 | 45.8% |
| B · ERP CP-SAT | 17.3% | 2,668.36 | −256.31 [−369.52, −143.10] | 1,533.07 | 47.5% |
| C · ML CP-SAT | 23.2% | 2,602.33 | −322.34 [−468.19, −176.49] | 1,500.12 | 48.8% |
| D · Simulation-selected buffered ML CP-SAT | 16.0% | 2,572.96 | −351.71 [−466.20, −237.22] | 1,552.99 | 22.0% |

D had the lowest mean weighted tardiness and fewest delayed starts. C had the highest on-time fraction and lowest modeled cost. The buffered plan had considerably higher nominal weighted tardiness than C. These comparisons apply to the specified synthetic instance and replay assumptions.

## End-to-end demonstration

The largest completed workflow used 40 orders and 148 operations. The 200-order CP-SAT attempt hit the circuit allocation guard. The full 40-order run took 63.46 seconds, including 33.47 seconds for simulation runs. The original CP-SAT plan took 9.14 seconds including construction. The breakdown replan took 8.67 seconds. Model version `25b9b94df0854a08a87641bc86ea23f9` used 2,400 synthetic training observations across its splits.

| Record | ID |
|---|---|
| Original released schedule | `9f640ca3a20c470cada4d2011a421185` |
| Extra Saturday shift alternative | `ac2fcd3e91a741f5917afb4b00598211` |
| Released breakdown replan | `245c0ace6e004733b951c9caef946ba6` |
| Original simulation | `a83974fcd76e4120a540995ec6b0795a` |
| Extra shift simulation | `fcf39bf816f44660a0e10a3b872658ad` |
| Replan simulation | `94aca21db56a48bf9dd9f79955586de5` |

The extra shift produced identical execution estimates in all 300 paired replications. The replan modeled a four-hour outage on M-03 starting at minute 58, held one started operation fixed, moved 137 operations and reassigned 99. It was independently validated, simulated, approved and released. Its mean on-time fraction was 96.4% versus 98.0% for the original under their respective factory inputs. Their difference combines the disruption and the new schedule. The simulator supplied 148 execution observations, triggering reviewed retraining. [Demo record](demo/demo-report.json)

The copilot record contains a priority order's due date, completion and stage-by-stage evidence, plus the stored risk estimate and its provenance. The provider mock test checks that selected tools cannot mutate or release plans.

## Verification and artifacts

The test suite passed 18 tests. The SQLite migration, lint, type checks and image build passed. The runner exhausted disk space preparing the Docker container, so its runtime and PostgreSQL end-to-end operation remain unverified. The container build used the runner's CA bundle as a BuildKit secret. [Adversarial audit](final-adversarial-validation.md)

Each ZIP includes timestamped production, assignment, setup, order and material data, predictions, validation, risk, applicable comparisons and approvals, plus a SHA-256 manifest. [Original schedule](demo/original.zip) · [Extra shift](demo/extra-shift.zip) · [Released replan](demo/rescheduled.zip)

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock
pip install --no-deps -e .
alembic upgrade head
export FORGEWORKS_PLANNER_TOKEN=local-demo-only
python examples/demo.py --output demo-output --runs 300 --seconds 8
python -m forgeworks benchmark --count 6 --runs 100 --seconds 5 --scale --output demo-output/benchmark-results.json
ruff check src tests migrations examples
mypy src
pytest -q
alembic check
docker build -t forgeworks:local .
```

Feature branch `feature/forgeworks-planning-platform` was based on main at `6d3d1cdf091a1382e153375dda80e88ed6c914db`. The [GitHub comparison](https://github.com/vtooooooo/forgeworks/compare/main...feature/forgeworks-planning-platform) identifies the delivered commits.

The implementation is suitable for a local synthetic-planning evaluation. [Known limitations](../docs/limitations.md)
