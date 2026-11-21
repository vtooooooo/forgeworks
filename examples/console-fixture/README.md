# Verified synthetic console snapshot

This gzip JSON snapshot is a transport of the persisted SQLite records from the review rerun documented in reports/readiness/demo/demo-report.json at 546d299. It includes the original, extra-shift, and released breakdown plans, their actual replications and decision logs, the benchmark, and the checksum-verified trained model registry artifact. It omits failed sizing probes, job rows, and copilot interactions. No deployment credentials or factory customer data are included. The trusted pickle artifact is part of the pinned synthetic fixture and should never be replaced with an untrusted upload.

Use examples/demo.py with a fresh directory to reproduce the source workflow. Time-limited solver selections and run IDs can vary. This fixed snapshot preserves the exact published rerun for startup without optimization.
