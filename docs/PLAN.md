# Implementation plan

## 1. Repository assessment (at start)

The working directory was empty: no git repo, no code, and no linked GitHub repository.
Toolchain available: Node 22, pnpm 10, PostgreSQL 16, Redis. Docker daemon unavailable in the build
sandbox, so Postgres ran natively there; `docker-compose.yml` is provided for local machines.
Nothing existed to reuse, so a new monorepo was created following the blueprint layout.

## 2. Architecture (as built)

Modular monolith (`apps/api`) with modules: auth, rbac, outlets, inventory, pricing, storage
(bookings, credentials, access), payments, devices, admin, and a sweeper job. Clients:
`admin-web` (Next.js, BFF pattern) and `customer-mobile` (Expo). `device-simulator` talks to the
device API exactly as firmware would. Decisions are recorded in [`adr/`](adr/).

## 3. Phases

| Phase | Scope                                                                                                | Status            |
| ----- | ---------------------------------------------------------------------------------------------------- | ----------------- |
| 0     | Monorepo, lint/format/typecheck/test, migrations, seed, ADRs                                         | Done              |
| 1     | Storage MVP with simulated lockers (Milestone 1)                                                     | Done (see README) |
| 2     | IoT platform: MQTT/TLS, per-device certs, health dashboard, maintenance tickets, admin scenario tool | Next              |
| 3     | Locker-to-door delivery + courier app                                                                | Not started       |
| 4     | Partner and maintenance portal                                                                       | Not started       |
| 5     | Parcel MVP                                                                                           | Not started       |
| 6     | Pilot hardening                                                                                      | Not started       |

### Recommended next milestone

Finish Phase 1 hardening, then Phase 2:

1. Phone OTP login (needs SMS provider), MFA for staff, admin user and role management UI.
2. Booking extension, overstay fees, admin pricing-rule editor (versioned).
3. Real payment adapter (Razorpay sandbox) with refunds.
4. MQTT broker (Mosquitto locally) with per-device X.509 certificates and topic ACLs; signed
   command envelopes; simulator moved onto MQTT.
5. Maintenance tickets created automatically from `NEEDS_INSPECTION` events.
6. Run the customer app on a physical Android device.

## 4. Missing credentials, services and hardware

| Need                                                              | For                                  | Status  |
| ----------------------------------------------------------------- | ------------------------------------ | ------- |
| Payment gateway merchant account (e.g. Razorpay) + webhook secret | Real payments, refunds               | Missing |
| SMS/OTP provider (DLT-registered sender in India)                 | Phone login, recipient OTP           | Missing |
| Google Maps Platform key                                          | Distance sort, delivery quotes       | Missing |
| Firebase project (FCM)                                            | Push notifications                   | Missing |
| Managed MQTT broker or hosted Mosquitto + PKI                     | Device fleet                         | Missing |
| S3-compatible storage                                             | Partner documents, delivery evidence | Missing |
| Locker hardware vendor, controller board, lock and door sensors   | Physical pilot                       | Missing |
| Hosting (API, Postgres, web), secret manager, error tracking      | Staging/production                   | Missing |
| Apple/Google developer accounts                                   | Mobile distribution                  | Missing |

## 5. Key risks

| Area                | Risk                                                             | Current mitigation                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Booking concurrency | Double-booking under load                                        | Row locks with `SKIP LOCKED` + fresh re-check + Postgres `EXCLUDE` constraint; race test                                                                |
| Payments            | Client claims success; duplicate/late webhooks; amount tampering | Server-side signed webhooks only; idempotent event table; late capture → refund flag; amount check                                                      |
| Physical access     | Unlocking the wrong compartment; replay; insider misuse          | Commands bound to one compartment+booking, 60 s TTL, nonce, one in-flight per compartment; no manual-unlock UI; full audit                              |
| Device sync         | Door state disagrees with booking state                          | Booking advances only on validated open→close; timeouts and door-left-open flag compartments for inspection; out-of-order events stored but not applied |
| Device identity     | Shared or leaked device secrets                                  | Per-device random tokens stored as SHA-256 hashes, shown once; Phase 2 moves to mTLS certs                                                              |
| Personal data       | Over-exposure to staff or partners                               | Ownership checks return 404; staff booking views are audited; logs redact secrets and omit bodies                                                       |
| Simulated vs real   | Mistaking demo data for production                               | `is_simulated`, `is_demo`, `isMock` flags surfaced in API and UI; mock provider refuses production                                                      |
| Overstay            | Items left past paid window                                      | Compartment stays blocked while booking is ACTIVE; fee policy is an open decision                                                                       |

Full threat model: [`security/threat-model.md`](security/threat-model.md).

## 6. Open product decisions (not invented; safe dev defaults used)

1. Brand/app name: placeholder "Smart Locker".
2. Pilot city/outlets: demo Bengaluru and Mumbai outlets only.
3. Sizes/weight limits: S/M/L/XL with demo weights.
4. Pricing, late-collection/overstay fees: demo rates flagged `is_demo`; overstay is allowed and free.
5. Refund and cancellation policy: cancellation allowed before deposit; payment flagged `REFUND_REQUIRED`.
6. After-hours access: access refused outside outlet hours; retrieval during closed hours is undecided.
7. What happens to bookings when a compartment is disabled (reallocate, refund?): admin sees the affected bookings, and resolution is manual.
8. Staffed vs unattended outlets, emergency access procedure.
9. Courier model, verification requirements, insurance/liability, prohibited items.
10. Legal/tax/privacy review (GST treatment of the 18% demo tax is a placeholder, DPDP Act compliance).
11. Device connectivity, backup power and offline-access policy.
