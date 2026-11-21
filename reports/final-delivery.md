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

## Production-readiness and scalability review

The review increased automated coverage from 18 to **28 passing tests**. It addressed timestamp boundaries, persisted overrun behavior, release validation, CP-SAT model size and replay work per dispatch. The largest repeated end-to-end workflow used 40 orders. A separate 200-order test validated fixed-assignment CP-SAT scheduling for 715 operations. These results support a local or controlled pilot evaluation. Live execution-state reconciliation, audited identities and access policies, and plant-calibrated performance remain prerequisites for deployment.

### CP-SAT construction and search

The default guard is 180,000 candidate pair slots. The 200-order factory produced 888,907 slots because each eligible operation can be a circuit node on several machines, and each machine enumerates immediate predecessors and successors. The guard returns UNKNOWN before allocating the graph. Independently measured timings below used a fresh Linux process per case and a five-second solver budget. The two unrestricted 200-order diagnostics raised the guard in scratch copies. The published runtime guard stays in place. The original build column includes warm-start preparation where used. Updated construction times exclude the separately recorded dispatch preparation. RSS values are process high-water marks in MiB.

| Normal scenario | Variables | Constraints | Build, seconds | Search, seconds | Peak build / search RSS | Status |
|---|---:|---:|---:|---:|---:|---|
| Original full, 40 | 42,026 | 80,061 | 0.76 | 5.02 | 122 / 225 | FEASIBLE |
| Reviewed full, 40 | 42,026 | 41,660 | 0.48 | 5.02 | 110 / 206 | FEASIBLE |
| Original full, 200, guard raised | 901,739 | 1,783,547 | 12.07 | 4.73 | 798 / 1,751 | UNKNOWN |
| Reviewed full, 200, guard raised | 901,739 | 899,062 | 9.57 | 4.74 | 503 / 1,166 | UNKNOWN |
| Reviewed fixed assignments, 200 | 37,037 | 37,368 | 0.43 | 4.78 | 110 / 244 | FEASIBLE |

The fixed-assignment run spent another 1.28 seconds obtaining and independently validating the EDD hint. Its objective of 9,938,920 tied EDD on this trial. This demonstrates resource savings for a narrower search and no objective improvement over dispatch in the measured 200-order case. Full-assignment bounds and fixed-assignment bounds answer different questions. The compact setup equality reduced full constraint counts by about half on the large cases. It worsened a short small-instance trial, so small unrestricted runs keep their original arc implications. [Isolated profiles and regression measurements](readiness/cp-sat-profile.json)

### Reproduced prediction results

The four chronological slices had 1,320, 360, 360 and 360 rows. Their endpoints were disjoint. Independently recomputing absolute errors and conformal coverage reproduced the metrics below. Perturbing only held-out outcomes left fitted predictions, candidate selection and calibration radii identical. The final partition still participates in the promotion gate. [Independent ML reproduction](readiness/ml-reproduction.json)

| Model | MAE, minutes | 90% interval coverage |
|---|---:|---:|
| ERP | 24.0766 | 90.8333% |
| Historical group median | 41.8255 | 91.1111% |
| Ridge | 14.6008 | 91.3889% |
| Random forest | 14.3401 | 90.5556% |

### Benchmark and demo reruns

Run `8b19aa23804f48099589cb116cebd3da` completed in 41.30 seconds with 100 tuning and 100 holdout replications. Nominal ERP CP-SAT weighted tardiness was 849, matching the original. The revised short run's buffered ML nominal result was 1,598 versus the original 1,597. Paired holdout results preserved the original tradeoff. C had the highest on-time share and lowest modeled cost. D had the lowest mean weighted tardiness and fewest delayed starts. [Benchmark rerun](readiness/benchmark-results.json)

| Approach | On time | Mean weighted tardiness | Mean cost | Delayed starts |
|---|---:|---:|---:|---:|
| A · ERP EDD | 16.50% | 2,924.67 | 1,617.92 | 45.80% |
| B · ERP CP-SAT | 17.33% | 2,668.36 | 1,533.07 | 47.55% |
| C · ML CP-SAT | 23.17% | 2,602.33 | 1,500.12 | 48.80% |
| D · Simulation-selected buffered ML CP-SAT | 16.00% | 2,553.59 | 1,548.65 | 22.05% |

The 40-order demo completed in 50.65 seconds, including 22.20 seconds for simulation. The original, extra-shift and breakdown runs used 300 replications each. The shift left paired outcomes identical. The replan preserved one started operation, moved 137 operations, and was approved and released. The original and replan mean on-time shares were 98.0% and 96.4% under their respective factory inputs. Observed runtime is a single measurement. Both earlier and current demo outcomes matched for these inputs. [Original schedule](readiness/demo/original.zip) · [Extra-shift schedule](readiness/demo/extra-shift.zip) · [Released replan](readiness/demo/rescheduled.zip) · [Run IDs and paired intervals](readiness/demo/demo-report.json)

Hosted Docker Compose brought up PostgreSQL 16 and the API, migrated to Alembic revision `0001`, and passed `alembic check`. The workflow trained and served a model, optimized and validated a schedule, simulated it, retrieved persisted copilot evidence, ran an isolated what-if, released a breakdown replan, and validated its export. The original released payload remained unchanged. [Hosted Compose result](https://github.com/vtooooooo/forgeworks/actions/runs/44951353364)

```bash
python -m forgeworks generate --scenario normal --seed 42 --count 200
python -m forgeworks optimize --seconds 5 --assignment-scope dispatch
export FORGEWORKS_PLANNER_TOKEN=local-demo-only
python examples/demo.py --output demo-output/readiness --runs 300 --seconds 8
python -m forgeworks benchmark --count 6 --runs 100 --seconds 5 --scale \
  --output demo-output/readiness/benchmark-results.json
pytest -q
```

## Original delivery measurements

The following sections preserve the original evaluation for comparison.

### Duration prediction

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

The test suite passed 18 tests. The SQLite migration, lint, type checks and image build passed. The workspace built the image with its CA bundle as a BuildKit secret, then exhausted disk space preparing its container. GitHub Actions independently built and ran the SQLite-backed image and confirmed HTTP health. PostgreSQL was verified in the follow-up review above. [Hosted verification](https://github.com/vtooooooo/forgeworks/actions/runs/44950431508) · [Adversarial audit](final-adversarial-validation.md)

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

Implementation commit `19d8992d591700c365f718f69c7184a4c9d13339` was based on main at `6d3d1cdf091a1382e153375dda80e88ed6c914db`. [Draft PR](https://github.com/vtooooooo/forgeworks/pull/1) · [Feature branch comparison](https://github.com/vtooooooo/forgeworks/compare/main...feature/forgeworks-planning-platform)

The implementation is suitable for a local synthetic-planning evaluation. [Known limitations](../docs/limitations.md)
