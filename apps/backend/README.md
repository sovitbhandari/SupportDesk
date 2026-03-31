# Backend API (Sprint 2 + Sprint 3)

Express + TypeScript REST API with JWT auth, RBAC, Zod validation, Redis/BullMQ background jobs, and SSE live updates.

## Run

```bash
npm install
npm run db:up
npm run db:migrate
npm run db:seed
npm run api:start
npm run worker:start
```

Health check:

```bash
curl http://localhost:4000/health
```

## Auth

- Login endpoint: `POST /api/auth/login`
- JWT includes: `sub`, `organizationId`, `role`, `email`
- Protected routes require `Authorization: Bearer <token>`

## Core Endpoints (19)

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/organizations`
- `GET /api/organizations/:id`
- `POST /api/organizations` (admin)
- `PATCH /api/organizations/:id` (admin)
- `GET /api/users`
- `GET /api/users/:id`
- `POST /api/users` (admin)
- `PATCH /api/users/:id` (admin or self)
- `GET /api/tickets`
- `GET /api/tickets/:id`
- `POST /api/tickets`
- `PATCH /api/tickets/:id`
- `DELETE /api/tickets/:id` (admin)
- `GET /api/tickets/:id/messages`
- `POST /api/tickets/:id/messages`
- `POST /api/tickets/:id/assign` (agent/admin)
- `DELETE /api/tickets/:id/assign` (agent/admin)

## Real-time + Queue (Sprint 3)

- SSE stream endpoint: `GET /api/stream`
- On ticket creation, API responds `201` immediately and enqueues a BullMQ job (`ticket-notifications`).
- Worker (`npm run worker:start`) processes jobs and logs `Email Sent`.
- When an agent/admin posts a message, server publishes to Redis pub/sub and pushes to the ticket requester via SSE.

## Smoke Test

With API + worker running:

```bash
npm --workspace @zendesk-lite/backend run smoke:sprint3
```

It prints JSON including API response time and SSE delivery latency.
