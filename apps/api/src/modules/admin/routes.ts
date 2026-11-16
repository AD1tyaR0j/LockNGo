import { Router } from 'express';
import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  BOOKING_STATUSES,
  compartmentStatusChangeSchema,
  createLockerBankSchema,
  createOutletSchema,
  paginationSchema,
  registerDeviceSchema,
  updateOutletSchema,
  type AdminCompartment,
  type AdminDevice,
  type AdminLockerBank,
  type AdminOutlet,
} from '@sl/shared';
import { getDb, pgErrorCode } from '../../db/client.js';
import {
  auditLogs,
  compartments,
  devices,
  lockerBanks,
  outlets,
  storageBookings,
} from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { clock } from '../../lib/clock.js';
import { newOpaqueToken, sha256 } from '../../lib/crypto.js';
import { conflict, notFound } from '../../lib/errors.js';
import { requirePermission, requireUser } from '../../middleware/context.js';
import { displayStatusSql } from '../inventory/queries.js';
import { nextCompartmentStatus } from '../storage/state-machine.js';
import { getBookingDetail } from '../storage/service.js';

const uuidParam = (raw: unknown, what: string) => {
  const r = z.string().uuid().safeParse(raw);
  if (!r.success) throw notFound(what);
  return r.data;
};

function deviceDto(d: typeof devices.$inferSelect): AdminDevice {
  return {
    id: d.id,
    deviceIdentifier: d.deviceIdentifier,
    hardwareModel: d.hardwareModel,
    firmwareVersion: d.firmwareVersion,
    status: d.status,
    isSimulated: d.isSimulated,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
  };
}

async function outletDto(o: typeof outlets.$inferSelect): Promise<AdminOutlet> {
  const [sim] = await getDb()
    .select({ n: count() })
    .from(devices)
    .innerJoin(lockerBanks, eq(lockerBanks.id, devices.lockerBankId))
    .where(and(eq(lockerBanks.outletId, o.id), eq(devices.isSimulated, true)));
  return {
    id: o.id,
    name: o.name,
    address: o.address,
    city: o.city,
    state: o.state,
    postalCode: o.postalCode,
    latitude: o.latitude,
    longitude: o.longitude,
    operatingHours: o.operatingHours,
    hasSimulatedDevices: (sim?.n ?? 0) > 0,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
  };
}

export const adminRouter = Router();

// ------------------------------------------------------------ overview
adminRouter.get('/overview', requirePermission('admin:dashboard:read'), async (_req, res) => {
  const db = getDb();
  const now = clock.now();
  const outletStats = await db.execute<{ status: string; n: number }>(
    sql`SELECT status, count(*)::int AS n FROM outlets GROUP BY status`,
  );
  const deviceStats = await db.execute<{ status: string; simulated: boolean; n: number }>(
    sql`SELECT status, is_simulated AS simulated, count(*)::int AS n FROM devices GROUP BY status, is_simulated`,
  );
  const compartmentStats = await db.execute<{ status: string; n: number }>(
    sql`SELECT ${displayStatusSql(now)} AS status, count(*)::int AS n FROM compartments c GROUP BY 1`,
  );
  const bookingStats = await db.execute<{ status: string; n: number }>(
    sql`SELECT status, count(*)::int AS n FROM storage_bookings GROUP BY status`,
  );
  const alerts = await db
    .select()
    .from(auditLogs)
    .where(
      inArray(auditLogs.action, [
        'compartment.unauthorised_open',
        'compartment.door_left_open',
        'compartment.needs_inspection',
        'device.tamper_detected',
        'device.sensor_fault',
        'payment.late_capture_refund_required',
        'payment.amount_mismatch',
      ]),
    )
    .orderBy(desc(auditLogs.id))
    .limit(10);
  const toMap = (rows: { status: string; n: number }[]) =>
    Object.fromEntries(rows.map((r) => [r.status, r.n]));
  res.json({
    generatedAt: now.toISOString(),
    outlets: toMap(outletStats.rows),
    devices: {
      byStatus: deviceStats.rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + r.n;
        return acc;
      }, {}),
      simulated: deviceStats.rows.filter((r) => r.simulated).reduce((a, r) => a + r.n, 0),
      physical: deviceStats.rows.filter((r) => !r.simulated).reduce((a, r) => a + r.n, 0),
    },
    compartments: toMap(compartmentStats.rows),
    bookings: toMap(bookingStats.rows),
    recentAlerts: alerts.map((a) => ({
      id: String(a.id),
      action: a.action,
      resourceType: a.resourceType,
      resourceId: a.resourceId,
      createdAt: a.createdAt.toISOString(),
    })),
  });
});

