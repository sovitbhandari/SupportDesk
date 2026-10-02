# Implementation Plan

## Repository Baseline

- No `AGENTS.md` file is present.
- Monorepo packages: `apps/backend`, `apps/frontend`, and `packages/db`.
- Runtime dependencies are PostgreSQL 16, Redis 7, and MailHog via `docker-compose.yml`.
- Current root commit inspected before Phase 1: `43bd67e3896225efd92a1721766c9f84e89e6e34`.
- Working tree was clean before changes.

## Confirmed Defects

## Phase 1 Route / Resource / Role Matrix

The current schema is a single-organization identity model. `users.organization_id` is required, `users.email` is globally unique, and `organization_memberships` has one row per `(organization_id, user_id)`. The UI exposes no active-organization switch, so JWTs should represent exactly one active organization and role. Multi-org switching is not a supported contract for this codebase.

| Area | Admin | Agent | Customer | Tenant contract |
| --- | --- | --- | --- | --- |
| Auth bootstrap: register/login/refresh/logout | Can register a new org as first admin; login/refresh own account | Login/refresh own active account | Login/refresh own active account | Bootstrap paths must validate active user, single org, and matching membership before issuing a token. They currently use owner credentials and need a narrow auth-specific mechanism before they can use RLS safely. |
| Profile | Read/update self | Read/update self | Read/update self | Scoped to JWT user and organization. |
| Organization | Read/update own org; creating extra orgs from inside an existing org is currently allowed by route but not reflected in UI identity switching | Read own org | Read own org | Supported contract is current organization only. In-app org creation should be reviewed because it creates data the identity model cannot switch into. |
| Users/employees | Create/update/list own-org users | List/read own-org users | No access | Membership joins must include both `user_id` and `organization_id` to avoid selecting a role from another org. |
| Tickets | Own-org CRUD; assignment/reassignment | Assigned-ticket update/read by default; claim unassigned | Create/read own tickets; no direct ticket update | Tenant-scoped SQL should run through app-role transactions with validated context. |
| Messages | Messages on accessible own-org tickets | Messages on assigned own-org tickets | Messages on requester-owned own-org tickets | Message creation now records a durable per-ticket event sequence; Redis is a wake-up path for connected streams. |
| Assignment | Assign/reassign/release own-org ticket assignments | Claim unassigned/release own assignment | No access | Parent ticket row is the lock scope; the DB unique partial index enforces one active assignment. |
| SSE | Own authorized events | Own authorized events; ticket-specific streams verify assignment before opening | Own authorized events; ticket-specific streams verify requester before opening | Ticket-specific streams replay persisted events after `lastEventId`; the general stream remains a legacy transient path. |
| Worker | Not user-facing | Not user-facing | Not user-facing | Worker identity is separate from request identity and must not infer scope from caller-provided org id alone. Phase 2 will narrow this with durable outbox scope. |

### Phase 1: Duplicate Active Ticket Assignments

- File anchors:
  - `apps/backend/src/routes/ticketRoutes.ts`, `POST /api/tickets/:id/assign`
  - `packages/db/migrations/001_init_schema.sql`, `ticket_assignments`
  - `packages/db/src/schema.ts`, `ticketAssignments`
- Defect: assignment creation performs an application-level active-assignment lookup and then inserts a new row, but the database has no uniqueness invariant for active assignments. Concurrent requests can both observe no active assignment and create multiple rows where `released_at IS NULL` for the same ticket.
- Chosen contract: for each `(organization_id, ticket_id)`, at most one `ticket_assignments` row may have `released_at IS NULL`.
- Fix shape: add a forward migration with a partial unique index on `(organization_id, ticket_id) WHERE released_at IS NULL`, record the same invariant in Drizzle schema metadata, and map the resulting PostgreSQL `23505` error to HTTP `409`.
- Alternatives considered:
  - `SELECT ... FOR UPDATE` on the ticket row before assignment insert. This serializes route code, but does not protect other writers or direct database writes.
  - Advisory locks keyed by ticket id. This is harder to reason about and less visible than a schema invariant.
  - Replacing history rows on reassignment. Rejected because assignment history should be preserved.
- Migration risks:
  - Existing databases with duplicate active assignments will fail the unique index migration. This is intentional; the operator must resolve the conflicting active rows explicitly rather than silently deleting or releasing history.
  - The migration is forward-only in the normal migration runner; rollback tooling is broad legacy rollback, not a per-migration down script.
- Acceptance checks:
  1. New migration is listed by the migration runner.
  2. A real PostgreSQL check proves a second active assignment for the same ticket fails with `23505`.
  3. A released historical assignment for the same ticket can coexist with the active assignment.
  4. Backend typecheck passes.
  5. DB package typecheck passes.

