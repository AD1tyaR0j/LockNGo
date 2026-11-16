# ADR 0001 — Modular monolith, Express, Drizzle, PostgreSQL

**Status:** Accepted (Milestone 1)

**Decision.** One API process (`apps/api`) organised by domain module, with Express 5 +
TypeScript, PostgreSQL, Drizzle ORM and zod validation. Clients: Next.js admin, Expo customer
app. pnpm workspaces + Turborepo.

**Why.** One team, early product. Transactions that span bookings, payments and device
commands are far simpler in one database. Express over NestJS keeps the code small and explicit.
Drizzle over Prisma: no engine binary download, raw SQL is easy when we need `EXCLUDE`
constraints and `FOR UPDATE SKIP LOCKED`.

**Consequences.** Modules must not reach into each other's tables casually. Extract a service only
when scale or team structure needs it (the device ingestion path is the likely first candidate).
