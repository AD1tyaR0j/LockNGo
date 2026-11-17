# Smart Locker & On-Demand Delivery Platform

India-focused smart-locker network: personal storage today; locker-to-door delivery, parcels,
partners and real IoT hardware in later phases. See [`docs/PLAN.md`](docs/PLAN.md) for the full
plan, risks and open decisions.

> **Status: Milestone 1 (storage vertical slice) — development only.**
> Payments are **MOCKED** (no money moves). Lockers are **SIMULATED** (no hardware). Both are
> labelled everywhere they appear: in API responses, the admin console and the customer app.

## What's in the repo

| Path                    | What                                                                         | Status                                    |
| ----------------------- | ---------------------------------------------------------------------------- | ----------------------------------------- |
| `apps/api`              | Express + TypeScript + Drizzle/PostgreSQL modular monolith                   | Real                                      |
| `apps/admin-web`        | Next.js admin console (server-side BFF, httpOnly session cookie)             | Real                                      |
| `apps/customer-mobile`  | Expo / React Native customer app (Expo Router), also runs on web for preview | Real (verified on web; not yet on device) |
| `apps/device-simulator` | CLI that plays a locker controller, with fault scenarios                     | **Simulation**                            |
| `packages/shared`       | Enums, zod schemas and API types shared by all apps                          | Real                                      |
| `docs/`                 | Plan, ADRs, security notes                                                   |                                           |

Not yet started: courier app, partner portal, parcel workflow, MQTT, real payment gateway.

## Local setup

Requires Node 22+, pnpm 10, and PostgreSQL 16 (native or via Docker).

```bash
pnpm install
```

```bash
docker compose up -d postgres
```

```bash
cp .env.example .env
```

Fill in `.env`: generate `ACCESS_PIN_PEPPER` (`openssl rand -base64 48`) and
`MOCK_PAYMENT_WEBHOOK_SECRET` (`openssl rand -hex 32`). The compose file's Postgres password is
`postgres`, matching the example `DATABASE_URL`.

```bash
pnpm db:seed
```

This applies migrations, syncs roles/permissions, and creates demo data. Simulated-device tokens are
written to `.sim-devices.json` (git-ignored). Re-running rotates them.

Run each in its own terminal:

```bash
pnpm --filter @sl/api dev
```

```bash
pnpm sim run --all
```

```bash
ADMIN_API_URL=http://localhost:4000 pnpm --filter @sl/admin-web dev
```

```bash
pnpm --filter @sl/customer-mobile web
```

- API: http://localhost:4000 (`/health` reports whether payments are mocked)
- Admin console: http://localhost:3000
- Customer app (web preview): http://localhost:8081. For a phone, run `pnpm --filter @sl/customer-mobile start`
  and set `EXPO_PUBLIC_API_URL` to your machine's LAN IP (Android emulator: `http://10.0.2.2:4000`).

### Demo accounts (local only)

Password: the value of `SEED_DEMO_PASSWORD`, or `LockerDemo#2026` if unset. The seed refuses to run when `NODE_ENV=production`.

| Email                  | Role          | Can                                                      |
| ---------------------- | ------------- | -------------------------------------------------------- |
| `customer@demo.local`  | CUSTOMER      | Book and use lockers                                     |
| `customer2@demo.local` | CUSTOMER      | Second customer for isolation testing                    |
| `admin@demo.local`     | ADMIN         | Outlets, inventory, devices, compartment status, audit   |
| `support@demo.local`   | SUPPORT_AGENT | Read-only bookings/outlets/devices (no audit, no writes) |

Seeded: 3 `[DEMO]` outlets (Bengaluru ×2, Mumbai), each with one locker bank of 10
compartments (S×4, M×3, L×2, XL×1) and one simulated controller. Koramangala has 08:00–23:00 hours; the
others are 24×7. Demo pricing rules are flagged `is_demo` and are **not** commercial prices.

### Device simulator

```bash
pnpm sim list
```

```bash
pnpm sim run --device SIM-BLR-IND-A --scenario door-stuck-open
```

```bash
pnpm sim pin --device SIM-BLR-IND-A --compartment M1 --code 123456
```

```bash
pnpm sim event --device SIM-BLR-IND-A --compartment S2 --type TAMPER_DETECTED
```

Scenarios: `normal`, `offline`, `no-ack`, `ack-fail`, `door-stuck-open`, `duplicate-events`,
`out-of-order`, `flaky`. Run `pnpm sim help` for descriptions.

## Quality checks

```bash
pnpm check
```

This runs Prettier, ESLint, TypeScript across all workspaces, and the API test suite. The suite drops and
recreates the schema of the database in `TEST_DATABASE_URL` (default `smartlocker_test`; it refuses any
database whose name doesn't end in `_test`).

60 API tests cover: concurrent double-booking (8 customers racing for one compartment), the
database `EXCLUDE` constraint, failed/late/duplicate/mis-signed/mis-priced payment webhooks, hold
expiry releasing inventory, cross-customer isolation, role permissions, device-event-driven
transitions, offline device, unlock timeout, door left open, unauthorised door opening, tamper,
event dedupe and out-of-order handling, cross-device isolation, PIN lockout/reissue, compartment
disable, append-only audit, and device token hashing.

Latest security & performance review: [`docs/security/review-2026-11.md`](docs/security/review-2026-11.md).

**Deploying behind a reverse proxy / load balancer?** Set `TRUST_PROXY_HOPS` to the number of
proxy hops; leave it `0` otherwise, or clients can fake their IP to bypass rate limits.

## Real vs simulated vs pending

| Area                                     | State                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Booking, pricing, inventory, RBAC, audit | Real, server-enforced, tested                                                             |
| Payments                                 | **Mock provider** behind a `PaymentProvider` interface; signed webhooks; Razorpay pending |
| Lockers / devices                        | **Simulated** via HTTP device API; MQTT + per-device certificates are Phase 2             |
| Auth                                     | Email + password (scrypt) with revocable opaque sessions; phone OTP and staff MFA pending |
| Maps, location sort                      | Not implemented; outlets are listed by city                                               |
| Notifications                            | Not implemented; in-app status is the source of truth                                     |
| Refund execution                         | Payments are flagged `REFUND_REQUIRED`; executing refunds awaits the refund policy        |
