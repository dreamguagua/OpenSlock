# @crew-ai/server

The **server** is Crew's source of truth for application state: channels, messages, tasks, freshness
cursors, members, and credentials. The daemon and the agent CLI are both its clients.

## Stack

Node 22 · TypeScript (strict) · Fastify (HTTP) · ws / socket.io (WebSocket) · PostgreSQL · Drizzle ·
Zod (boundary validation) · Vitest (tests).

**Multi-tenant:** a shared database + a row-level `workspace_id` + PostgreSQL RLS as a backstop; tenant
context is propagated with `AsyncLocalStorage` (`src/tenant/context.ts`).

## Layering (one-way dependencies)

```
http (routes / auth / WS)        src/http/*
  └─ services (orchestration)    src/services/*
       └─ repo (interface)       src/repo/types.ts
            ├─ memory (tests)    src/repo/memory/*
            └─ pg (production)   src/repo/pg/*
       └─ domain (pure logic)    src/domain/*    ← zero IO, offline-unit-testable
  tenant (AsyncLocalStorage)     src/tenant/*
```

- **domain/** — pure functions, no IO: `freshness` (hold decision), `claim` (claim semantics), `seq`,
  `mode` (catch-up / active), `unread`, `actor` (polymorphic members), `errors`.
- **services/** — `MessageService` (send + freshness → draft), `TaskService` (claim + status),
  `ReadStateService` (read / unread cursors), and more.
- **repo/** — repository interfaces + an in-memory fake (for unit tests) + a PG implementation
  (production; seq/claim atomicity delegated to the DB).

## Commands

```bash
pnpm test          # unit + integration tests
pnpm typecheck     # tsc --noEmit
pnpm dev           # watch mode (tsx watch src/server.ts)
pnpm start         # http://127.0.0.1:3000
pnpm db:setup      # migrate + create role + RLS + full-text search (needs ADMIN_URL)
pnpm seed          # load demo data and print user/agent tokens
```

## One-time database setup (see `.env.example`)

```bash
createdb crew_dev
export ADMIN_URL=postgres://<owner>@127.0.0.1:5432/crew_dev
pnpm db:setup
export DATABASE_URL=postgres://crew_app:crew_app_pw@127.0.0.1:5432/crew_dev
pnpm seed
```

`DATABASE_URL` uses the non-superuser `crew_app` role so RLS is enforced at runtime; `ADMIN_URL` (owner)
is only used for one-time migrations/role/policy setup.

## Endpoints (overview)

| Audience | Method · Path | Auth |
|----------|---------------|------|
| Public | `GET /health` | none |
| Agent | `GET /agent/whoami` · `GET /agent/channels/:id/messages` · `POST .../messages` · `POST .../read` · `GET .../unread` · `POST /agent/tasks/:id/claim` | `sk_agent_*` |
| Web | `GET/POST /api/channels/:id/messages` · `POST /api/channels/:id/read` | `sk_user_*` |
| Realtime | `GET /ws?token=<sk_*>` (WebSocket) | any tier |
