# ReplayLab Report: outbox-redis-outage

Status: PASSED

## Invariants

- Violations: 0
- Expected conflicts: 0
- Test infrastructure failures: 0

## Timeline

- 5.435ms replaylab scenario.start 
- 5.67ms replaylab operation.start 
- 21.367ms postgres transaction.begin 
- 24.953ms postgres outbox.inserted 698f789e-2eea-4b42-a820-9660271b879f
- 26.092ms postgres transaction.commit 698f789e-2eea-4b42-a820-9660271b879f
- 26.23ms replaylab operation.end 
- 26.314ms replaylab operation.start 
- 29.45ms dispatcher dispatch.claimed 698f789e-2eea-4b42-a820-9660271b879f
- 30.369ms redis enqueue.blocked 698f789e-2eea-4b42-a820-9660271b879f
- 30.47ms replaylab operation.end 
- 30.547ms replaylab operation.start 
- 31.932ms dispatcher dispatch.claimed 698f789e-2eea-4b42-a820-9660271b879f
- 39.38ms bullmq queue.accepted 698f789e-2eea-4b42-a820-9660271b879f
- 40.397ms dispatcher dispatch.acknowledged 698f789e-2eea-4b42-a820-9660271b879f
- 41.459ms replaylab operation.end 
- 43.182ms verifier scenario.verified 

## Raw Artifacts

- `metadata.json`
- `journal.jsonl`
- `report.json`
