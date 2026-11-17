import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { loginSchema, registerSchema, type AuthResponse, type Me, type Role } from '@sl/shared';
import { getDb, pgErrorCode, type DbOrTx } from '../../db/client.js';
import { roles, sessions, userRoles, users } from '../../db/schema.js';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  newOpaqueToken,
  sha256,
  verifyPassword,
} from '../../lib/crypto.js';
import { AppError, conflict } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { addHours, clock } from '../../lib/clock.js';
import { config } from '../../config.js';
import { requireUser } from '../../middleware/context.js';

const rateLimitedMessage = (req: { requestId: string }) => ({
  error: {
    code: 'RATE_LIMITED',
    message: 'Too many attempts. Try again later.',
    requestId: req.requestId,
  },
});
const testMode = () => config().NODE_ENV === 'test';

/**
 * Failed logins per client IP (the real socket address unless TRUST_PROXY_HOPS is set).
 * Successful logins are not counted: many Indian mobile users share one public IP behind
 * carrier-grade NAT, so counting every sign-in would lock out legitimate customers.
 */
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: () => (testMode() ? 1000 : 30),
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimitedMessage,
});

/** Account creation per client IP (all attempts count; limits scripted sign-up abuse). */
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: () => (testMode() ? 1000 : 20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimitedMessage,
});

/**
 * Per target account, counting only failed logins: stops credential guessing spread across
 * many IPs. Trade-off: an attacker can temporarily lock a known email out of password login
 * for the window; acceptable for MVP, revisit with OTP/CAPTCHA.
 */
const accountLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: () => (testMode() ? 1000 : 10),
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return `login:${email.slice(0, 254)}`;
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimitedMessage,
});

async function loadMe(db: DbOrTx, userId: string): Promise<Me> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  const grants = await db.execute<{ role: Role; permission: string | null }>(sql`
    SELECT r.name AS role, p.key AS permission FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ${userId}`);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    roles: [...new Set(grants.rows.map((g) => g.role))],
    permissions: [...new Set(grants.rows.flatMap((g) => (g.permission ? [g.permission] : [])))],
  };
}

async function createSession(db: DbOrTx, userId: string, userAgent?: string) {
  const token = newOpaqueToken();
  const expiresAt = addHours(clock.now(), config().SESSION_TTL_HOURS);
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    userAgent: userAgent?.slice(0, 200),
    expiresAt,
  });
  return { token, expiresAt };
}

export const authRouter = Router();

authRouter.post('/register', registerLimiter, async (req, res) => {
  const input = registerSchema.parse(req.body);
  const passwordHash = await hashPassword(input.password);
  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ name: input.name, email: input.email, phone: input.phone, passwordHash })
        .returning({ id: users.id });
      const [customerRole] = await tx.select().from(roles).where(eq(roles.name, 'CUSTOMER'));
      if (!user || !customerRole) throw new Error('RBAC not initialised; run migrations');
      // Self-registration only ever grants CUSTOMER. Other roles are assigned by admins.
      await tx.insert(userRoles).values({ userId: user.id, roleId: customerRole.id });
      await audit(tx, {
        actor: { type: 'USER', id: user.id },
        action: 'user.registered',
        resourceType: 'user',
        resourceId: user.id,
        requestId: req.requestId,
      });
      const session = await createSession(tx, user.id, req.header('user-agent'));
      return { ...session, me: await loadMe(tx, user.id) };
    });
    const body: AuthResponse = {
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      user: result.me,
    };
    res.status(201).json(body);
  } catch (err) {
    if (pgErrorCode(err) === '23505') {
      throw conflict('REGISTRATION_FAILED', 'Unable to register with these details');
    }
    throw err;
  }
});

authRouter.post('/login', loginIpLimiter, accountLoginLimiter, async (req, res) => {
  const input = loginSchema.parse(req.body);
  const db = getDb();
  const [u] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${input.email}`)
    .limit(1);
  // Always run the hash so response time does not reveal whether the account exists.
  const ok = await verifyPassword(input.password, u?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!u || !ok || u.status !== 'ACTIVE') {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  const session = await createSession(db, u.id, req.header('user-agent'));
  await audit(db, {
    actor: { type: 'USER', id: u.id },
    action: 'auth.login',
    resourceType: 'session',
    requestId: req.requestId,
  });
  const body: AuthResponse = {
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    user: await loadMe(db, u.id),
  };
  res.json(body);
});

authRouter.post('/logout', async (req, res) => {
  const user = requireUser(req);
  await getDb()
    .update(sessions)
    .set({ revokedAt: clock.now() })
    .where(and(eq(sessions.id, user.sessionId), isNull(sessions.revokedAt)));
  res.status(204).end();
});

export const meRouter = Router();
meRouter.get('/', async (req, res) => {
  const user = requireUser(req);
  res.json(await loadMe(getDb(), user.id));
});
