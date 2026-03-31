# Backend API (Sprint 2)

Express + TypeScript REST API with JWT auth, RBAC, and Zod validation.

## Run

```bash
npm install
npm run db:up
npm run db:migrate
npm run db:seed
npm run api:start
```

Health check:

```bash
curl http://localhost:4000/health
```

## Auth

- Login endpoint: `POST /api/auth/login`
- JWT includes: `sub`, `organizationId`, `role`, `email`
- Protected routes require `Authorization: Bearer <token>`

## Core Endpoints (15+)

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

## Validation

All route bodies/params are validated with Zod before DB calls. Validation failures return:

- HTTP `400`
- payload with `error=ValidationError`, source, and issue list.
