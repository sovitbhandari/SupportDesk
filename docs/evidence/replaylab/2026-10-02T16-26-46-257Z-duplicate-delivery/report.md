# ReplayLab Report: duplicate-delivery

Status: PASSED

## Invariants

- Violations: 0
- Expected conflicts: 0
- Test infrastructure failures: 0

## Timeline

- 5.096ms replaylab scenario.start 
- 5.421ms replaylab operation.start 
- 20.881ms postgres transaction.begin 
- 24.057ms postgres outbox.inserted 83fb6d2a-cb8c-4570-88d0-c0ecc3a0b709
- 24.96ms postgres transaction.commit 83fb6d2a-cb8c-4570-88d0-c0ecc3a0b709
- 25.136ms replaylab operation.end 
- 25.219ms replaylab operation.start 
- 29.358ms dispatcher dispatch.claimed 83fb6d2a-cb8c-4570-88d0-c0ecc3a0b709
- 37.76ms bullmq queue.accepted 83fb6d2a-cb8c-4570-88d0-c0ecc3a0b709
- 39.526ms dispatcher dispatch.acknowledged 83fb6d2a-cb8c-4570-88d0-c0ecc3a0b709
- 40.643ms replaylab operation.end 
- 41.277ms replaylab operation.start 
- 43.933ms worker provider.before_acceptance 83fb6d2a-cb8c-4570-88d0-c0ecc3a0b709
- 45.645ms fake-provider provider.accepted 83fb6d2a-cb8c-4570-88d0-c0ecc3a0b709
- 46.56ms worker receipt.completed 83fb6d2a-cb8c-4570-88d0-c0ecc3a0b709
- 46.762ms replaylab operation.end 
- 46.95ms replaylab operation.start 
- 47.818ms worker delivery.duplicate_ignored 83fb6d2a-cb8c-4570-88d0-c0ecc3a0b709
- 48.031ms replaylab operation.end 
- 49.982ms verifier scenario.verified 

## Raw Artifacts

- `metadata.json`
- `journal.jsonl`
- `report.json`
