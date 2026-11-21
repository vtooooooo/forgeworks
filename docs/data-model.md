# Data model

Versioned factory data includes products, raw materials, bills of materials, machines and capabilities, shift and maintenance intervals, routing stages, production orders, stock balances and receipts. Composite foreign keys constrain master references to the same dataset. Canonical JSON snapshots support version hashing and exact domain reconstruction. Each schedule references its dataset, optional registered model and optional parent. Operations, decisions, simulations, comparisons and copilot calls have dedicated linked tables.

Intervals are half-open in integer minutes after 2026-01-05 11:00 UTC, equivalent to 06:00 America/New_York. Calendar intervals are explicit. The January generator horizon does not cross a daylight saving transition. Exports include ISO UTC timestamps. Imports in another period need explicit time-zone conversion before supplying calendar intervals.

The generator uses 16 machines in three departments, 50 SKUs, three materials, 3–5 routing stages and two weekday shifts. Order count is configurable from 0 to 300. Historical and new execution observations are append-only through the service, keyed by dataset and execution ID.
