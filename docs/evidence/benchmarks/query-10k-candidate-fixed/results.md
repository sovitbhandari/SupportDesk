# Benchmark Results: query-10k-candidate-fixed

Status: BLOCKED

## Metadata

- Date: 2026-10-02T16:27:46.289Z
- Commit: 43bd67e3896225efd92a1721766c9f84e89e6e34
- Mode: query
- Exploratory: true

## Summaries

- No completed measurement summaries in this run.

## Errors

- {"name":"AggregateError","message":null,"code":"EPERM","causes":[{"name":"Error","message":"connect EPERM ::1:55432 - Local (:::0)","code":"EPERM","address":"::1","port":55432},{"name":"Error","message":"connect EPERM 127.0.0.1:55432 - Local (0.0.0.0:0)","code":"EPERM","address":"127.0.0.1","port":55432}]}
- {"name":"AggregateError","message":null,"code":"EPERM","causes":[{"name":"Error","message":"connect EPERM ::1:55432 - Local (:::0)","code":"EPERM","address":"::1","port":55432},{"name":"Error","message":"connect EPERM 127.0.0.1:55432 - Local (0.0.0.0:0)","code":"EPERM","address":"127.0.0.1","port":55432}]}

## Aggregate Method

Percentiles are nearest-rank over successful request/query latency samples per repetition. Aggregate claims should be computed from saved repetition summaries, not from tuned exploratory runs.
