# ReplayLab Report: rollback-no-outbox

Status: PASSED

## Invariants

- Violations: 0
- Expected conflicts: 0
- Test infrastructure failures: 0

## Timeline

- 5.624ms replaylab scenario.start 
- 5.857ms replaylab operation.start 
- 21.971ms postgres transaction.begin 
- 25.367ms postgres outbox.inserted 513001a6-c9a0-4e08-b711-18e15d727bfd
- 25.764ms postgres transaction.rollback 513001a6-c9a0-4e08-b711-18e15d727bfd
- 25.893ms replaylab operation.end 
- 27.544ms verifier scenario.verified 

## Raw Artifacts

- `metadata.json`
- `journal.jsonl`
- `report.json`
