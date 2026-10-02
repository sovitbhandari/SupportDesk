# ReplayLab Report: rollback-no-outbox

Status: PASSED

## Invariants

- Violations: 0
- Expected conflicts: 0
- Test infrastructure failures: 0

## Timeline

- 6.855ms replaylab scenario.start 
- 7.116ms replaylab operation.start 
- 21.959ms postgres transaction.begin 
- 25.303ms postgres outbox.inserted 323a8228-139f-421b-b0a7-234b9620a41c
- 25.67ms postgres transaction.rollback 323a8228-139f-421b-b0a7-234b9620a41c
- 25.79ms replaylab operation.end 
- 27.275ms verifier scenario.verified 

## Raw Artifacts

- `metadata.json`
- `journal.jsonl`
- `report.json`
