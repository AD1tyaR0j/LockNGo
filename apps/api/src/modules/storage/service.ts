import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import {
  BOOKING_LIMITS,
  type AccessPurpose,
  type BookingDetail,
  type BookingStatus,
  type CredentialIssued,
  type PaymentSummary,
  type StorageQuote,
  type StorageQuoteRequest,
} from '@sl/shared';
import { getDb, pgConstraint, pgErrorCode, type DbOrTx, type Tx } from '../../db/client.js';
import {
  accessCredentials,
  bookingEvents,
  compartments,
  deviceCommands,
  devices,
  lockerBanks,
  outlets,
  payments,
  priceQuotes,
  pricingRules,
  storageBookings,
} from '../../db/schema.js';
import { audit, type Actor } from '../../lib/audit.js';
import { addHours, addMinutes, addSeconds, clock } from '../../lib/clock.js';
import { hmacSha256, newPin, newReference } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { config } from '../../config.js';
import { compartmentFreeSql, sizeAvailability } from '../inventory/queries.js';
import { isOpenAt } from '../outlets/hours.js';
import { priceStorage } from '../pricing/pricing.js';
import { paymentProvider } from '../payments/index.js';
import { recordBookingEvent, transitionBooking } from './transitions.js';

type BookingRow = typeof storageBookings.$inferSelect;

// ---------------------------------------------------------------- quotes