### Phase 2: Backend Does Not Exercise RLS in Normal Queries

- File anchors:
  - `apps/backend/src/lib/db.ts`
  - `packages/db/migrations/002_enable_rls.sql`
  - `packages/db/src/scripts/verifyIsolation.ts`
- Defect: RLS policies and the `app_user` role exist, but the backend pool historically defaulted to the configured `DATABASE_URL`, which points at the superuser in examples. Route handlers also filter by `organization_id`, so many paths have application-level tenant checks, but the normal backend path was not proven to run as `app_user` with `app.current_user_id` set per transaction.
- Chosen contract: migration/bootstrap credentials stay separate from tenant-scoped app credentials. Tenant-scoped routes move incrementally onto `withTenantTransaction`, which uses `APP_DATABASE_URL`, a single checked-out connection, `BEGIN`, `set_config('app.current_user_id', ..., true)`, validated identity, and guaranteed cleanup on commit/rollback.
- Alternatives to evaluate next:
  - Introduce request-scoped transaction helpers that set `app.current_user_id` and use the restricted role.
  - Keep privileged operational pool only for migrations/seed and use a separate app pool for runtime.
  - Downgrade claims to application-level tenant filtering if RLS cannot be made a runtime contract in scope.
- Migration risks:
  - Moving runtime queries onto RLS may require route-by-route transaction boundaries.
  - Health checks, login, registration, and background workers need explicit context decisions.
- Acceptance checks:
  1. Runtime role/context contract documented.
  2. Integration check proves cross-tenant read/write denial through the same helper used by routes.
  3. Login/register and background jobs retain required access without privilege creep.

### Phase 3: Notification Job Persistence Is Not Atomic With Ticket Creation

- File anchors:
  - `apps/backend/src/routes/ticketRoutes.ts`, `POST /api/tickets`
  - `apps/backend/src/lib/queues.ts`
  - `packages/db/migrations/005_add_manual_support_tables.sql`, `notification_jobs`
- Defect: ticket creation commits immediately, then asynchronously enqueues a BullMQ job and writes a `notification_jobs` row. If enqueueing or the later insert fails, the ticket is created without durable notification state.
- Chosen contract to evaluate: ticket creation should either record a durable notification intent in the same database transaction or explicitly document notification as best-effort.
- Alternatives:
  - Transactional outbox row written with ticket creation, worker drains outbox into BullMQ.
  - Keep best-effort enqueue but remove resume claims implying durable notifications.
- Migration risks:
  - Existing tickets may lack notification job rows; backfill should be explicit and non-destructive if attempted.
- Acceptance checks:
  1. Failure injection proves no silent loss of notification intent for new tickets, or claim wording is downgraded.
  2. Worker retry semantics are measured with Redis when claimed.

### Phase 2 Implementation: Transactional Outbox And Notification Receipts

- File anchors:
  - `packages/db/migrations/010_add_transactional_outbox.sql`
  - `apps/backend/src/routes/ticketRoutes.ts`, `POST /api/tickets`
  - `apps/backend/src/worker.ts`
  - `packages/db/src/scripts/verifyOutbox.ts`
- Chosen contract:
  - Ticket creation inserts the ticket, a `ticket.created.notification_requested` outbox event, and a `ticket.created` audit row in one tenant-scoped PostgreSQL transaction.
  - The request returns after the database transaction commits. It does not wait for Redis, BullMQ, SMTP, or an email provider response.
  - The worker dispatches pending outbox rows to BullMQ with the outbox event id as the stable BullMQ `jobId`.
  - `notification_jobs` is now a stable per-event operation record for new events when `event_id` is present; `notification_attempts` stores attempt history.
  - SMTP delivery is at-least-once within the tested design. A crash after SMTP acceptance but before the database receipt update can produce a duplicate on retry unless the provider supplies and honors an idempotency key. This code does not claim exactly-once external effects.
- Failure semantics:
  - Redis unavailable after ticket commit leaves an outbox event eligible for retry by the dispatcher.
  - Missing recipient email records a skipped operation instead of an "Email Sent" success.
  - Worker logs include job/event identifiers and errors, not ticket subject/body/email.
  - BullMQ duplicate behavior is bounded by the configured job id and the tested BullMQ version; because completed jobs are removed, BullMQ is not treated as perpetual deduplication. The database receipt remains the durable dedupe check.
- Migration risks:
  - Existing `notification_jobs` rows are preserved. New event-linked rows use nullable `event_id` plus a partial unique index so old rows do not need destructive backfill.
  - `outbox_events` is RLS-protected for app-role inserts. Worker processing currently uses owner credentials to process explicit event ids; a narrower worker role remains a follow-up before making stronger least-privilege claims.
