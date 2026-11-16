import { sql, type SQL } from 'drizzle-orm';
import {
  BLOCKING_BOOKING_STATUSES,
  COMPARTMENT_SIZES,
  type CompartmentDisplayStatus,
  type CompartmentSize,
  type SizeAvailability,
} from '@sl/shared';
import type { DbOrTx } from '../../db/client.js';

const blockingList = sql.raw(BLOCKING_BOOKING_STATUSES.map((s) => `'${s}'`).join(','));

/**
 * SQL predicate: compartment `c` is free for [startsAt, endsAt).
 * Also excludes compartments still physically holding items (ACTIVE booking),
 * even if that booking's paid window has ended (overstay).
 */
export function compartmentFreeSql(startsAt: Date, endsAt: Date): SQL {
  return sql`
    c.operational_status = 'IN_SERVICE'
    AND NOT EXISTS (
      SELECT 1 FROM storage_bookings b
      WHERE b.compartment_id = c.id
        AND b.status IN (${blockingList})
        AND tstzrange(b.starts_at, b.expires_at, '[)') && tstzrange(${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz, '[)')
    )
    AND NOT EXISTS (
      SELECT 1 FROM storage_bookings b2
      WHERE b2.compartment_id = c.id AND b2.status IN ('ACTIVE', 'DISPUTED')
    )`;
}

export async function sizeAvailability(
  db: DbOrTx,
  outletId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<SizeAvailability[]> {
  const res = await db.execute<{ size: CompartmentSize; total: number; available: number }>(sql`
    SELECT c.size,
           count(*)::int AS total,
           count(*) FILTER (WHERE ${compartmentFreeSql(startsAt, endsAt)})::int AS available
    FROM compartments c
    JOIN locker_banks lb ON lb.id = c.locker_bank_id
    WHERE lb.outlet_id = ${outletId}
    GROUP BY c.size`);
  const bySize = new Map(res.rows.map((r) => [r.size, r]));
  return COMPARTMENT_SIZES.filter((s) => bySize.has(s)).map((size) => ({
    size,
    total: bySize.get(size)!.total,
    available: bySize.get(size)!.available,
  }));
}

/** SQL expression computing the display status of compartment alias `c` at `now`. */
export function displayStatusSql(now: Date): SQL<CompartmentDisplayStatus> {
  return sql<CompartmentDisplayStatus>`
    CASE
      WHEN c.operational_status <> 'IN_SERVICE' THEN c.operational_status::text
      WHEN EXISTS (SELECT 1 FROM storage_bookings b WHERE b.compartment_id = c.id AND b.status IN ('ACTIVE','DISPUTED')) THEN 'OCCUPIED'
      WHEN EXISTS (
        SELECT 1 FROM storage_bookings b WHERE b.compartment_id = c.id
          AND b.status IN (${blockingList})
          AND ${now.toISOString()}::timestamptz <@ tstzrange(b.starts_at, b.expires_at, '[)')
      ) THEN 'RESERVED'
      ELSE 'AVAILABLE'
    END`;
}
