# ADR 0004 — Compartment state vs booking state

**Status:** Accepted

The blueprint's single compartment state machine (AVAILABLE/RESERVED/OCCUPIED/…) does not hold
for time-slotted bookings, because a compartment can be free now and reserved tomorrow. So we split:

- **Stored on the compartment:** `operational_status` (IN_SERVICE / NEEDS_INSPECTION /
  OUT_OF_SERVICE), changed only by admin actions or device fault handling, and `door_state` as
  last reported by the device.
- **Stored on the booking:** the booking lifecycle (see `storage/state-machine.ts`).
- **Derived for display:** AVAILABLE / RESERVED / OCCUPIED / NEEDS_INSPECTION / OUT_OF_SERVICE,
  computed in SQL from both (`displayStatusSql`).

The backend owns business state. The device owns physical observations. A booking becomes
`ACTIVE` only after an authorised DEPOSIT unlock followed by a door open and then a door close. It becomes
`COMPLETED` only after the same sequence for RETRIEVE. Uncertain outcomes (door left open,
unauthorised opening, tamper) move the compartment to `NEEDS_INSPECTION` and never complete a booking.
Without a weight or presence sensor, an open/close cycle is taken as deposit. That limitation is
recorded in the threat model.
