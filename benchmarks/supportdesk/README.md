# SupportDesk Benchmark Harness

This harness produces evidence artifacts, not marketing claims. It uses a plain Node client with documented closed-loop semantics plus PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` output.

## Semantics

- Synthetic data only. Seeded accounts and tickets are named `bench-*` and must not be described as real users.
- API load is closed-loop by default: each synthetic client waits for one request to finish before issuing its next request. This measures achieved throughput for that workload, not maximum requests-per-second capacity.
- Query experiments compare a valid baseline query/index state with a candidate index state over the same synthetic data, filters, page size, hardware, and cache policy.
- Raw artifacts are written under `docs/evidence/benchmarks/<run-id>/`.
- Every run writes `metadata.json`, raw samples, independent `/metrics` snapshots when the API is reachable, `results.md`, and `resume-candidates.md`.

## Common Commands

```bash
npm run bench:seed -- --tickets 10000 --orgs 5 --seed 4242
npm run bench:query -- --tickets 10000 --variant baseline --seed 4242
npm run bench:query -- --tickets 10000 --variant candidate --seed 4242
npm run bench:api -- --levels 1,10,50,100 --warmup 60 --duration 300 --repetitions 3
NOTIFICATION_PROVIDER=fake npm run bench:recovery -- --batch 200
npm run bench:sse -- --streams 25 --messages 100
```

Short exploratory runs can override durations, repetitions, and batch sizes. Final runs should be declared before running and should not be tuned repeatedly.
