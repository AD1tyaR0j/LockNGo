# ADR 0003 — Double-booking prevention

**Status:** Accepted

Bookings are time ranges on a specific compartment. Three layers prevent overlaps:

1. **Allocation under lock.** `lockFreeCompartment` selects a candidate compartment
   `FOR UPDATE OF c SKIP LOCKED`, so concurrent requests pick different compartments. It then
   re-checks for overlaps in a _new statement_. Under READ COMMITTED that statement sees bookings
   committed after the first statement's snapshot.
2. **Database constraint.** `storage_bookings_no_overlap` is
   `EXCLUDE USING gist (compartment_id WITH =, tstzrange(starts_at, expires_at) WITH &&)`
   restricted to blocking statuses. It holds even if application code is bypassed. Violations map to a
   clean `409 NO_AVAILABILITY`.
3. **Items-inside rule.** A compartment with an `ACTIVE`/`DISPUTED` booking (items physically
   inside) is never offered, even after its paid window ends (overstay).

Unpaid holds (`PENDING_PAYMENT`) block inventory only until `payment_hold_expires_at`. A late
payment never confirms an expired hold; the payment is flagged `REFUND_REQUIRED` instead.

Tested by `booking.test.ts` (8-way race, raw-SQL overlap insert, hold expiry).
