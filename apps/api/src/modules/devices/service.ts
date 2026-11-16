import { and, eq, inArray, isNull, lte, gt, sql } from 'drizzle-orm';
import type { DeviceCommandAck, DeviceEventInput, DeviceHeartbeat } from '@sl/shared';
import { getDb, type Tx } from '../../db/client.js';
import {
  accessCredentials,
  compartments,
  deviceCommands,
  deviceEvents,
  deviceHealthSnapshots,
  devices,
  storageBookings,
} from '../../db/schema.js';
import { audit, type Actor } from '../../lib/audit.js';
import { clock } from '../../lib/clock.js';
import { safeEqualHex } from '../../lib/crypto.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { config } from '../../config.js';
import type { AuthDevice } from '../../middleware/context.js';
import { hashPin, issueUnlockCommand, revokeCredentials } from '../storage/service.js';
import { recordBookingEvent, transitionBooking } from '../storage/transitions.js';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const deviceActor = (d: AuthDevice): Actor => ({ type: 'DEVICE', id: d.id });

export async function recordHeartbeat(device: AuthDevice, hb: DeviceHeartbeat) {
  const db = getDb();
  const now = clock.now();
  await db.transaction(async (tx) => {
    const [prev] = await tx.select().from(devices).where(eq(devices.id, device.id)).for('update');
    if (!prev) throw notFound('Device');
    const nextStatus = prev.status === 'FAULT' ? 'FAULT' : 'ONLINE';
    await tx
      .update(devices)
      .set({ lastSeenAt: now, firmwareVersion: hb.firmwareVersion, status: nextStatus })
      .where(eq(devices.id, device.id));
    await tx.insert(deviceHealthSnapshots).values({
      deviceId: device.id,
      connectivity: hb.connectivity,
      powerState: hb.powerState,
      firmwareVersion: hb.firmwareVersion,
    });
    if (prev.status !== nextStatus) {
      await audit(tx, {
        actor: deviceActor(device),
        action: 'device.status_changed',
        resourceType: 'device',
        resourceId: device.id,
        metadata: { from: prev.status, to: nextStatus },
      });
    }
  });
  return { serverTime: now.toISOString() };
}

/** Returns unexpired commands for this device and marks them DELIVERED. */
export async function pollCommands(device: AuthDevice) {
  const now = clock.now();
  const rows = await getDb()
    .update(deviceCommands)
    .set({ status: 'DELIVERED', deliveredAt: now })
    .where(
      and(
        eq(deviceCommands.deviceId, device.id),
        inArray(deviceCommands.status, ['PENDING', 'DELIVERED']),
        gt(deviceCommands.expiresAt, now),
      ),
    )
    .returning();
  if (rows.length === 0) return [];
  const codes = await getDb()
    .select({ id: compartments.id, code: compartments.code })
    .from(compartments)
    .where(
      inArray(
        compartments.id,
        rows.map((r) => r.compartmentId),
      ),
    );
  const codeById = new Map(codes.map((c) => [c.id, c.code]));
  return rows.map((c) => ({
    commandId: c.id,
    deviceId: device.deviceIdentifier,
    compartmentCode: codeById.get(c.compartmentId)!,
    type: c.commandType,
    issuedAt: c.issuedAt.toISOString(),
    expiresAt: c.expiresAt.toISOString(),
    jobReference: c.bookingId,
    nonce: c.nonce,
  }));
}

export async function acknowledgeCommand(
  device: AuthDevice,
  commandId: string,
  ack: DeviceCommandAck,
) {
  return getDb().transaction(async (tx) => {
    const [cmd] = await tx
      .select()
      .from(deviceCommands)
      .where(and(eq(deviceCommands.id, commandId), eq(deviceCommands.deviceId, device.id)))
      .for('update');
    if (!cmd) throw notFound('Command');
    if (cmd.nonce !== ack.nonce)
      throw new AppError(400, 'NONCE_MISMATCH', 'Command nonce mismatch');
    const target = ack.result === 'OK' ? 'ACKNOWLEDGED' : 'FAILED';
    if (cmd.status === target || (target === 'ACKNOWLEDGED' && cmd.status === 'COMPLETED')) {
      return { status: cmd.status, duplicate: true }; // idempotent retry
    }
    if (cmd.status !== 'PENDING' && cmd.status !== 'DELIVERED') {
      throw conflict('COMMAND_NOT_ACKNOWLEDGEABLE', `Command is ${cmd.status}`);
    }
    const now = clock.now();
    if (cmd.expiresAt <= now) {
      await tx
        .update(deviceCommands)
        .set({ status: 'EXPIRED' })
        .where(eq(deviceCommands.id, cmd.id));
      throw new AppError(410, 'COMMAND_EXPIRED', 'Command expired before acknowledgement');
    }
    await tx
      .update(deviceCommands)
      .set({ status: target, acknowledgedAt: now, resultDetail: ack.detail ?? null })
      .where(eq(deviceCommands.id, cmd.id));
    if (cmd.bookingId) {
      await recordBookingEvent(
        tx,
        cmd.bookingId,
        ack.result === 'OK' ? 'UNLOCK_ACKNOWLEDGED' : 'UNLOCK_FAILED',
        deviceActor(device),
        { commandId: cmd.id, detail: ack.detail },
      );
    }
    await audit(tx, {
      actor: deviceActor(device),
      action: ack.result === 'OK' ? 'device.unlock_acknowledged' : 'device.unlock_failed',
      resourceType: 'device_command',
      resourceId: cmd.id,
    });
    return { status: target, duplicate: false };
  });
}

