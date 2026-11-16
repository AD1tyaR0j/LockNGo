import { and, eq } from 'drizzle-orm';
import type { BookingStatus } from '@sl/shared';
import type { Tx } from '../../db/client.js';
import { bookingEvents, storageBookings } from '../../db/schema.js';
import type { Actor } from '../../lib/audit.js';
import { clock } from '../../lib/clock.js';
import { conflict } from '../../lib/errors.js';
import { assertBookingTransition } from './state-machine.js';

export async function recordBookingEvent(
  tx: Tx,
  bookingId: string,
  eventType: string,
  actor: Actor,
  metadata: Record<string, unknown> = {},
  statuses?: { from: BookingStatus; to: BookingStatus },
) {
  await tx.insert(bookingEvents).values({
    bookingId,
    eventType,
    actorType: actor.type,
    actorId: actor.id ?? null,
    metadata,
    fromStatus: statuses?.from ?? null,
    toStatus: statuses?.to ?? null,
  });
}

/**
 * Validates and applies a booking state transition with a compare-and-set on the current
 * status, so two concurrent transitions cannot both succeed.
 */
export async function transitionBooking(
  tx: Tx,
  args: {
    bookingId: string;
    from: BookingStatus;
    to: BookingStatus;
    eventType: string;
    actor: Actor;
    metadata?: Record<string, unknown>;
    set?: Partial<typeof storageBookings.$inferInsert>;
  },
): Promise<void> {
  assertBookingTransition(args.from, args.to);
  const updated = await tx
    .update(storageBookings)
    .set({ ...args.set, status: args.to, updatedAt: clock.now() })
    .where(and(eq(storageBookings.id, args.bookingId), eq(storageBookings.status, args.from)))
    .returning({ id: storageBookings.id });
  if (updated.length !== 1) {
    throw conflict('STALE_STATE', 'Booking state changed concurrently; please retry');
  }
  await recordBookingEvent(tx, args.bookingId, args.eventType, args.actor, args.metadata ?? {}, {
    from: args.from,
    to: args.to,
  });
}
