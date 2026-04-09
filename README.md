# SupportDesk

SupportDesk is a lightweight, multi-tenant customer support platform with:
- authentication + RBAC
- ticket creation and assignment
- customer/agent messaging
- live updates (SSE)
- background notifications

## Screenshot

![SupportDesk Admin Workspace](docs/images/admin-workspace.png)

## Project structure

```text
SupportDesk/
├── apps
│   ├── backend
│   │   ├── package.json
│   │   ├── README.md
│   │   ├── .env.example
│   │   └── src
│   │       ├── app.ts
│   │       ├── server.ts
│   │       ├── worker.ts
│   │       ├── config.ts
│   │       ├── middleware
│   │       │   ├── auth.ts
│   │       │   └── rbac.ts
│   │       ├── lib
│   │       │   ├── db.ts
│   │       │   ├── redis.ts
│   │       │   ├── events.ts
│   │       │   ├── queues.ts
│   │       │   ├── types.ts
│   │       │   └── validation.ts
│   │       ├── routes
│   │       │   ├── authRoutes.ts
│   │       │   ├── organizationRoutes.ts
│   │       │   ├── userRoutes.ts
│   │       │   ├── ticketRoutes.ts
│   │       │   ├── streamRoutes.ts
│   │       │   ├── profileRoutes.ts
│   │       │   └── adminRoutes.ts
│   │       └── scripts
│   │           └── sprint3Smoke.ts
│   └── frontend
│       ├── package.json
│       ├── README.md
│       ├── index.html
│       ├── vite.config.ts
│       ├── tsconfig.json
│       └── src
│           ├── main.tsx
│           ├── App.tsx
│           ├── styles.css
│           ├── api
│           │   ├── client.ts
│           │   └── endpoints.ts
│           ├── hooks
│           │   ├── useAuth.tsx
│           │   └── useSseMessages.ts
│           ├── components
│           │   ├── Layout.tsx
│           │   ├── ProtectedRoute.tsx
│           │   └── ChatPanel.tsx
│           ├── pages
│           │   ├── LoginPage.tsx
│           │   ├── SignupPage.tsx
│           │   ├── UnauthorizedPage.tsx
│           │   ├── ProfilePage.tsx
│           │   ├── DashboardRouter.tsx
│           │   ├── AdminDashboard.tsx
│           │   ├── AgentDashboard.tsx
│           │   ├── UserDashboard.tsx
│           │   ├── ViewsPage.tsx
│           │   ├── TicketsPage.tsx
│           │   └── CustomersPage.tsx
│           └── types
│               └── index.ts
├── packages
│   └── db
│       ├── package.json
│       ├── src
│       │   ├── client.ts
│       │   ├── config.ts
│       │   ├── schema.ts
│       │   └── scripts
│       │       ├── migrate.ts
│       │       ├── seed.ts
│       │       ├── rollback.ts
│       │       └── verifyIsolation.ts
│       └── migrations
│           ├── 001_init_schema.sql
│           ├── 002_enable_rls.sql
│           ├── 003_seed.sql
│           ├── 004_fix_rls_recursion.sql
│           ├── 005_add_manual_support_tables.sql
│           ├── 006_hash_legacy_passwords.sql
│           └── 999_rollback_sprint1.sql
├── docs
│   ├── database-schema.md
│   └── images
│       └── admin-workspace.png
├── docker-compose.yml
├── .env.example
├── package.json
└── README.md
```

## Prerequisites (install once)

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker + Compose)
- Node.js 20+
- npm 10+

## Run locally (beginner-friendly)

From the repository root:

1. Install dependencies
   ```bash
   npm install
   ```

2. Start local services (database, redis, mail testing)
   ```bash
   npm run db:up
   ```

3. Apply database migrations
   ```bash
   npm run db:migrate
   ```

4. Seed sample users and data
   ```bash
   npm run db:seed
   ```

5. Start the app (API + frontend together)
   ```bash
   npm run dev
   ```

6. Open the app
   - Frontend UI: `http://localhost:5173`
   - API health check: `http://localhost:4000/health`

## Demo accounts

- Admin: `amy.admin@acme.com`
- Agent: `adam.agent@acme.com`
- Customer: `alice.customer@acme.com`
- Password (all seeded users): `hashed-password`

## Useful commands

```bash
npm run api:typecheck
npm run web:typecheck
npm run db:verify-isolation
npm run db:down
```

## Troubleshooting

- **“This site can’t be reached” on port 5173**
  - make sure `npm run dev` is running
- **Login fails with seeded users**
  - run `npm run db:migrate` and `npm run db:seed` again
- **API errors about DB**
  - confirm Docker is running and `npm run db:up` completed successfully