async function markNeedsInspection(
  tx: Tx,
  device: AuthDevice,
  compartmentId: string,
  reason: string,
) {
  const res = await tx
    .update(compartments)
    .set({ operationalStatus: 'NEEDS_INSPECTION' })
    .where(
      and(eq(compartments.id, compartmentId), eq(compartments.operationalStatus, 'IN_SERVICE')),
    )
    .returning({ id: compartments.id });
  if (res.length) {
    await audit(tx, {
      actor: deviceActor(device),
      action: 'compartment.needs_inspection',
      resourceType: 'compartment',
      resourceId: compartmentId,
      metadata: { reason },
    });
  }
}

/**
 * Ingests a device event. Deduplicated by (device, eventId). Out-of-order events (sequence
 * not greater than the last accepted one) are stored but do not change state.
 */
export async function ingestDeviceEvent(device: AuthDevice, e: DeviceEventInput) {
  return getDb().transaction(async (tx) => {
    const [dev] = await tx.select().from(devices).where(eq(devices.id, device.id)).for('update');
    if (!dev) throw notFound('Device');
    const [dup] = await tx
      .select({ id: deviceEvents.id })
      .from(deviceEvents)
      .where(and(eq(deviceEvents.deviceId, device.id), eq(deviceEvents.eventId, e.eventId)));
    if (dup) return { accepted: false, duplicate: true };

    let compartmentId: string | null = null;
    if (e.compartmentCode) {
      const [c] = await tx
        .select({ id: compartments.id })
        .from(compartments)
        .where(
          and(
            eq(compartments.lockerBankId, device.lockerBankId),
            eq(compartments.code, e.compartmentCode),
          ),
        );
      if (!c) throw new AppError(400, 'UNKNOWN_COMPARTMENT', 'Compartment not on this device');
      compartmentId = c.id;
    }
    const now = clock.now();
    const occurredAt = new Date(e.occurredAt);
    const outOfOrder = e.sequence <= dev.lastSequence;
    const skewed = Math.abs(now.getTime() - occurredAt.getTime()) > MAX_CLOCK_SKEW_MS;
    const verificationStatus = outOfOrder ? 'OUT_OF_ORDER' : skewed ? 'CLOCK_SKEW' : 'ACCEPTED';
    await tx.insert(deviceEvents).values({
      deviceId: device.id,
      eventId: e.eventId,
      compartmentId,
      commandId: e.commandId ?? null,
      eventType: e.type,
      sequence: e.sequence,
      payload: { ...e },
      occurredAt,
      verificationStatus,
    });
    await tx
      .update(devices)
      .set({ lastSeenAt: now, lastSequence: sql`GREATEST(${devices.lastSequence}, ${e.sequence})` })
      .where(eq(devices.id, device.id));
    if (outOfOrder) return { accepted: true, applied: false, verificationStatus };

    const actor = deviceActor(device);
    switch (e.type) {
      case 'DOOR_OPENED':
      case 'DOOR_CLOSED': {
        if (!compartmentId)
          throw new AppError(400, 'COMPARTMENT_REQUIRED', 'Door events need a compartment');
        await tx
          .update(compartments)
          .set({ doorState: e.type === 'DOOR_OPENED' ? 'OPEN' : 'CLOSED', doorStateAt: occurredAt })
          .where(eq(compartments.id, compartmentId));
        await applyDoorEvent(tx, device, compartmentId, e.type, now);
        break;
      }
      case 'TAMPER_DETECTED':
      case 'SENSOR_FAULT': {
        if (compartmentId) await markNeedsInspection(tx, device, compartmentId, e.type);
        else {
          await tx.update(devices).set({ status: 'FAULT' }).where(eq(devices.id, device.id));
        }
        await audit(tx, {
          actor,
          action: `device.${e.type.toLowerCase()}`,
          resourceType: 'device',
          resourceId: device.id,
          metadata: { compartmentCode: e.compartmentCode ?? null },
        });
        break;
      }
      case 'POWER_LOST':
      case 'POWER_RESTORED':
        await audit(tx, {
          actor,
          action: `device.${e.type.toLowerCase()}`,
          resourceType: 'device',
          resourceId: device.id,
        });
        break;
    }
    return { accepted: true, applied: true, verificationStatus };
  });
}