// ------------------------------------------------------------ outlets
adminRouter.get('/outlets', requirePermission('admin:outlets:read'), async (_req, res) => {
  const rows = await getDb().select().from(outlets).orderBy(outlets.city, outlets.name);
  res.json({ items: await Promise.all(rows.map(outletDto)) });
});

adminRouter.post('/outlets', requirePermission('admin:outlets:write'), async (req, res) => {
  const user = requireUser(req);
  const input = createOutletSchema.parse(req.body);
  const o = await getDb().transaction(async (tx) => {
    const [o] = await tx.insert(outlets).values(input).returning();
    await audit(tx, {
      actor: { type: 'USER', id: user.id },
      action: 'outlet.created',
      resourceType: 'outlet',
      resourceId: o!.id,
      requestId: req.requestId,
      metadata: { name: input.name, status: input.status },
    });
    return o!;
  });
  res.status(201).json(await outletDto(o));
});

adminRouter.get('/outlets/:outletId', requirePermission('admin:outlets:read'), async (req, res) => {
  const id = uuidParam(req.params.outletId, 'Outlet');
  const db = getDb();
  const [o] = await db.select().from(outlets).where(eq(outlets.id, id));
  if (!o) throw notFound('Outlet');
  const now = clock.now();
  const banks = await db.select().from(lockerBanks).where(eq(lockerBanks.outletId, id)).orderBy(lockerBanks.label);
  const bankIds = banks.map((b) => b.id);
  const devs = bankIds.length
    ? await db.select().from(devices).where(inArray(devices.lockerBankId, bankIds))
    : [];
  const comps = bankIds.length
    ? await db.execute<{
        id: string;
        locker_bank_id: string;
        code: string;
        size: AdminCompartment['size'];
        max_weight_grams: number;
        operational_status: AdminCompartment['operationalStatus'];
        door_state: AdminCompartment['doorState'];
        display_status: AdminCompartment['displayStatus'];
      }>(sql`
        SELECT c.id, c.locker_bank_id, c.code, c.size, c.max_weight_grams, c.operational_status,
               c.door_state, ${displayStatusSql(now)} AS display_status
        FROM compartments c
        WHERE c.locker_bank_id IN (${sql.join(bankIds.map((b) => sql`${b}::uuid`), sql`, `)})
        ORDER BY c.code`)
    : { rows: [] };
  const lockerBanksDto: AdminLockerBank[] = banks.map((b) => {
    const d = devs.find((x) => x.lockerBankId === b.id);
    return {
      id: b.id,
      label: b.label,
      model: b.model,
      device: d ? deviceDto(d) : null,
      compartments: comps.rows
        .filter((c) => c.locker_bank_id === b.id)
        .map((c) => ({
          id: c.id,
          code: c.code,
          size: c.size,
          maxWeightGrams: c.max_weight_grams,
          operationalStatus: c.operational_status,
          displayStatus: c.display_status,
          doorState: c.door_state,
        })),
    };
  });
  res.json({ outlet: await outletDto(o), lockerBanks: lockerBanksDto });
});

adminRouter.patch('/outlets/:outletId', requirePermission('admin:outlets:write'), async (req, res) => {
  const user = requireUser(req);
  const id = uuidParam(req.params.outletId, 'Outlet');
  const input = updateOutletSchema.parse(req.body);
  const o = await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(outlets).where(eq(outlets.id, id)).for('update');
    if (!before) throw notFound('Outlet');
    const [o] = await tx.update(outlets).set(input).where(eq(outlets.id, id)).returning();
    await audit(tx, {
      actor: { type: 'USER', id: user.id },
      action: 'outlet.updated',
      resourceType: 'outlet',
      resourceId: id,
      requestId: req.requestId,
      metadata: { changedFields: Object.keys(input), statusFrom: before.status, statusTo: o!.status },
    });
    return o!;
  });
  res.json(await outletDto(o));
});

