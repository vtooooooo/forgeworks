# Interview walkthrough

Allow 5–10 minutes. Start the [local Compose demo](deployment-guide.md), open the Overview, and select **Interview walkthrough**. Use the released 40-order synthetic plan for the first pass.

| Time | What to show |
|---|---|
| 0:00–1:00 | A planner balances due dates, material availability, and constrained machines. The overview distinguishes nominal lateness from simulated delivery risk. |
| 1:00–2:30 | Open the scheduler, filter an order and select one operation. Point out setup, shift and maintenance windows. The solver found a feasible schedule. Independent validation passed. The bound shows why feasibility and optimality are different. |
| 2:30–3:30 | Open the duration evidence. ERP assumptions are fixed; throughput varies by machine and order. The reproduced forest MAE was 14.34 minutes versus ERP's 24.08 on the synthetic final partition. Observed 90% interval coverage was 90.56%. |
| 3:30–5:00 | Open Digital Twin. Explain the modeled outages, receipt delays, and timing variability. The persisted 300-replication results report confidence intervals and order-level risk. |
| 5:00–6:00 | Ask the copilot for order timing or machine utilization. Show the underlying schedule, measured timing and simulation identifiers. |
| 6:00–8:00 | Compare the original plan and released breakdown replan in Scenario Lab. The stored replan preserved one started operation. Inspect changed assignments, both execution estimates and their scenario inputs. |
| 8:00–9:00 | Show Schedule Approvals, recorded planner identity, and required simulation evidence. Discuss production authorization, live execution integration and calibration as outstanding work. |

**Why does fixed assignment scale better?** It reduces machine-specific successor pairs by taking assignments from an independently validated EDD dispatch. At 200 orders the measured objective tied EDD, so the result demonstrates a resource benefit for a narrower search.

**Where does confidence come from?** The chronological calibration slice sets the interval width. The final synthetic partition measures coverage and gates promotion. Independent plant validation remains necessary.

**Can the copilot release a plan?** It retrieves evidence only. An explicit trusted local approval flow invokes the backend state machine and keeps its token on the server.

**How does a recruiter avoid a solve?** The initial fixture includes the schedules, risk replications, model, and approval records from the published rerun. Live computations are optional.
