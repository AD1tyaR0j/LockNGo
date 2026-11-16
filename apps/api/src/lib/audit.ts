import type { DbOrTx } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

export type Actor =
  | { type: 'USER'; id: string }
  | { type: 'DEVICE'; id: string }
  | { type: 'SYSTEM'; id?: string };

export interface AuditEntry {
  actor: Actor;
  action: string;
  resourceType: string;
  resourceId?: string;
  requestId?: string;
  /** Safe metadata only. Never include PINs, tokens, passwords or full contact details. */
  metadata?: Record<string, unknown>;
}

export async function audit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actorType: entry.actor.type,
    actorId: entry.actor.id ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    requestId: entry.requestId ?? null,
    metadata: entry.metadata ?? {},
  });
}