// ------------------------------------------------------------ inventory
adminRouter.post(
  '/outlets/:outletId/locker-banks',
  requirePermission('admin:inventory:write'),
  async (req, res) => {
    const user = requireUser(req);
    const outletId = uuidParam(req.params.outletId, 'Outlet');
    const input = createLockerBankSchema.parse(req.body);
    const codes = new Set(input.compartments.map((c) => c.code));
    if (codes.size !== input.compartments.length) {
      throw conflict('DUPLICATE_CODE', 'Compartment codes must be unique within a locker bank');
    }
    try {
      const bank = await getDb().transaction(async (tx) => {
        const [o] = await tx.select({ id: outlets.id }).from(outlets).where(eq(outlets.id, outletId));
        if (!o) throw notFound('Outlet');
        const [bank] = await tx
          .insert(lockerBanks)
          .values({ outletId, label: input.label, model: input.model })
          .returning();
        if (input.compartments.length) {
          await tx.insert(compartments).values(
            input.compartments.map((c) => ({
              lockerBankId: bank!.id,
              code: c.code,
              size: c.size,
              maxWeightGrams: c.maxWeightGrams,
            })),
          );
        }
        await audit(tx, {
          actor: { type: 'USER', id: user.id },
          action: 'locker_bank.created',
          resourceType: 'locker_bank',
          resourceId: bank!.id,
          requestId: req.requestId,
          metadata: { outletId, compartments: input.compartments.length },
        });
        return bank!;
      });
      res.status(201).json({ id: bank.id, label: bank.label });
    } catch (err) {
      if (pgErrorCode(err) === '23505') throw conflict('DUPLICATE_LABEL', 'Locker bank label already used');
      throw err;
    }
  },
);

adminRouter.post(
  '/compartments/:compartmentId/status',
  requirePermission('admin:compartments:status'),
  async (req, res) => {
    const user = requireUser(req);
    const id = uuidParam(req.params.compartmentId, 'Compartment');
    const input = compartmentStatusChangeSchema.parse(req.body);
    const result = await getDb().transaction(async (tx) => {
      const [c] = await tx.select().from(compartments).where(eq(compartments.id, id)).for('update');
      if (!c) throw notFound('Compartment');
      const to = nextCompartmentStatus(c.operationalStatus, input.action);
      if (to === 'IN_SERVICE' && c.doorState === 'OPEN') {
        throw conflict('DOOR_OPEN', 'Close and verify the door before returning to service');
      }
      await tx.update(compartments).set({ operationalStatus: to }).where(eq(compartments.id, id));
      // Bookings affected by taking the compartment out of service need support follow-up.
      // Automatic reallocation/refund policy is an open product decision.
      const affected = await tx
        .select({ id: storageBookings.id, reference: storageBookings.reference, status: storageBookings.status })
        .from(storageBookings)
        .where(
          and(
            eq(storageBookings.compartmentId, id),
            inArray(storageBookings.status, ['PENDING_PAYMENT', 'CONFIRMED', 'ACCESS_READY', 'ACTIVE', 'DISPUTED']),
          ),
        );
      await audit(tx, {
        actor: { type: 'USER', id: user.id },
        action: 'compartment.status_changed',
        resourceType: 'compartment',
        resourceId: id,
        requestId: req.requestId,
        metadata: { from: c.operationalStatus, to, reason: input.reason, affectedBookings: affected.length },
      });
      return { operationalStatus: to, affectedBookings: affected };
    });
    res.json(result);
  },
);

// ------------------------------------------------------------ devices
adminRouter.get('/devices', requirePermission('admin:devices:read'), async (_req, res) => {
  const rows = await getDb()
    .select({ d: devices, bankLabel: lockerBanks.label, outletName: outlets.name, outletId: outlets.id })
    .from(devices)
    .innerJoin(lockerBanks, eq(lockerBanks.id, devices.lockerBankId))
    .innerJoin(outlets, eq(outlets.id, lockerBanks.outletId))
    .orderBy(outlets.name, lockerBanks.label);
  res.json({
    items: rows.map((r) => ({
      ...deviceDto(r.d),
      lockerBankLabel: r.bankLabel,
      outlet: { id: r.outletId, name: r.outletName },
    })),
  });
});

