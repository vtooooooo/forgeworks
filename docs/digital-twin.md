# Digital twin

SimPy advances between dispatch events. Machine queues follow the nominal sequence and routing dependencies gate downstream work. Dispatch chooses the earliest eligible setup from all queue heads. Each machine remains assigned until completion. Setup and uninterrupted processing fit the planned calendar at dispatch. An outage can interrupt processing, holding its machine until repair and resuming only in available capacity. Setup requires a continuous interval. Detailed traces record active processing segments separately from elapsed time.

Material is consumed when stage zero begins. Reservations reconcile time-specific receipts and accepted draws. Receipts at the same timestamp are credited first. Keyed streams produce lognormal processing variation, occasional overruns, machine failures, repairs and shipment delays. The duration generator shares latent factory parameters with synthetic training history. The optimizer only sees planning features.

For comparisons, alternatives share streams keyed by seed, replication and operation or resource ID. Mean metrics use normal-approximation 95% intervals. Per-order late probabilities use Wilson intervals. Completion quantiles are conditional on completion. Unfinished orders are counted late and their tardiness proxy uses the end of the recovery horizon. With uncertainty disabled, validated schedules reproduce their planned times under the fixed-queue policy.

The replay samples disturbances before dispatch, so reservation and setup decisions can use future realized information. Recovery extends the factory's weekly shift template beyond the nominal horizon. Outcomes are specific to these assumptions.
