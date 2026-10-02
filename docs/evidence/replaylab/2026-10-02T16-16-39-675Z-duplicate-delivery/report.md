# ReplayLab Report: duplicate-delivery

Status: PASSED

## Invariants

- Violations: 0
- Expected conflicts: 0
- Test infrastructure failures: 0

## Timeline

- 5.672ms replaylab scenario.start 
- 5.933ms replaylab operation.start 
- 20.436ms postgres transaction.begin 
- 23.317ms postgres outbox.inserted 197ff60c-7b71-47c3-83c3-ce779583811e
- 23.952ms postgres transaction.commit 197ff60c-7b71-47c3-83c3-ce779583811e
- 24.101ms replaylab operation.end 
- 24.178ms replaylab operation.start 
- 26.305ms dispatcher dispatch.claimed 197ff60c-7b71-47c3-83c3-ce779583811e
- 32.597ms bullmq queue.accepted 197ff60c-7b71-47c3-83c3-ce779583811e
- 33.412ms dispatcher dispatch.acknowledged 197ff60c-7b71-47c3-83c3-ce779583811e
- 33.927ms replaylab operation.end 
- 34.322ms replaylab operation.start 
- 36.852ms worker provider.before_acceptance 197ff60c-7b71-47c3-83c3-ce779583811e
- 38.019ms fake-provider provider.accepted 197ff60c-7b71-47c3-83c3-ce779583811e
- 38.615ms worker receipt.completed 197ff60c-7b71-47c3-83c3-ce779583811e
- 38.7ms replaylab operation.end 
- 38.766ms replaylab operation.start 
- 39.523ms worker delivery.duplicate_ignored 197ff60c-7b71-47c3-83c3-ce779583811e
- 39.589ms replaylab operation.end 
- 40.842ms verifier scenario.verified 

## Raw Artifacts

- `metadata.json`
- `journal.jsonl`
- `report.json`
