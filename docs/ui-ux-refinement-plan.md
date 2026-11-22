# Command center refinement plan

The public-demo branch adds immutable JSON and ZIP evidence to the command-center branch. The existing captures show the factory totals competing with activity, dense timeline rows, unexplained solver gaps, and an order-risk table below multiple charts. Scenario creation takes precedence over the stored comparison. Code inspection also found raw comparison JSON and a walkthrough without a clear visual target.

| Area | Change | Regression to check |
| --- | --- | --- |
| Shell and overview | Clarify snapshot mode, keep factory signals distinct, link to the watchlist, and lead a seven-stop walkthrough | Hash routing, refresh, keyboard focus, schedule selection |
| Scheduler | Improve the timeline toolbar and legend, preserve the detail drawer, and explain solver bounds | Operation placement, scrolling, keyboard activation, and no timeline for UNKNOWN |
| Predictions and Twin | Present uncertainty next to predictions, explain simulated estimates, and paginate searchable risk rows | Stored values, order selection, replication counts and percentages |
| Copilot and scenarios | Render structured changes, references, and direction-aware comparisons | Evidence traceability, local jobs and public read-only behavior |
| Approvals and System | Surface history and labeled runtime details | Local authorization and accurate description of snapshot mode |

Changes are concentrated in the existing React workspaces and shared styles. Browser checks cover the local application and generated public artifact. The verified fixture, backend algorithms, and export format are the baselines for comparison.