- Acceptance checks:
  1. `npm run api:typecheck` passes.
  2. `npm --workspace @zendesk-lite/db run typecheck` passes.
  3. `npm --workspace @zendesk-lite/db run verify:outbox` passes against the compose database.
  4. With Redis stopped after ticket commit, the committed outbox row remains recoverable.
  5. Duplicate BullMQ deliveries for one event produce one terminal operation row and append attempts rather than creating multiple operation records.

### Phase 3 Implementation: Bounded Pagination And Ticket Event Replay

- File anchors:
  - `packages/db/migrations/011_add_ticket_message_events.sql`
  - `apps/backend/src/routes/ticketRoutes.ts`, ticket list and message routes
  - `apps/backend/src/routes/streamRoutes.ts`
  - `apps/frontend/src/hooks/useSseMessages.ts`
  - `packages/db/src/scripts/verifyTicketEventReplay.ts`
- Chosen contract:
  - Ticket list uses bounded cursor pagination ordered by `(created_at, id)`.
  - Message list uses bounded cursor pagination over `ticket_events.sequence`.
  - New messages allocate a per-ticket sequence while holding the parent ticket row lock, then insert the message and durable `ticket_events` row in the same tenant transaction.
  - Ticket-specific SSE authorizes the ticket before opening the stream, replays persisted events with `sequence > lastEventId`, then listens for Redis wake-ups.
  - SSE frames include `id: <sequence>`, and the frontend reconnects with `lastEventId`, jittered backoff, and message-id deduplication.
  - Redis is not the source of truth; missed Redis wake-ups are recoverable from `ticket_events`.
- Migration risks:
  - Existing messages are backfilled into `ticket_events` using `(created_at, id)` ordering per ticket.
  - A counter row is initialized per ticket from existing events. If production data has inconsistent message timestamps, the backfilled historical order follows the stable timestamp/id contract, not a previously unavailable sequence.
- Remaining limitations:
  - Ticket-specific SSE has durable replay; the legacy general `/api/stream` path remains transient and should not be used for recoverability claims.
  - Revocation is checked before opening streams. Continuous mid-stream revocation checks are still pending.
  - Outgoing buffer behavior is fail-fast on backpressure; more nuanced slow-client handling can be added later.
- Acceptance checks:
  1. `npm run api:typecheck` passes.
  2. `npm --workspace @zendesk-lite/db run typecheck` passes.
  3. `npm run web:typecheck` passes.
  4. `npm run web:build` passes.
  5. `npm --workspace @zendesk-lite/db run verify:ticket-events` passes against the compose database.
  6. Manual or automated SSE check proves reconnect with `lastEventId` replays missed ticket messages without duplicate canonical message records.

## Phase Order

1. Enforce exactly one active ticket assignment per ticket at the database boundary.
2. Decide and implement the runtime RLS contract, or narrow claims accordingly.
3. Add bounded pagination and recoverable SSE.
4. Add operational observability, graceful shutdown, documented checks, and fail-closed CI.

### Phase 4 Implementation: Observability And Fail-Closed CI

- File anchors:
  - `apps/backend/src/middleware/requestContext.ts`
  - `apps/backend/src/lib/logger.ts`
  - `apps/backend/src/lib/metrics.ts`
  - `apps/backend/src/app.ts`
  - `apps/backend/src/server.ts`
  - `apps/backend/src/worker.ts`
  - `.github/workflows/ci.yml`
  - `package.json`
  - `README.md`
- Chosen contract:
  - Every HTTP response carries an `X-Request-Id`; generated or caller-provided request IDs appear in structured JSON request logs.
  - Operational logs avoid ticket subject/body/email and hash user ids before logging.
  - `/health` is a lightweight liveness endpoint. `/readyz` checks owner DB, app DB, and Redis. `/metrics` reports request counters/latency buckets, process memory, BullMQ queue counts, and outbox backlog/oldest age.
  - API shutdown on SIGINT/SIGTERM stops accepting new requests, waits for in-flight requests up to `SHUTDOWN_GRACE_MS`, then closes DB and Redis pools.
  - `npm run check` fails closed on backend typecheck, DB typecheck, frontend typecheck, or frontend build failure.
  - GitHub Actions CI runs static checks/build plus migrations, seed, and DB verification scripts against PostgreSQL/Redis service containers without `|| true` fallbacks.
- Remaining limitations:
  - CI workflow has been authored but not executed in GitHub Actions from this local environment.
  - The requested deliberate failing CI proof in a temporary branch remains pending because this task has no remote CI run artifact.
  - Metrics are in-process JSON snapshots, not Prometheus/OpenTelemetry export.
- Acceptance checks:
  1. `npm run check` passes locally.
  2. GitHub Actions workflow exists and contains fail-closed commands.
  3. Runtime `/readyz` and `/metrics` should be exercised once the compose database and Redis are available.
