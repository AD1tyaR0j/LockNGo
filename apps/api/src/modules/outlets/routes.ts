import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BOOKING_LIMITS, type OutletSummary } from '@sl/shared';
import { getDb } from '../../db/client.js';
import { outlets } from '../../db/schema.js';
import { addHours, clock } from '../../lib/clock.js';
import { notFound } from '../../lib/errors.js';
import { sizeAvailability } from '../inventory/queries.js';

/** Public outlet data: no device identifiers, credentials or internal configuration. */
// Explicitly qualified: Drizzle renders `${outlets.id}` unqualified in single-table selects,
// which is ambiguous inside this subquery.
const simulatedFlag = sql<boolean>`EXISTS (
  SELECT 1 FROM locker_banks lb JOIN devices d ON d.locker_bank_id = lb.id
  WHERE lb.outlet_id = "outlets"."id" AND d.is_simulated)`;

function toSummary(o: typeof outlets.$inferSelect, hasSimulatedDevices: boolean): OutletSummary {
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
    hasSimulatedDevices,
  };
}

export const outletsRouter = Router();

outletsRouter.get('/', async (req, res) => {
  const q = z.object({ city: z.string().trim().max(100).optional() }).parse(req.query);
  const rows = await getDb()
    .select({ o: outlets, sim: simulatedFlag })
    .from(outlets)
    .where(
      and(
        eq(outlets.status, 'ACTIVE'),
        q.city ? sql`lower(${outlets.city}) = lower(${q.city})` : undefined,
      ),
    )
    .orderBy(outlets.city, outlets.name)
    .limit(100);
  res.json({ items: rows.map((r) => toSummary(r.o, r.sim)) });
});

outletsRouter.get('/:outletId', async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.outletId);
  if (!id.success) throw notFound('Outlet');
  const [row] = await getDb()
    .select({ o: outlets, sim: simulatedFlag })
    .from(outlets)
    .where(and(eq(outlets.id, id.data), eq(outlets.status, 'ACTIVE')));
  if (!row) throw notFound('Outlet');
  res.json(toSummary(row.o, row.sim));
});

outletsRouter.get('/:outletId/availability', async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.outletId);
  if (!id.success) throw notFound('Outlet');
  const q = z
    .object({
      startsAt: z.string().datetime({ offset: true }).optional(),
      durationHours: z.coerce
        .number()
        .int()
        .min(BOOKING_LIMITS.minHours)
        .max(BOOKING_LIMITS.maxHours)
        .default(1),
    })
    .parse(req.query);
  const db = getDb();
  const [o] = await db
    .select({ id: outlets.id })
    .from(outlets)
    .where(and(eq(outlets.id, id.data), eq(outlets.status, 'ACTIVE')));
  if (!o) throw notFound('Outlet');
  const startsAt = q.startsAt ? new Date(q.startsAt) : clock.now();
  const endsAt = addHours(startsAt, q.durationHours);
  res.json({
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    sizes: await sizeAvailability(db, o.id, startsAt, endsAt),
  });
});
