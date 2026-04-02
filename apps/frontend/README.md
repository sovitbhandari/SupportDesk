# Frontend App (Sprint 4)

React + Vite + TypeScript frontend with React Router and TanStack Query.

## Run

```bash
npm install
npm run db:up
npm run db:migrate
npm run db:seed
npm run api:start
npm run worker:start
npm run web:dev
```

Then open `http://localhost:5173`.

## UX Patterns Implemented

- Role-based dashboard routing (`admin`, `agent`, `customer`).
- Optimistic ticket creation for customers.
- Optimistic chat message send with rollback on failure.
- Agent claim action removes ticket from available queue instantly.
- SSE consumption from `/api/stream` to append live messages without refresh.


## Account Management (Sprint 4B)

- Signup page: `/signup`
- Profile settings: `/settings/profile`
- Users can:
  - create their own workspace + admin profile
  - update profile name/email
  - change password
