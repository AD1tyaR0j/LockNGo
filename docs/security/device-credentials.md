# Device credentials (Milestone 1)

- Each device gets its own random 256-bit token at registration (`POST /api/v1/admin/devices`).
  The token is returned **once**. Only its SHA-256 is stored (`devices.credential_hash`). A hash of
  a high-entropy random token is sufficient; no salt or slow hash is needed.
- No shared secret across devices. Rotation: re-register, or re-run the seed for simulated devices.
- Seeded simulated-device tokens are written to `.sim-devices.json` (mode 0600, git-ignored).
- Device tokens are not accepted on user routes, and user tokens are not accepted on device routes.
- Phase 2 replaces bearer tokens with per-device X.509 client certificates (mTLS to the MQTT
  broker), provisioned through a documented factory/installation procedure with revocation.
