# ReplayLab

ReplayLab is an optional local-only test harness around SupportDesk's PostgreSQL outbox, Redis/BullMQ queue, and fake notification provider. It is not mounted by the Express app and does not expose fault controls through the production API.

## Commands

```bash
npm run replaylab -- run replaylab/scenarios/outbox-redis-outage.json
npm run replaylab -- replay docs/evidence/replaylab/<run-id>/journal.jsonl
npm run replaylab -- compare docs/evidence/replaylab/<baseline>/journal.jsonl docs/evidence/replaylab/<candidate>/journal.jsonl
npm run replaylab -- report docs/evidence/replaylab/<run-id>
```

## Scope

- Scenario files are strict JSON for Phase 1. YAML is rejected with a clear error until a dependency-backed parser is added.
- Fault hooks exist only inside `replaylab/cli.mjs` and require local CLI execution.
- Journals store operation/event IDs, local monotonic timestamps, wall-clock time, component, attempt, transition, correlation ID, and safe metadata. They do not store secrets or message contents.
- Pass/fail is decided by invariant verification over the journal and database observations.

## Phase 1 Scenarios

- `outbox-redis-outage.json`: committed outbox event while enqueue is blocked, then recovery attempt.
- `duplicate-delivery.json`: duplicate delivery for one event should not create multiple terminal operation records.
- `rollback-no-outbox.json`: rolled-back ticket creation must not leave an outbox event.

If PostgreSQL, Redis, BullMQ, or the seeded database are unavailable, ReplayLab records a test infrastructure failure instead of inventing a failure or success.
