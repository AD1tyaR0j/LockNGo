import { sql } from 'drizzle-orm';
import { ROLES } from '@sl/shared';
import type { Db } from '../../db/client.js';
import { permissions, rolePermissions, roles } from '../../db/schema.js';
import { PERMISSIONS, ROLE_PERMISSIONS } from './permissions.js';

/** Idempotently makes the DB role/permission tables match the code definitions. */
export async function syncRbac(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(roles)
      .values(ROLES.map((name) => ({ name })))
      .onConflictDoNothing();
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await tx
        .insert(permissions)
        .values({ key, description })
        .onConflictDoUpdate({ target: permissions.key, set: { description } });
    }
    await tx.delete(rolePermissions);
    for (const role of ROLES) {
      for (const key of ROLE_PERMISSIONS[role]) {
        await tx.execute(sql`
          INSERT INTO role_permissions (role_id, permission_id)
          SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = ${role} AND p.key = ${key}`);
      }
    }
  });
}
