# Zendesk-Lite Monorepo

Sprint 1 delivers the multi-tenant data foundation for the customer support platform.
Sprint 2 adds the core backend API with JWT auth, RBAC, and Zod validation.

## Monorepo Structure

- `apps/frontend` - frontend app placeholder
- `apps/backend` - Express TypeScript REST API (Sprint 2)
- `packages/db` - PostgreSQL schema, migrations, seed, and isolation verification scripts
- `docs/database-schema.md` - schema and RLS documentation

## Prerequisites

- Docker / Docker Compose
- Node.js 20+
- npm 10+

## Quickstart (Sprint 1)

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start PostgreSQL locally:

   ```bash
   npm run db:up
   ```

3. Apply schema and RLS migrations:

   ```bash
   npm run db:migrate
   ```

4. Seed two organizations:

   ```bash
   npm run db:seed
   ```

5. Verify tenant isolation at DB layer:

   ```bash
   npm run db:verify-isolation
   ```

Expected verification output:

- `RLS isolation verified: Org A user cannot read Org B ticket.`

6. (Optional) Rollback Sprint 1 DB objects:

   ```bash
   npm run db:rollback
   ```

## Hardening Additions

- **Migration ledger:** `schema_migrations` table is managed by `packages/db/src/scripts/migrate.ts` to ensure each migration runs once.
- **Rollback support:** `packages/db/migrations/999_rollback_sprint1.sql` and `npm run db:rollback` provide a clean reset path for local/dev recovery.
- **CI isolation gate:** `.github/workflows/db-isolation.yml` runs migrate + seed + isolation verification on every push and pull request.

## Backend API (Sprint 2)

1. Start API:

   ```bash
   npm run api:start
   ```

2. Dev mode with watch:

   ```bash
   npm run api:dev
   ```

3. Type-check API:

   ```bash
   npm run api:typecheck
   ```

## Acceptance Criteria Mapping

- **8 core tables:** implemented in `packages/db/migrations/001_init_schema.sql` and typed in `packages/db/src/schema.ts`.
- **RLS policies:** implemented in `packages/db/migrations/002_enable_rls.sql` with forced tenant checks.
- **Two-org seed data:** implemented in `packages/db/migrations/003_seed.sql`.
- **Cross-tenant query blocked at DB level:** demonstrated by `packages/db/src/scripts/verifyIsolation.ts` run through `npm run db:verify-isolation`.
