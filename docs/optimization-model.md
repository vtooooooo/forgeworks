# Optimization model

Let preparation, processing start and end be integer variables for each required operation. Exactly one eligible machine literal holds. An optional machine interval covers contiguous preparation and processing. No-overlap includes calendar blocks. Each machine circuit has a dummy node and self-loops for unselected operations. Selected arcs bind predecessor completion before preparation and set directional setup from the family pair. Initial setup consumes five minutes.

Release and prior-stage completion constrain preparation. A per-material reservoir inserts opening stock and receipts at doubled minutes and consumes stage-zero stock at doubled minutes plus one. This prioritizes same-minute receipts and jointly accounts for competing orders. Hard deadlines constrain completion directly. Soft deadlines yield nonnegative tardiness. Frozen commitments bind setup, processing start, assignment and end.

The default objective is 20 times priority-weighted tardiness minutes plus makespan and total setup minutes. Replanning adds two per processing-start minute moved and 30 per machine reassignment. These weights are configurable. CP-SAT returns the solver status, bound and relative gap when applicable. A feasible EDD dispatch can provide an initial solution. The quadratic circuit allocation cap returns UNKNOWN before search when exceeded.

FCFS, EDD and SPT launch whole orders in their listed priority order and place each stage in the earliest finishing compatible append slot. An unsuccessful dispatch returns NO_FEASIBLE_DISPATCH. The independent validator rechecks operation completeness, assignments, intervals, sequencing, releases, inventory, commitments, deadlines and objective arithmetic.
