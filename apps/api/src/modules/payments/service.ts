import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { paymentWebhookEvents, payments, storageBookings } from '../../db/schema.js';
import { audit, type Actor } from '../../lib/audit.js';
import { clock } from '../../lib/clock.js';
import { transitionBooking } from '../storage/transitions.js';
import { paymentProvider } from './index.js';

export type WebhookOutcome =
  | 'DUPLICATE'
  | 'UNKNOWN_ORDER'
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CANCELLED'
  | 'REFUND_REQUIRED'
  | 'AMOUNT_MISMATCH'
  | 'IGNORED';

const SYSTEM: Actor = { type: 'SYSTEM', id: 'payments-webhook' };

/**
 * Verifies and applies a provider webhook. Idempotent: the (provider, event id) pair is
 * recorded in the same transaction as its effects, so a duplicate delivery is a no-op.
 */
export async function processPaymentWebhook(
  rawBody: Buffer,
  headers: Record<string, string | undefined>,
  requestId?: string,
): Promise<WebhookOutcome> {
  const provider = paymentProvider();
  const event = provider.parseVerifiedWebhook(rawBody, headers); // throws 401 on bad signature

  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(paymentWebhookEvents)
      .values({
        provider: provider.name,
        providerEventId: event.providerEventId,
        eventType: event.type,
        payload: { ...event },
      })
      .onConflictDoNothing()
      .returning({ id: paymentWebhookEvents.id });
    if (inserted.length === 0) return 'DUPLICATE';

    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.providerOrderId, event.providerOrderId))
      .for('update');
    if (!payment || payment.provider !== provider.name) return 'UNKNOWN_ORDER';
    const [booking] = await tx
      .select()
      .from(storageBookings)
      .where(eq(storageBookings.id, payment.bookingId))
      .for('update');
    if (!booking) return 'UNKNOWN_ORDER';
    const now = clock.now();

    if (event.type === 'payment.failed') {
      if (payment.status !== 'CREATED') return 'IGNORED';
      await tx
        .update(payments)
        .set({ status: 'FAILED', failureReason: event.reason, updatedAt: now })
        .where(eq(payments.id, payment.id));
      if (booking.status === 'PENDING_PAYMENT') {
        await transitionBooking(tx, {
          bookingId: booking.id,
          from: 'PENDING_PAYMENT',
          to: 'CANCELLED',
          eventType: 'PAYMENT_FAILED',
          actor: SYSTEM,
          metadata: { paymentId: payment.id },
        });
      }
      await audit(tx, {
        actor: SYSTEM,
        action: 'payment.failed',
        resourceType: 'payment',
        resourceId: payment.id,
        requestId,
        metadata: { bookingId: booking.id },
      });
      return 'BOOKING_CANCELLED';
    }

    // payment.captured
    if (payment.status !== 'CREATED') return 'IGNORED';
    if (event.amountMinor !== payment.amountMinor || event.currency !== payment.currency) {
      await audit(tx, {
        actor: SYSTEM,
        action: 'payment.amount_mismatch',
        resourceType: 'payment',
        resourceId: payment.id,
        requestId,
        metadata: { expected: payment.amountMinor, received: event.amountMinor },
      });
      await tx
        .update(payments)
        .set({
          status: 'REFUND_REQUIRED',
          providerPaymentId: event.providerPaymentId,
          updatedAt: now,
        })
        .where(eq(payments.id, payment.id));
      return 'AMOUNT_MISMATCH';
    }

    const holdValid =
      booking.status === 'PENDING_PAYMENT' &&
      booking.paymentHoldExpiresAt !== null &&
      booking.paymentHoldExpiresAt > now;

    if (!holdValid) {
      // Money arrived after the hold lapsed or the booking was cancelled: never confirm, flag refund.
      if (booking.status === 'PENDING_PAYMENT') {
        await transitionBooking(tx, {
          bookingId: booking.id,
          from: 'PENDING_PAYMENT',
          to: 'EXPIRED',
          eventType: 'PAYMENT_HOLD_EXPIRED',
          actor: SYSTEM,
        });
      }
      await tx
        .update(payments)
        .set({
          status: 'REFUND_REQUIRED',
          providerPaymentId: event.providerPaymentId,
          updatedAt: now,
        })
        .where(eq(payments.id, payment.id));
      await audit(tx, {
        actor: SYSTEM,
        action: 'payment.late_capture_refund_required',
        resourceType: 'payment',
        resourceId: payment.id,
        requestId,
        metadata: { bookingId: booking.id, bookingStatus: booking.status },
      });
      return 'REFUND_REQUIRED';
    }

    await tx
      .update(payments)
      .set({ status: 'CAPTURED', providerPaymentId: event.providerPaymentId, updatedAt: now })
      .where(eq(payments.id, payment.id));
    await transitionBooking(tx, {
      bookingId: booking.id,
      from: 'PENDING_PAYMENT',
      to: 'CONFIRMED',
      eventType: 'PAYMENT_CAPTURED',
      actor: SYSTEM,
      metadata: { paymentId: payment.id, isMock: provider.isMock },
      set: { paymentHoldExpiresAt: null },
    });
    await audit(tx, {
      actor: SYSTEM,
      action: 'payment.captured',
      resourceType: 'payment',
      resourceId: payment.id,
      requestId,
      metadata: {
        bookingId: booking.id,
        amountMinor: payment.amountMinor,
        isMock: provider.isMock,
      },
    });
    return 'BOOKING_CONFIRMED';
  });
}
