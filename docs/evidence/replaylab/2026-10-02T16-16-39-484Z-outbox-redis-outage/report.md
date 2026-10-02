# ReplayLab Report: outbox-redis-outage

Status: PASSED

## Invariants

- Violations: 0
- Expected conflicts: 0
- Test infrastructure failures: 0

## Timeline

- 5.697ms replaylab scenario.start 
- 5.953ms replaylab operation.start 
- 20.536ms postgres transaction.begin 
- 23.407ms postgres outbox.inserted c28103a2-020e-45c8-84f2-d0f452fcfacb
- 24.295ms postgres transaction.commit c28103a2-020e-45c8-84f2-d0f452fcfacb
- 24.438ms replaylab operation.end 
- 24.52ms replaylab operation.start 
- 26.847ms dispatcher dispatch.claimed c28103a2-020e-45c8-84f2-d0f452fcfacb
- 27.95ms redis enqueue.blocked c28103a2-020e-45c8-84f2-d0f452fcfacb
- 28.138ms replaylab operation.end 
- 28.232ms replaylab operation.start 
- 29.477ms dispatcher dispatch.claimed c28103a2-020e-45c8-84f2-d0f452fcfacb
- 37.599ms bullmq queue.accepted c28103a2-020e-45c8-84f2-d0f452fcfacb
- 38.465ms dispatcher dispatch.acknowledged c28103a2-020e-45c8-84f2-d0f452fcfacb
- 39.078ms replaylab operation.end 
- 40.489ms verifier scenario.verified 

## Raw Artifacts

- `metadata.json`
- `journal.jsonl`
- `report.json`
