import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hmacSha256, safeEqualHex } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import type { PaymentProvider, VerifiedPaymentEvent } from './provider.js';

/**
 * MOCK payment provider — development and tests only. No money moves.
 *
 * It mimics a real gateway's shape: orders are created server-side, and payment outcomes
 * arrive as HMAC-signed webhooks which go through the same verification and idempotent
 * processing as a real provider would.
 */
export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';

const mockEventSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('payment.captured'),
    orderId: z.string().min(1),
    paymentId: z.string().min(1),
    amountMinor: z.number().int().nonnegative(),
    currency: z.string(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('payment.failed'),
    orderId: z.string().min(1),
    reason: z.string().max(200),
  }),
]);
export type MockWebhookBody = z.infer<typeof mockEventSchema>;

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly isMock = true;

  constructor(private readonly webhookSecret: string) {}

  async createOrder() {
    return { providerOrderId: `mock_order_${randomUUID()}` };
  }

  sign(rawBody: string): string {
    return hmacSha256(this.webhookSecret, rawBody);
  }

  /** Builds a signed webhook exactly as the mock "gateway" would send it. */
  buildWebhook(event: MockWebhookBody): { rawBody: Buffer; headers: Record<string, string> } {
    const raw = JSON.stringify(event);
    return { rawBody: Buffer.from(raw), headers: { [MOCK_SIGNATURE_HEADER]: this.sign(raw) } };
  }

  parseVerifiedWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): VerifiedPaymentEvent {
    const sig = headers[MOCK_SIGNATURE_HEADER];
    if (!sig || !safeEqualHex(sig, this.sign(rawBody.toString('utf8')))) {
      throw new AppError(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new AppError(400, 'INVALID_JSON', 'Malformed webhook body');
    }
    const e = mockEventSchema.parse(json);
    return e.type === 'payment.captured'
      ? {
          providerEventId: e.id,
          type: e.type,
          providerOrderId: e.orderId,
          providerPaymentId: e.paymentId,
          amountMinor: e.amountMinor,
          currency: e.currency,
        }
      : { providerEventId: e.id, type: e.type, providerOrderId: e.orderId, reason: e.reason };
  }

  async initiateRefund() {
    return { providerRefundId: `mock_refund_${randomUUID()}` };
  }
}
