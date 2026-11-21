# Limitations

- Unrestricted sequence-dependent circuits grow quadratically. CP-SAT returned UNKNOWN for the 200-order benchmark before search. Explicit dispatch assignment scope independently validated a 200-order CP-SAT schedule, with a bound that applies solely to its fixed assignments. The 200-order schedule tied the EDD starting objective. The largest verified integrated demo uses 40 orders.
- Simulation uses synthetic data and fixed machine queues. It can anticipate outages and receipt delays in dispatch decisions. It uses recurring shift capacity for extended recovery and excludes labor contention and scrap.
- Replanning protects a projected execution prefix from the released schedule. Execution observations support retraining but are not reconciled into machine state or partial inventory at the disruption timestamp. Outages affecting started operations can make a replan infeasible.
- Overtime adds availability. There is no wage premium, workforce planning model, or overtime cost optimization. The simulated cost is active-machine hourly cost.
- The conformal interval is a global absolute-error radius. Physical uncertainty is approximated by a synthetic latent process. Plant calibration requires observed operational data.
- The local token and one-process job runner are intended for a contained demo. External deployment needs identity management, scoped access, durable orchestration and operational controls.
- The optional provider was covered using a mock tool-selection boundary. A live provider call was not part of verification.
