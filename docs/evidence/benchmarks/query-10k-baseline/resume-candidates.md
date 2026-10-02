# Resume Candidates

- MEASURED, local synthetic workload: Compared a valid baseline ticket query on 10,000 synthetic tickets across 5 organizations for 30 repetitions; baseline p50/p95/p99 latency was `0.52/0.74/0.99 ms`, with 30/30 page-correct responses. This is exploratory local evidence, not a production-scale claim.

## Two-Minute Reproduction/Demo Script

1. Start Docker Desktop.
2. Run `npm ci`.
3. Run `npm run db:reset && npm run db:migrate && npm run db:seed`.
4. Run `npm run bench:seed -- --tickets 10000 --orgs 5 --seed 4242`.
5. Run `npm run bench:query -- --variant baseline --seed 4242 --run-id demo-query-baseline`.
6. Run `npm run bench:query -- --variant candidate --seed 4242 --run-id demo-query-candidate`.
7. Open `docs/evidence/benchmarks/demo-query-*/results.md` and compare only matching workload fields.

## Tradeoff

The harness uses a plain Node client instead of adding k6 because the project already ships Node/TypeScript tooling and PostgreSQL access. That keeps installation simple for an entry-level portfolio, while documenting the closed-loop semantics so the results are not overstated as open-loop capacity.
