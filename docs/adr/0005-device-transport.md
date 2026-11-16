# ADR 0005 — Device transport for Milestone 1

**Status:** Accepted for Milestone 1; superseded in Phase 2.

**Decision.** Devices use an internal HTTPS API (`/api/v1/devices/*`), separate from customer
routes. They authenticate with a per-device bearer token, poll for commands, ack them with a
nonce, and post events.
Events carry a device-generated UUID (deduplicated per device) and a monotonic sequence number.
Events at or below the last accepted sequence are stored as `OUT_OF_ORDER` and not applied.
Clock skew over 5 minutes is flagged.

**Why not MQTT yet.** It proves the state machine and failure handling end to end without broker
and PKI work. The device service functions are transport-agnostic, so Phase 2 adds an MQTT
consumer that calls them.

**Phase 2.** MQTT over TLS with per-device X.509 certificates, broker ACLs restricting each device to
`lockers/v1/devices/{id}/*`, signed command envelopes the controller verifies, and certificate
revocation.