adminRouter.post('/devices', requirePermission('admin:devices:register'), async (req, res) => {
  const user = requireUser(req);
  const input = registerDeviceSchema.parse(req.body);
  const token = newOpaqueToken(32);
  try {
    const d = await getDb().transaction(async (tx) => {
      const [bank] = await tx.select().from(lockerBanks).where(eq(lockerBanks.id, input.lockerBankId));
      if (!bank) throw notFound('Locker bank');
      const [d] = await tx
        .insert(devices)
        .values({ ...input, credentialHash: sha256(token) })
        .returning();
      await audit(tx, {
        actor: { type: 'USER', id: user.id },
        action: 'device.registered',
        resourceType: 'device',
        resourceId: d!.id,
        requestId: req.requestId,
        metadata: { deviceIdentifier: input.deviceIdentifier, isSimulated: input.isSimulated },
      });
      return d!;
    });
    // The token is shown exactly once; only its hash is stored.
    res.status(201).json({ device: deviceDto(d), deviceToken: token });
  } catch (err) {
    if (pgErrorCode(err) === '23505') {
      throw conflict('DEVICE_EXISTS', 'Device identifier or locker bank already registered');
    }
    throw err;
  }
});

// ------------------------------------------------------------ bookings
adminRouter.get('/bookings', requirePermission('admin:bookings:read'), async (req, res) => {
  const p = paginationSchema
    .extend({
      q: z.string().trim().max(60).optional(),
      status: z.enum(BOOKING_STATUSES).optional(),
    })
    .parse(req.query);
  const db = getDb();
  const where = and(
    p.status ? eq(storageBookings.status, p.status) : undefined,
    p.q ? or(ilike(storageBookings.reference, `%${p.q.replace(/[%_]/g, '')}%`)) : undefined,
  );
  const rows = await db
    .select({
      id: storageBookings.id,
      reference: storageBookings.reference,
      status: storageBookings.status,
      startsAt: storageBookings.startsAt,
      expiresAt: storageBookings.expiresAt,
      amountMinor: storageBookings.amountMinor,
      outletName: outlets.name,
      compartmentCode: compartments.code,
      createdAt: storageBookings.createdAt,
    })
    .from(storageBookings)
    .innerJoin(outlets, eq(outlets.id, storageBookings.outletId))
    .innerJoin(compartments, eq(compartments.id, storageBookings.compartmentId))
    .where(where)
    .orderBy(desc(storageBookings.createdAt))
    .limit(p.limit)
    .offset(p.offset);
  const [total] = await db.select({ n: count() }).from(storageBookings).where(where);
  res.json({
    items: rows.map((r) => ({
      ...r,
      startsAt: r.startsAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })),
    total: total?.n ?? 0,
    limit: p.limit,
    offset: p.offset,
  });
});

adminRouter.get('/bookings/:bookingId', requirePermission('admin:bookings:read'), async (req, res) => {
  const user = requireUser(req);
  const id = uuidParam(req.params.bookingId, 'Booking');
  const detail = await getBookingDetail(getDb(), id);
  // Support access to individual customer records is audited.
  await audit(getDb(), {
    actor: { type: 'USER', id: user.id },
    action: 'booking.viewed_by_staff',
    resourceType: 'storage_booking',
    resourceId: id,
    requestId: req.requestId,
  });
  res.json(detail);
});

// ------------------------------------------------------------ audit
adminRouter.get('/audit', requirePermission('admin:audit:read'), async (req, res) => {
  const p = paginationSchema
    .extend({
      resourceType: z.string().max(60).optional(),
      resourceId: z.string().max(80).optional(),
      action: z.string().max(80).optional(),
    })
    .parse(req.query);
  const db = getDb();
  const where = and(
    p.resourceType ? eq(auditLogs.resourceType, p.resourceType) : undefined,
    p.resourceId ? eq(auditLogs.resourceId, p.resourceId) : undefined,
    p.action ? eq(auditLogs.action, p.action) : undefined,
  );
  const rows = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.id))
    .limit(p.limit)
    .offset(p.offset);
  const [total] = await db.select({ n: count() }).from(auditLogs).where(where);
  res.json({
    items: rows.map((a) => ({ ...a, id: String(a.id), createdAt: a.createdAt.toISOString() })),
    total: total?.n ?? 0,
    limit: p.limit,
    offset: p.offset,
  });
});
