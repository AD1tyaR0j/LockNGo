import { and, eq, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { compartments, deviceCommands, devices, storageBookings } from '../db/schema.js';
import { audit, type Actor } from '../lib/audit.js';
import { addSeconds, clock } from '../lib/clock.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import { revokeCredentials } from '../modules/storage/service.js';
import { recordBookingEvent, transitionBooking } from '../modules/storage/transitions.js';

const SYSTEM: Actor = { type: 'SYSTEM', id: 'sweeper' };
const HEALTH_SNAPSHOT_RETENTION_DAYS = 7;

export interface SweepResult {
  expiredHolds: number;
  expiredUnused: number;
  expiredCommands: number;
  doorLeftOpen: number;
  devicesOffline: number;
  prunedSessions: number;
  prunedHealthSnapshots: number;
}

/**
 * Time-based state reconciliation. Each item is handled in its own transaction with
 * compare-and-set updates, so it is safe to run concurrently with request handlers
 * and on several instances.
 */
export async function runSweep(): Promise<SweepResult> {
  const db = getDb();
  const now = clock.now();
  const result: SweepResult = {
    expiredHolds: 0,
    expiredUnused: 0,
    expiredCommands: 0,
    doorLeftOpen: 0,
    devicesOffline: 0,
    prunedSessions: 0,
    prunedHealthSnapshots: 0,
  };

  // 1. Unpaid holds past their payment window release inventory.
  const holds = await db
    .select({ id: storageBookings.id })
    .from(storageBookings)
    .where(
      and(
        eq(storageBookings.status, 'PENDING_PAYMENT'),
        lte(storageBookings.paymentHoldExpiresAt, now),
      ),
    );
  for (const { id } of holds) {
    if (await tryTransition(id, 'PENDING_PAYMENT', 'EXPIRED', 'PAYMENT_HOLD_EXPIRED'))
      result.expiredHolds++;
  }

  // 2. Paid bookings whose window ended without any deposit.
  const unused = await db
    .select({ id: storageBookings.id, status: storageBookings.status })
    .from(storageBookings)
    .where(
      and(
        inArray(storageBookings.status, ['CONFIRMED', 'ACCESS_READY']),
        lte(storageBookings.expiresAt, now),
      ),
    );
  for (const b of unused) {
    const from = b.status as 'CONFIRMED' | 'ACCESS_READY';
    if (await tryTransition(b.id, from, 'EXPIRED', 'BOOKING_WINDOW_ENDED_UNUSED'))
      result.expiredUnused++;
  }

  // 3. Unlock commands that never led to a door opening.
  const stale = await db
    .update(deviceCommands)
    .set({ status: 'EXPIRED', resultDetail: 'TIMED_OUT' })
    .where(
      and(
        inArray(deviceCommands.status, ['PENDING', 'DELIVERED', 'ACKNOWLEDGED']),
        isNull(deviceCommands.doorOpenedAt),
        lte(deviceCommands.expiresAt, now),
      ),
    )
    .returning();
  for (const c of stale) {
    result.expiredCommands++;
    await db.transaction(async (tx) => {
      if (c.bookingId) {
        await recordBookingEvent(tx, c.bookingId, 'UNLOCK_TIMED_OUT', SYSTEM, { commandId: c.id });
      }
      await audit(tx, {
        actor: SYSTEM,
        action: 'device.unlock_timed_out',
        resourceType: 'device_command',
        resourceId: c.id,
      });
    });
  }

  // 4. Door opened but never reported closed: fail the command and flag the compartment.
  const openTooLong = await db
    .select()
    .from(deviceCommands)
    .where(
      and(
        inArray(deviceCommands.status, ['DELIVERED', 'ACKNOWLEDGED']),
        isNotNull(deviceCommands.doorOpenedAt),
        lt(deviceCommands.doorOpenedAt, addSeconds(now, -config().DOOR_CLOSE_TIMEOUT_SECONDS)),
      ),
    );
  for (const c of openTooLong) {
    await db.transaction(async (tx) => {
      const upd = await tx
        .update(deviceCommands)
        .set({ status: 'FAILED', resultDetail: 'DOOR_LEFT_OPEN' })
        .where(
          and(
            eq(deviceCommands.id, c.id),
            inArray(deviceCommands.status, ['DELIVERED', 'ACKNOWLEDGED']),
          ),
        )
        .returning({ id: deviceCommands.id });
      if (!upd.length) return;
      result.doorLeftOpen++;
      await tx
        .update(compartments)
        .set({ operationalStatus: 'NEEDS_INSPECTION' })
        .where(
          and(
            eq(compartments.id, c.compartmentId),
            eq(compartments.operationalStatus, 'IN_SERVICE'),
          ),
        );
      if (c.bookingId) {
        await recordBookingEvent(tx, c.bookingId, 'DOOR_LEFT_OPEN', SYSTEM, { commandId: c.id });
      }
      await audit(tx, {
        actor: SYSTEM,
        action: 'compartment.door_left_open',
        resourceType: 'compartment',
        resourceId: c.compartmentId,
        metadata: { commandId: c.id },
      });
    });
  }

  // 5. Devices that stopped sending heartbeats.
  const offline = await db
    .update(devices)
    .set({ status: 'OFFLINE' })
    .where(
      and(
        eq(devices.status, 'ONLINE'),
        sql`(${devices.lastSeenAt} IS NULL OR ${devices.lastSeenAt} < ${addSeconds(now, -config().DEVICE_OFFLINE_AFTER_SECONDS).toISOString()}::timestamptz)`,
      ),
    )
    .returning({ id: devices.id });
  for (const d of offline) {
    result.devicesOffline++;
    await audit(db, {
      actor: SYSTEM,
      action: 'device.status_changed',
      resourceType: 'device',
      resourceId: d.id,
      metadata: { to: 'OFFLINE', reason: 'HEARTBEAT_TIMEOUT' },
    });
  }

  // 6. Retention: expired/revoked sessions (kept 1 day for debugging) and device health
  //    snapshots older than the retention window. Audit tables are never pruned here.
  const pruned = await db.execute(sql`
    DELETE FROM sessions
    WHERE expires_at < ${addSeconds(now, -86_400).toISOString()}::timestamptz
       OR revoked_at < ${addSeconds(now, -86_400).toISOString()}::timestamptz`);
  result.prunedSessions = pruned.rowCount ?? 0;
  const snaps = await db.execute(sql`
    DELETE FROM device_health_snapshots
    WHERE recorded_at < ${addSeconds(now, -HEALTH_SNAPSHOT_RETENTION_DAYS * 86_400).toISOString()}::timestamptz`);
  result.prunedHealthSnapshots = snaps.rowCount ?? 0;

  return result;
}

async function tryTransition(
  bookingId: string,
  from: 'PENDING_PAYMENT' | 'CONFIRMED' | 'ACCESS_READY',
  to: 'EXPIRED',
  eventType: string,
): Promise<boolean> {
  try {
    await getDb().transaction(async (tx) => {
      await transitionBooking(tx, { bookingId, from, to, eventType, actor: SYSTEM });
      await revokeCredentials(tx, bookingId, eventType);
      await audit(tx, {
        actor: SYSTEM,
        action: 'booking.expired',
        resourceType: 'storage_booking',
        resourceId: bookingId,
        metadata: { from, reason: eventType },
      });
    });
    return true;
  } catch (err) {
    // STALE_STATE: a request handler moved the booking first (e.g. payment just captured).
    logger.debug({ err, bookingId }, 'sweep transition skipped');
    return false;
  }
}

export function startSweeper(): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await runSweep();
      if (Object.values(r).some((v) => v > 0)) logger.info({ sweep: r }, 'sweep applied changes');
    } catch (err) {
      logger.error({ err }, 'sweep failed');
    } finally {
      running = false;
    }
  }, config().SWEEPER_INTERVAL_SECONDS * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
