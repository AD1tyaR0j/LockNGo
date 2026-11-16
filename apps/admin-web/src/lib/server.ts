import 'server-only';

/**
 * Server-only helpers. The API session token lives in an httpOnly cookie and is never
 * readable by browser JavaScript; the browser talks to this app's /api/* route handlers,
 * which forward to the backend with the token attached.
 */
export const SESSION_COOKIE = 'sl_admin_session';

export function apiBase(): string {
  const url = process.env.ADMIN_API_URL;
  if (!url) throw new Error('ADMIN_API_URL is not configured');
  return url.replace(/\/$/, '');
}

/** Any of these grants access to the admin console. Real authorization happens in the API. */
export const STAFF_PERMISSIONS = [
  'admin:dashboard:read',
  'admin:outlets:read',
  'admin:bookings:read',
];

/** Custom header that cross-site forms cannot send: CSRF protection alongside SameSite=Strict. */
export const CSRF_HEADER = 'x-admin-web';