async function applyDoorEvent(
  tx: Tx,
  device: AuthDevice,
  compartmentId: string,
  type: 'DOOR_OPENED' | 'DOOR_CLOSED',
  now: Date,
) {
  const actor = deviceActor(device);
  // The only thing that can explain a door movement is this compartment's in-flight UNLOCK that
  // the device has received (its ack may arrive after the door event; transports can reorder).
  const [cmd] = await tx
    .select()
    .from(deviceCommands)
    .where(
      and(
        eq(deviceCommands.compartmentId, compartmentId),
        inArray(deviceCommands.status, ['DELIVERED', 'ACKNOWLEDGED']),
      ),
    )
    .for('update');

  if (type === 'DOOR_OPENED') {
    if (!cmd) {
      // Door opened without an authorised command: treat as a possible forced entry.
      await markNeedsInspection(tx, device, compartmentId, 'UNAUTHORISED_DOOR_OPEN');
      await audit(tx, {
        actor,
        action: 'compartment.unauthorised_open',
        resourceType: 'compartment',
        resourceId: compartmentId,
      });
      return;
    }
    if (!cmd.doorOpenedAt) {
      await tx
        .update(deviceCommands)
        .set({ doorOpenedAt: now })
        .where(eq(deviceCommands.id, cmd.id));
      if (cmd.bookingId) {
        await recordBookingEvent(tx, cmd.bookingId, 'DOOR_OPENED', actor, { commandId: cmd.id });
      }
    }
    return;
  }

  // DOOR_CLOSED
  if (!cmd || !cmd.doorOpenedAt) return; // closing an already-closed door: state updated, nothing else.
  await tx
    .update(deviceCommands)
    .set({ status: 'COMPLETED', completedAt: now })
    .where(eq(deviceCommands.id, cmd.id));
  if (!cmd.bookingId) return;
  await recordBookingEvent(tx, cmd.bookingId, 'DOOR_CLOSED', actor, { commandId: cmd.id });
  const [b] = await tx
    .select()
    .from(storageBookings)
    .where(eq(storageBookings.id, cmd.bookingId))
    .for('update');
  if (!b) return;
  if (cmd.purpose === 'DEPOSIT' && (b.status === 'CONFIRMED' || b.status === 'ACCESS_READY')) {
    await transitionBooking(tx, {
      bookingId: b.id,
      from: b.status,
      to: 'ACTIVE',
      eventType: 'ITEMS_DEPOSITED',
      actor,
      metadata: { commandId: cmd.id },
      set: { depositedAt: now },
    });
  } else if (cmd.purpose === 'RETRIEVE' && b.status === 'ACTIVE') {
    await transitionBooking(tx, {
      bookingId: b.id,
      from: 'ACTIVE',
      to: 'COMPLETED',
      eventType: 'ITEMS_RETRIEVED',
      actor,
      metadata: { commandId: cmd.id },
      set: { retrievedAt: now },
    });
    await revokeCredentials(tx, b.id, 'BOOKING_COMPLETED');
  }
}

/** Kiosk path: customer types a PIN on the locker keypad; the device asks us to verify it. */
export async function verifyPinAtDevice(device: AuthDevice, compartmentCode: string, pin: string) {
  return getDb().transaction(async (tx) => {
    const now = clock.now();
    const [c] = await tx
      .select({ id: compartments.id })
      .from(compartments)
      .where(
        and(
          eq(compartments.lockerBankId, device.lockerBankId),
          eq(compartments.code, compartmentCode),
        ),
      );
    const denied = () => new AppError(403, 'ACCESS_DENIED', 'Invalid or expired PIN');
    if (!c) throw denied();
    const [cred] = await tx
      .select()
      .from(accessCredentials)
      .where(
        and(
          eq(accessCredentials.compartmentId, c.id),
          isNull(accessCredentials.revokedAt),
          lte(accessCredentials.validFrom, now),
          gt(accessCredentials.expiresAt, now),
        ),
      )
      .for('update');
    if (!cred) throw denied();
    if (!safeEqualHex(cred.credentialHash, hashPin(cred.bookingId, pin))) {
      const attempts = cred.failedAttempts + 1;
      const lock = attempts >= config().PIN_MAX_FAILED_ATTEMPTS;
      await tx
        .update(accessCredentials)
        .set({
          failedAttempts: attempts,
          ...(lock ? { revokedAt: now, revokedReason: 'TOO_MANY_ATTEMPTS' } : {}),
        })
        .where(eq(accessCredentials.id, cred.id));
      await audit(tx, {
        actor: deviceActor(device),
        action: lock ? 'credential.locked' : 'credential.failed_attempt',
        resourceType: 'storage_booking',
        resourceId: cred.bookingId,
        metadata: { attempts },
      });
      // Commit the attempt counter, then deny.
      return { ok: false as const, error: denied() };
    }
    const [b] = await tx
      .select()
      .from(storageBookings)
      .where(eq(storageBookings.id, cred.bookingId))
      .for('update');
    if (!b) throw denied();
    const purpose = b.status === 'ACTIVE' ? 'RETRIEVE' : 'DEPOSIT';
    const cmd = await issueUnlockCommand(tx, {
      booking: b,
      purpose,
      actor: deviceActor(device),
      via: 'PIN',
    });
    return { ok: true as const, commandId: cmd.id, purpose };
  });
}
