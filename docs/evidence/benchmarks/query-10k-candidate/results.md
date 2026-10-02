# Benchmark Results: query-10k-candidate

Status: MEASURED

## Metadata

- Date: 2026-10-02T16:27:03.584Z
- Commit: 43bd67e3896225efd92a1721766c9f84e89e6e34
- Mode: query
- Exploratory: true

## Summaries

- `query-summary-candidate.json`: 30 successful samples, 0 errors, p50 `0.57 ms`, p95 `0.76 ms`, p99 `0.86 ms`.

## Errors

- None recorded. The raw `EXPLAIN (ANALYZE, BUFFERS)` output is in `explain-candidate.json`.

## Aggregate Method

Percentiles are nearest-rank over successful request/query latency samples per repetition. Aggregate claims should be computed from saved repetition summaries, not from tuned exploratory runs.