export async function createStorageQuote(
  customerId: string,
  input: StorageQuoteRequest,
): Promise<StorageQuote> {
  const db = getDb();
  const now = clock.now();
  const [outlet] = await db.select().from(outlets).where(eq(outlets.id, input.outletId));
  if (!outlet || outlet.status !== 'ACTIVE') throw notFound('Outlet');

  const startsAt = input.startsAt ? new Date(input.startsAt) : now;
  if (startsAt.getTime() < now.getTime() - 60_000) {
    throw badRequest('START_IN_PAST', 'Start time cannot be in the past');
  }
  if (startsAt.getTime() > addHours(now, BOOKING_LIMITS.maxAdvanceDays * 24).getTime()) {
    throw badRequest(
      'START_TOO_FAR',
      `Bookings can start at most ${BOOKING_LIMITS.maxAdvanceDays} days ahead`,
    );
  }
  if (!isOpenAt(outlet.operatingHours, outlet.timezone, startsAt)) {
    throw badRequest('OUTLET_CLOSED', 'The outlet is closed at the requested start time');
  }
  const endsAt = addHours(startsAt, input.durationHours);

  const [rule] = await db
    .select()
    .from(pricingRules)
    .where(and(eq(pricingRules.size, input.size), eq(pricingRules.isActive, true)));
  if (!rule) throw conflict('NO_PRICING', 'This locker size is not currently offered');

  const avail = await sizeAvailability(db, outlet.id, startsAt, endsAt);
  if ((avail.find((a) => a.size === input.size)?.available ?? 0) < 1) {
    throw conflict('NO_AVAILABILITY', 'No compartments of that size are available for that time');
  }

  const price = priceStorage(rule, input.durationHours);
  const quoteExpiresAt = addMinutes(now, config().QUOTE_TTL_MINUTES);
  const [q] = await db
    .insert(priceQuotes)
    .values({
      customerId,
      serviceType: 'STORAGE',
      outletId: outlet.id,
      size: input.size,
      startsAt,
      endsAt,
      amountMinor: price.totalMinor,
      breakdown: price.breakdown,
      pricingRuleId: rule.id,
      expiresAt: quoteExpiresAt,
    })
    .returning();
  return {
    id: q!.id,
    outletId: outlet.id,
    size: input.size,
    startsAt: startsAt.toISOString(),
    expiresAt: endsAt.toISOString(),
    durationHours: input.durationHours,
    total: { amountMinor: price.totalMinor, currency: 'INR' },
    breakdown: price.breakdown,
    pricingRuleVersion: rule.version,
    quoteExpiresAt: quoteExpiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------- bookings

/**
 * Allocates a compartment and creates a PENDING_PAYMENT booking.
 *
 * Concurrency: candidate compartment rows are locked with FOR UPDATE SKIP LOCKED, then the
 * overlap check is repeated in a fresh statement (READ COMMITTED gives it a new snapshot).
 * The storage_bookings_no_overlap EXCLUDE constraint is the final guarantee.
 */
export async function createBooking(args: {
  customerId: string;
  quoteId: string;
  idempotencyKey: string;
  requestId: string;
}) {
  const db = getDb();
  const existing = await findByIdempotencyKey(db, args.customerId, args.idempotencyKey);
  if (existing) return ensurePaymentOrder(existing, args.requestId);

  let booking: BookingRow;
  try {
    booking = await db.transaction(async (tx) => {
      const now = clock.now();
      const [quote] = await tx
        .select()
        .from(priceQuotes)
        .where(eq(priceQuotes.id, args.quoteId))
        .for('update');
      if (!quote || quote.customerId !== args.customerId) throw notFound('Quote');
      if (quote.expiresAt <= now) throw conflict('QUOTE_EXPIRED', 'Quote has expired');
      const [used] = await tx
        .select({ id: storageBookings.id })
        .from(storageBookings)
        .where(eq(storageBookings.priceQuoteId, quote.id));
      if (used) throw conflict('QUOTE_USED', 'Quote has already been used');
      const startsAt = quote.startsAt < now ? now : quote.startsAt;
      const endsAt = quote.endsAt;

      const compartmentId = await lockFreeCompartment(
        tx,
        quote.outletId,
        quote.size,
        startsAt,
        endsAt,
      );
      if (!compartmentId) {
        throw conflict('NO_AVAILABILITY', 'No compartments of that size are available any more');
      }
      const [b] = await tx
        .insert(storageBookings)
        .values({
          reference: newReference('SLB'),
          customerId: args.customerId,
          outletId: quote.outletId,
          compartmentId,
          startsAt,
          expiresAt: endsAt,
          status: 'PENDING_PAYMENT',
          paymentHoldExpiresAt: addMinutes(now, config().PAYMENT_HOLD_MINUTES),
          priceQuoteId: quote.id,
          amountMinor: quote.amountMinor,
          currency: quote.currency,
          idempotencyKey: args.idempotencyKey,
        })
        .returning();
      const actor: Actor = { type: 'USER', id: args.customerId };
      await recordBookingEvent(tx, b!.id, 'BOOKING_CREATED', actor, { quoteId: quote.id });
      await audit(tx, {
        actor,
        action: 'booking.created',
        resourceType: 'storage_booking',
        resourceId: b!.id,
        requestId: args.requestId,
        metadata: { compartmentId, amountMinor: quote.amountMinor },
      });
      return b!;
    });
  } catch (err) {
    // A concurrent retry with the same Idempotency-Key won the race: return its result.
    if (pgErrorCode(err) === '23505' && pgConstraint(err) === 'storage_bookings_customer_idem_uq') {
      const winner = await findByIdempotencyKey(db, args.customerId, args.idempotencyKey);
      if (winner) return ensurePaymentOrder(winner, args.requestId);
    }
    if (
      pgErrorCode(err) === '23505' &&
      pgConstraint(err) === 'storage_bookings_price_quote_id_unique'
    ) {
      throw conflict('QUOTE_USED', 'Quote has already been used');
    }
    throw err;
  }
  return ensurePaymentOrder(booking, args.requestId);
}

async function lockFreeCompartment(
  tx: Tx,
  outletId: string,
  size: string,
  startsAt: Date,
  endsAt: Date,
): Promise<string | undefined> {
  const tried: string[] = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    const exclude = tried.length
      ? sql`AND c.id NOT IN (${sql.join(
          tried.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
    const candidate = await tx.execute<{ id: string }>(sql`
      SELECT c.id FROM compartments c
      JOIN locker_banks lb ON lb.id = c.locker_bank_id
      JOIN devices d ON d.locker_bank_id = lb.id AND d.status <> 'DECOMMISSIONED'
      WHERE lb.outlet_id = ${outletId} AND c.size = ${size}
        AND ${compartmentFreeSql(startsAt, endsAt)} ${exclude}
      ORDER BY c.code
      LIMIT 1
      FOR UPDATE OF c SKIP LOCKED`);
    const id = candidate.rows[0]?.id;
    if (!id) return undefined;
    // Re-check under the lock with a fresh snapshot.
    const recheck = await tx.execute<{ ok: boolean }>(sql`
      SELECT (${compartmentFreeSql(startsAt, endsAt)}) AS ok FROM compartments c WHERE c.id = ${id}`);
    if (recheck.rows[0]?.ok) return id;
    tried.push(id);
  }
  return undefined;
}

async function findByIdempotencyKey(db: DbOrTx, customerId: string, key: string) {
  const [b] = await db
    .select()
    .from(storageBookings)
    .where(
      and(eq(storageBookings.customerId, customerId), eq(storageBookings.idempotencyKey, key)),
    );
  return b;
}

/** Creates the provider order if missing (outside any DB transaction: never hold locks over network calls). */
async function ensurePaymentOrder(booking: BookingRow, requestId: string) {
  const db = getDb();
  let [payment] = await db.select().from(payments).where(eq(payments.bookingId, booking.id));
  if (!payment && booking.status === 'PENDING_PAYMENT') {
    const provider = paymentProvider();
    const order = await provider.createOrder({
      idempotencyKey: booking.id,
      amountMinor: booking.amountMinor,
      currency: 'INR',
    });
    [payment] = await db
      .insert(payments)
      .values({
        bookingId: booking.id,
        provider: provider.name,
        providerOrderId: order.providerOrderId,
        amountMinor: booking.amountMinor,
        currency: booking.currency,
        status: 'CREATED',
      })
      .returning();
    await audit(db, {
      actor: { type: 'USER', id: booking.customerId },
      action: 'payment.order_created',
      resourceType: 'payment',
      resourceId: payment!.id,
      requestId,
      metadata: { provider: provider.name, isMock: provider.isMock, bookingId: booking.id },
    });
  }
  const detail = await getBookingDetail(db, booking.id);
  return { booking: detail, payment: detail.payment };
}

export function paymentSummary(p: typeof payments.$inferSelect): PaymentSummary {
  return {
    id: p.id,
    provider: p.provider,
    isMock: p.provider === 'mock',
    status: p.status,
    providerOrderId: p.providerOrderId,
    amount: { amountMinor: p.amountMinor, currency: 'INR' },
  };
}

export function nextAccessPurpose(
  b: Pick<BookingRow, 'status' | 'startsAt' | 'expiresAt'>,
  now: Date,
): AccessPurpose | null {
  if (b.status === 'ACTIVE') return 'RETRIEVE';
  if (
    (b.status === 'CONFIRMED' || b.status === 'ACCESS_READY') &&
    now >= b.startsAt &&
    now < b.expiresAt
  ) {
    return 'DEPOSIT';
  }
  return null;
}

export async function getBookingDetail(db: DbOrTx, bookingId: string): Promise<BookingDetail> {
  const [detail] = await getBookingDetails(db, [bookingId]);
  if (!detail) throw notFound('Booking');
  return detail;
}

/**
 * Loads full booking details for many bookings with a fixed number of queries (4), regardless of
 * how many ids are passed. Result order follows `bookingIds`; unknown ids are omitted.
 */
export async function getBookingDetails(
  db: DbOrTx,
  bookingIds: string[],
): Promise<BookingDetail[]> {
  if (bookingIds.length === 0) return [];
  const rows = await db
    .select({
      b: storageBookings,
      outlet: { id: outlets.id, name: outlets.name, address: outlets.address },
      compartment: { code: compartments.code, size: compartments.size },
      bankLabel: lockerBanks.label,
      isSimulated: devices.isSimulated,
      breakdown: priceQuotes.breakdown,
    })
    .from(storageBookings)
    .innerJoin(outlets, eq(outlets.id, storageBookings.outletId))
    .innerJoin(compartments, eq(compartments.id, storageBookings.compartmentId))
    .innerJoin(lockerBanks, eq(lockerBanks.id, compartments.lockerBankId))
    .leftJoin(devices, eq(devices.lockerBankId, lockerBanks.id))
    .innerJoin(priceQuotes, eq(priceQuotes.id, storageBookings.priceQuoteId))
    .where(inArray(storageBookings.id, bookingIds));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.b.id);

  const paymentRows = await db
    .select()
    .from(payments)
    .where(inArray(payments.bookingId, ids))
    .orderBy(desc(payments.createdAt));
  const latestPayment = new Map<string, (typeof paymentRows)[number]>();
  for (const p of paymentRows)
    if (!latestPayment.has(p.bookingId)) latestPayment.set(p.bookingId, p);

  const cmdRows = await db
    .select()
    .from(deviceCommands)
    .where(
      and(
        inArray(deviceCommands.bookingId, ids),
        inArray(deviceCommands.status, ['PENDING', 'DELIVERED', 'ACKNOWLEDGED']),
      ),
    );
  const pendingCmd = new Map(cmdRows.map((c) => [c.bookingId!, c]));

  const eventRows = await db
    .select()
    .from(bookingEvents)
    .where(inArray(bookingEvents.bookingId, ids))
    .orderBy(bookingEvents.id);
  const eventsByBooking = new Map<string, (typeof eventRows)[number][]>();
  for (const e of eventRows) {
    const list = eventsByBooking.get(e.bookingId) ?? [];
    list.push(e);
    eventsByBooking.set(e.bookingId, list);
  }

  const now = clock.now();
  const byId = new Map(
    rows.map((row): [string, BookingDetail] => {
      const b = row.b;
      const payment = latestPayment.get(b.id);
      const cmd = pendingCmd.get(b.id);
      return [
        b.id,
        {
          id: b.id,
          reference: b.reference,
          status: b.status,
          outlet: row.outlet,
          compartment: {
            code: row.compartment.code,
            size: row.compartment.size,
            lockerBankLabel: row.bankLabel,
            isSimulated: row.isSimulated ?? false,
          },
          startsAt: b.startsAt.toISOString(),
          expiresAt: b.expiresAt.toISOString(),
          paymentHoldExpiresAt:
            b.status === 'PENDING_PAYMENT' ? (b.paymentHoldExpiresAt?.toISOString() ?? null) : null,
          total: { amountMinor: b.amountMinor, currency: 'INR' },
          breakdown: row.breakdown,
          payment: payment ? paymentSummary(payment) : null,
          nextAccessPurpose: nextAccessPurpose(b, now),
          pendingCommand: cmd
            ? {
                id: cmd.id,
                purpose: cmd.purpose,
                status: cmd.status,
                expiresAt: cmd.expiresAt.toISOString(),
              }
            : null,
          events: (eventsByBooking.get(b.id) ?? []).map((e) => ({
            id: String(e.id),
            type: e.eventType,
            actorType: e.actorType,
            createdAt: e.createdAt.toISOString(),
            metadata: e.metadata,
          })),
          createdAt: b.createdAt.toISOString(),
        },
      ];
    }),
  );
  return bookingIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/** Loads a booking only if owned by the customer. Returns 404 (not 403) to avoid leaking existence. */
export async function getOwnedBooking(db: DbOrTx, customerId: string, bookingId: string) {
  const [b] = await db
    .select()
    .from(storageBookings)
    .where(and(eq(storageBookings.id, bookingId), eq(storageBookings.customerId, customerId)));
  if (!b) throw notFound('Booking');
  return b;
}

export async function cancelBooking(customerId: string, bookingId: string, requestId: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [b] = await tx
      .select()
      .from(storageBookings)
      .where(and(eq(storageBookings.id, bookingId), eq(storageBookings.customerId, customerId)))
      .for('update');
    if (!b) throw notFound('Booking');
    const cancellable: BookingStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'ACCESS_READY'];
    if (!cancellable.includes(b.status)) {
      throw conflict('NOT_CANCELLABLE', `A ${b.status} booking cannot be cancelled`);
    }
    const actor: Actor = { type: 'USER', id: customerId };
    await transitionBooking(tx, {
      bookingId: b.id,
      from: b.status,
      to: 'CANCELLED',
      eventType: 'BOOKING_CANCELLED',
      actor,
    });
    await revokeCredentials(tx, b.id, 'BOOKING_CANCELLED');
    await tx
      .update(deviceCommands)
      .set({ status: 'EXPIRED', resultDetail: 'BOOKING_CANCELLED' })
      .where(and(eq(deviceCommands.bookingId, b.id), eq(deviceCommands.status, 'PENDING')));
    // Refund execution policy is an open product decision; flag captured payments for refund.
    await tx
      .update(payments)
      .set({ status: 'REFUND_REQUIRED', updatedAt: clock.now() })
      .where(and(eq(payments.bookingId, b.id), eq(payments.status, 'CAPTURED')));
    await audit(tx, {
      actor,
      action: 'booking.cancelled',
      resourceType: 'storage_booking',
      resourceId: b.id,
      requestId,
      metadata: { fromStatus: b.status },
    });
  });
}

// ---------------------------------------------------------------- credentials

export const hashPin = (bookingId: string, pin: string) =>
  hmacSha256(config().ACCESS_PIN_PEPPER, `${bookingId}:${pin}`);

export async function revokeCredentials(tx: Tx, bookingId: string, reason: string) {
  await tx
    .update(accessCredentials)
    .set({ revokedAt: clock.now(), revokedReason: reason })
    .where(and(eq(accessCredentials.bookingId, bookingId), isNull(accessCredentials.revokedAt)));
}

/** Issues (or re-issues, revoking the old one) a PIN for the booking. The PIN is returned once. */
export async function issueCredential(
  customerId: string,
  bookingId: string,
  requestId: string,
): Promise<CredentialIssued> {
  return getDb().transaction(async (tx) => {
    const [b] = await tx
      .select()
      .from(storageBookings)
      .where(and(eq(storageBookings.id, bookingId), eq(storageBookings.customerId, customerId)))
      .for('update');
    if (!b) throw notFound('Booking');
    if (!['CONFIRMED', 'ACCESS_READY', 'ACTIVE'].includes(b.status)) {
      throw conflict('CREDENTIAL_NOT_AVAILABLE', `No access credential for a ${b.status} booking`);
    }
    const reissue = b.status !== 'CONFIRMED';
    await revokeCredentials(tx, b.id, 'REISSUED');
    const pin = newPin(6);
    // Credential covers deposit through the paid window; overstay retrieval uses the app path.
    await tx.insert(accessCredentials).values({
      bookingId: b.id,
      compartmentId: b.compartmentId,
      credentialHash: hashPin(b.id, pin),
      credentialType: 'PIN',
      validFrom: b.startsAt,
      expiresAt: b.expiresAt,
    });
    const actor: Actor = { type: 'USER', id: customerId };
    if (b.status === 'CONFIRMED') {
      await transitionBooking(tx, {
        bookingId: b.id,
        from: 'CONFIRMED',
        to: 'ACCESS_READY',
        eventType: 'ACCESS_CREDENTIAL_ISSUED',
        actor,
      });
    } else {
      await recordBookingEvent(tx, b.id, 'ACCESS_CREDENTIAL_REISSUED', actor);
    }
    await audit(tx, {
      actor,
      action: reissue ? 'credential.reissued' : 'credential.issued',
      resourceType: 'storage_booking',
      resourceId: b.id,
      requestId,
    });
    return { pin, validFrom: b.startsAt.toISOString(), expiresAt: b.expiresAt.toISOString() };
  });
}

// ---------------------------------------------------------------- physical access

/**
 * Authorises and queues a short-lived UNLOCK command for exactly the booking's compartment.
 * Callers must have already established that the actor may act on this booking.
 */
export async function issueUnlockCommand(
  tx: Tx,
  args: {
    booking: BookingRow;
    purpose: AccessPurpose;
    actor: Actor;
    requestId?: string;
    via: 'APP' | 'PIN';
  },
) {
  const { booking, purpose, actor } = args;
  const now = clock.now();
  const expected = nextAccessPurpose(booking, now);
  if (expected !== purpose) {
    throw conflict(
      'ACCESS_NOT_ALLOWED',
      expected
        ? `This booking currently allows ${expected}, not ${purpose}`
        : `No locker access is allowed for this booking right now`,
    );
  }
  const [ctx] = await tx
    .select({
      compartment: compartments,
      outlet: outlets,
      device: devices,
    })
    .from(compartments)
    .innerJoin(lockerBanks, eq(lockerBanks.id, compartments.lockerBankId))
    .innerJoin(outlets, eq(outlets.id, lockerBanks.outletId))
    .leftJoin(devices, eq(devices.lockerBankId, lockerBanks.id))
    .where(eq(compartments.id, booking.compartmentId))
    .for('update', { of: compartments });
  if (!ctx) throw notFound('Compartment');
  if (ctx.compartment.operationalStatus !== 'IN_SERVICE') {
    throw conflict(
      'COMPARTMENT_UNAVAILABLE',
      'This compartment is under inspection or out of service. Please contact support.',
    );
  }
  if (!isOpenAt(ctx.outlet.operatingHours, ctx.outlet.timezone, now)) {
    throw conflict('OUTLET_CLOSED', 'The outlet is currently closed');
  }
  const d = ctx.device;
  const offlineAfter = config().DEVICE_OFFLINE_AFTER_SECONDS;
  if (
    !d ||
    d.status !== 'ONLINE' ||
    !d.lastSeenAt ||
    now.getTime() - d.lastSeenAt.getTime() > offlineAfter * 1000
  ) {
    throw new AppError(503, 'DEVICE_OFFLINE', 'The locker is offline. Please try again shortly.');
  }

  const [inflight] = await tx
    .select()
    .from(deviceCommands)
    .where(
      and(
        eq(deviceCommands.compartmentId, booking.compartmentId),
        inArray(deviceCommands.status, ['PENDING', 'DELIVERED', 'ACKNOWLEDGED']),
      ),
    );
  if (inflight) {
    if (inflight.bookingId === booking.id && inflight.purpose === purpose) return inflight; // idempotent
    throw conflict('COMMAND_IN_PROGRESS', 'Another locker operation is in progress');
  }

  const [cmd] = await tx
    .insert(deviceCommands)
    .values({
      deviceId: d.id,
      compartmentId: booking.compartmentId,
      bookingId: booking.id,
      commandType: 'UNLOCK',
      purpose,
      requestedBy: actor.type === 'USER' ? actor.id : null,
      nonce: randomBytes(18).toString('base64url'),
      issuedAt: now,
      expiresAt: addSeconds(now, config().UNLOCK_COMMAND_TTL_SECONDS),
    })
    .returning();
  await recordBookingEvent(tx, booking.id, 'UNLOCK_REQUESTED', actor, {
    commandId: cmd!.id,
    purpose,
    via: args.via,
  });
  await audit(tx, {
    actor,
    action: 'device.unlock_requested',
    resourceType: 'device_command',
    resourceId: cmd!.id,
    requestId: args.requestId,
    metadata: {
      bookingId: booking.id,
      compartmentId: booking.compartmentId,
      purpose,
      via: args.via,
    },
  });
  return cmd!;
}

export async function requestAccessFromApp(
  customerId: string,
  bookingId: string,
  purpose: AccessPurpose,
  requestId: string,
) {
  return getDb().transaction(async (tx) => {
    const [b] = await tx
      .select()
      .from(storageBookings)
      .where(and(eq(storageBookings.id, bookingId), eq(storageBookings.customerId, customerId)))
      .for('update');
    if (!b) throw notFound('Booking');
    const cmd = await issueUnlockCommand(tx, {
      booking: b,
      purpose,
      actor: { type: 'USER', id: customerId },
      requestId,
      via: 'APP',
    });
    return { commandId: cmd.id, status: cmd.status, expiresAt: cmd.expiresAt.toISOString() };
  });
}
