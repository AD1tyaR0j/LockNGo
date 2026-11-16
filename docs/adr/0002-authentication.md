# ADR 0002 — Authentication and sessions

**Status:** Accepted for development; revisit before pilot.

**Decision.** Email + password hashed with scrypt (N=2^15). Login returns an opaque 256-bit
bearer token. Only its SHA-256 hash is stored in `sessions`, so sessions can be revoked (logout,
compromise). Roles and permissions are always loaded from the database on every request.
Self-registration grants only `CUSTOMER`. Routes check permission keys, not role names.

Admin web never exposes the token to browser JavaScript. Its Next.js route handlers keep the token
in an httpOnly, SameSite=Strict cookie and forward only to the `admin/*` and `me` API paths.
Mutations also require a custom header, as CSRF defence in depth. The mobile app stores the token in the
OS keystore (expo-secure-store). On web it keeps the token in memory only.

**Pending.** Phone OTP via an approved Indian SMS provider, MFA for staff, refresh-token rotation,
device/session management UI, account recovery.
