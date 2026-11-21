# Optimization model

Let preparation, processing start and end be integer variables for each required operation. Exactly one eligible machine literal holds. An optional machine interval covers contiguous preparation and processing. No-overlap includes calendar blocks. Each machine circuit has a dummy node and self-loops for unselected operations. Selected arcs bind predecessor completion before preparation and set directional setup from the family pair. Initial setup consumes five minutes.

Release and prior-stage completion constrain preparation. A per-material reservoir inserts opening stock and receipts at doubled minutes and consumes stage-zero stock at doubled minutes plus one. This prioritizes same-minute receipts and jointly accounts for competing orders. Hard deadlines constrain completion directly. Soft deadlines yield nonnegative tardiness. Frozen commitments bind setup, processing start, assignment and end.

The default objective is 20 times priority-weighted tardiness minutes plus makespan and total setup minutes. Replanning adds two per processing-start minute moved and 30 per machine reassignment. These weights are configurable. CP-SAT returns the solver status, bound and relative gap when applicable. A feasible EDD dispatch can provide an initial solution. The quadratic circuit allocation cap returns UNKNOWN before search when exceeded.

FCFS, EDD and SPT launch whole orders in their listed priority order and place each stage in the earliest finishing compatible append slot. An unsuccessful dispatch returns NO_FEASIBLE_DISPATCH. The independent validator rechecks operation completeness, assignments, intervals, sequencing, releases, inventory, commitments, deadlines and objective arithmetic.

## Construction profiling and fixed assignments

CP-SAT records candidate pairs, built circuit arcs, variable and constraint counts, EDD preparation time, construction time, search time and Linux process peak RSS. RSS is a process high-water mark. For comparable memory measurements, profile each case in a fresh process. Search time includes solver-side model loading and presolve.

For larger graphs, each selected node has exactly one selected incoming setup arc, so one equality per candidate node sums its incoming setup coefficients. The equivalent per-arc implications remain on small unrestricted instances, where they searched better in the review. No-overlap, precedence and stock constraints are enforced in both encodings.

Full assignment search remains the default. To bound construction on larger instances, opt into `--assignment-scope dispatch` or pass `"assignment_scope": "dispatch"` in an optimize request. This mode validates an EDD schedule, fixes its machine assignments, and allows CP-SAT to change machine sequences and timestamps. The solver bound, gap and optimality apply to the fixed-assignment model. An invalid starting dispatch returns UNKNOWN. Alternatives inherit their parent's assignment scope and construct fresh assignments for the modified scenario.
