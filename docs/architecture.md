# SupportDesk Architecture Notes

This document explains the parts of SupportDesk that are useful to review for backend/full-stack engineering signal. It is intentionally scoped to the current repository and local evidence harnesses.

## Tenant Isolation

SupportDesk keeps each request tied to an authenticated user and organization membership. Runtime request SQL uses the app database role and tenant transaction helper where mutations need tenant context. Admin/auth membership reads join through both user and organization membership so role checks are scoped to the selected organization.

```mermaid
sequenceDiagram
  participant Browser
  participant API
  participant Auth as Auth Middleware
  participant PG as PostgreSQL

  Browser->>API: Request with session cookie
  API->>Auth: Resolve user and organization membership
  Auth->>PG: Read active user membership
  API->>PG: Tenant-scoped query or transaction
  PG-->>API: Rows for authorized organization
  API-->>Browser: Response with X-Request-Id
```

Key contracts:
- Users must be active members of the organization they access.
- Mutations that depend on tenant context should run through the app-role transaction helper.
- Failed or unauthorized cross-tenant access should return a controlled error, not leaked data.

## Transactional Outbox

Ticket creation writes the ticket, audit event, and notification intent in one PostgreSQL transaction. The dispatcher later claims pending outbox events and enqueues BullMQ jobs. The worker records notification job state and provider attempts. This improves durability without claiming exactly-once external delivery.

```mermaid
sequenceDiagram
  participant API
  participant PG as PostgreSQL
  participant Dispatcher
  participant Redis as Redis/BullMQ
  participant Worker
  participant Provider as Fake/SMTP Provider

  API->>PG: BEGIN
  API->>PG: Insert ticket
  API->>PG: Insert outbox event
  API->>PG: COMMIT
  Dispatcher->>PG: Claim pending outbox event
  Dispatcher->>Redis: Enqueue job by event id
  Worker->>PG: Upsert notification job attempt
  Worker->>Provider: Send notification
  Provider-->>Worker: Accepted/rejected/ambiguous
  Worker->>PG: Record terminal or unknown state
```

Key contracts:
- A rolled-back ticket creation must not leave an outbox event.
- A committed outbox event should reach an explicit disposition within a scenario timeout.
- If the provider accepts a message but local receipt persistence fails, the effect is unknown, not silently successful.

## Ticket Event Replay

Messages are recorded as durable per-ticket events with a monotonically increasing sequence. Redis/SSE is treated as a wake-up path. On reconnect, clients can request missed events after the last seen id, so loss of a transient wake-up does not need to mean loss of canonical message history.

```mermaid
sequenceDiagram
  participant Agent
  participant API
  participant PG as PostgreSQL
  participant Redis
  participant Customer

  Agent->>API: Create ticket message
  API->>PG: Insert message and ticket event sequence
  API->>Redis: Publish wake-up
  Redis-->>Customer: SSE wake-up
  Customer->>API: Reconnect with lastEventId
  API->>PG: Fetch missed durable events
  API-->>Customer: Replay ordered events
```

Key contracts:
- Pagination must be bounded.
- A reconnect should replay events after the client cursor.
- The general live channel is transient; durable replay claims apply to ticket-specific event streams.

## Evidence Commands

For a reviewer with Docker running:

```bash
npm run evidence:local
```

The command stores logs and metadata in `docs/evidence/local-demo/<run-id>/`. It runs static checks, starts local dependencies, migrates and seeds the database, runs DB verification scripts, runs ReplayLab scenarios, and creates a benchmark plan artifact. If any dependency is unavailable, it stops and records the failed command instead of fabricating a pass.
