# Benchmark Results: query-10k-baseline

Status: MEASURED

## Metadata

- Date: 2026-10-02T16:27:03.373Z
- Commit: 43bd67e3896225efd92a1721766c9f84e89e6e34
- Mode: query
- Exploratory: true

## Summaries

- `query-summary-baseline.json`: 30 successful samples, 0 errors, p50 `0.52 ms`, p95 `0.74 ms`, p99 `0.99 ms`.

## Errors

- None recorded. The raw `EXPLAIN (ANALYZE, BUFFERS)` output is in `explain-baseline.json`.

## Aggregate Method

Percentiles are nearest-rank over successful request/query latency samples per repetition. Aggregate claims should be computed from saved repetition summaries, not from tuned exploratory runs.
