# Duration modeling

ERP uses quantity, product family and stage. The historical baseline uses group medians by family and operation, with a global fallback. Ridge and random forest use scikit-learn dictionary vectorization. The feature allowlist includes family, operation, quantity, machine, rate, material, known machine condition and ERP minutes. Execution outcomes, timestamps and hidden factory factors are excluded. Shift is used for subgroup evaluation.

Chronological train, selection, interval calibration and test splits use 55%, 15%, 15% and 15% of observations. Split-conformal intervals use the finite-sample 90% absolute residual quantile. An explicit promotion requires candidate validation and final-partition MAE below ERP and at least 82% final-partition coverage. The final partition is therefore a quality gate. Reserve fresh evidence for an independent post-promotion evaluation. The stress case intentionally increases quantities and duration outside the training range.

Schedule minutes round up expected minutes plus an optional fraction of the conformal radius. A failed candidate uses ERP. Authorized local operators select or roll back the model pointer. Reported executions trigger review at 100 observations or at least 20 observations with coverage below 82%. Training metrics, history hash and trusted local artifact checksum are recorded.
