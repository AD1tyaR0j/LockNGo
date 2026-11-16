import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Role } from '@sl/shared';
import { getDb } from '../db/client.js';
import { devices, sessions, users } from '../db/schema.js';
import { sha256 } from '../lib/crypto.js';
import { forbidden, unauthenticated } from '../lib/errors.js';
import { clock } from '../lib/clock.js';
import type { PermissionKey } from '../modules/rbac/permissions.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  sessionId: string;
  roles: Role[];
  permissions: Set<string>;
}

export interface AuthDevice {
  id: string;
  deviceIdentifier: string;
  lockerBankId: string;
  isSimulated: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    user?: AuthUser;
    device?: AuthDevice;
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}

function bearer(req: Request): string | undefined {
  const h = req.header('authorization');
  if (!h?.startsWith('Bearer ')) return undefined;
  const token = h.slice(7).trim();
  return token.length >= 20 && token.length <= 200 ? token : undefined;
}

/** Resolves the user session from the bearer token. Roles come from the DB, never the client. */
export async function authenticateUser(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) return next();
  const db = getDb();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, clock.now()),
      ),
    )
    .limit(1);
  if (!row || row.status !== 'ACTIVE') return next();

  const grants = await db.execute<{ role: Role; permission: string | null }>(sql`
    SELECT r.name AS role, p.key AS permission
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ${row.userId}`);
  const roles = new Set<Role>();
  const perms = new Set<string>();
  for (const g of grants.rows) {
    roles.add(g.role);
    if (g.permission) perms.add(g.permission);
  }
  req.user = {
    id: row.userId,
    name: row.name,
    email: row.email,
    sessionId: row.sessionId,
    roles: [...roles],
    permissions: perms,
  };
  next();
}

export function requireUser(req: Request): AuthUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}

export function requirePermission(...keys: PermissionKey[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = requireUser(req);
    if (!keys.every((k) => user.permissions.has(k))) throw forbidden();
    next();
  };
}

/** Device authentication: per-device bearer token, compared by hash. */
export async function requireDevice(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) throw unauthenticated();
  const [d] = await getDb()
    .select({
      id: devices.id,
      deviceIdentifier: devices.deviceIdentifier,
      lockerBankId: devices.lockerBankId,
      isSimulated: devices.isSimulated,
      status: devices.status,
    })
    .from(devices)
    .where(eq(devices.credentialHash, sha256(token)))
    .limit(1);
  if (!d || d.status === 'DECOMMISSIONED') throw unauthenticated();
  req.device = {
    id: d.id,
    deviceIdentifier: d.deviceIdentifier,
    lockerBankId: d.lockerBankId,
    isSimulated: d.isSimulated,
  };
  next();
}
