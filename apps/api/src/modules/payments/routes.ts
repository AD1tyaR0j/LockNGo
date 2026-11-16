import express, { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { mockPaymentOutcomeSchema } from '@sl/shared';
import { getDb } from '../../db/client.js';
import { payments, storageBookings } from '../../db/schema.js';
import { AppError, notFound } from '../../lib/errors.js';
import { config } from '../../config.js';
import { requirePermission, requireUser } from '../../middleware/context.js';
import { mockProvider, paymentProvider } from './index.js';
import { processPaymentWebhook } from './service.js';

/** Provider webhooks: raw body is required for signature verification. No user auth. */
export const paymentWebhookRouter = Router();
paymentWebhookRouter.post(
  '/:provider',
  express.raw({ type: 'application/json', limit: '64kb' }),
  async (req, res) => {
    if (req.params.provider !== paymentProvider().name) throw notFound('Webhook');
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'INVALID_BODY', 'Expected JSON body');
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
    );
    const outcome = await processPaymentWebhook(req.body, headers, req.requestId);
    res.json({ received: true, outcome });
  },
);

/**
 * MOCK CHECKOUT — development only. Stands in for the provider's hosted checkout page:
 * it makes the mock "gateway" emit a signed webhook, which then goes through the exact same
 * verification + processing as a real provider webhook. It does not change booking state itself.
 */
export const mockCheckoutRouter = Router();
mockCheckoutRouter.post(
  '/:paymentId/complete',
  requirePermission('storage:book'),
  async (req, res) => {
    const mock = mockProvider();
    if (!mock || !config().ENABLE_DEV_TOOLS) throw notFound('Route');
    const user = requireUser(req);
    const { outcome } = mockPaymentOutcomeSchema.parse(req.body);
    const [row] = await getDb()
      .select({ p: payments })
      .from(payments)
      .innerJoin(storageBookings, eq(storageBookings.id, payments.bookingId))
      .where(and(eq(payments.id, String(req.params.paymentId)), eq(storageBookings.customerId, user.id)));
    if (!row) throw notFound('Payment');
    const webhook = mock.buildWebhook(
      outcome === 'success'
        ? {
            id: `mock_evt_${randomUUID()}`,
            type: 'payment.captured',
            orderId: row.p.providerOrderId,
            paymentId: `mock_pay_${randomUUID()}`,
            amountMinor: row.p.amountMinor,
            currency: row.p.currency,
          }
        : {
            id: `mock_evt_${randomUUID()}`,
            type: 'payment.failed',
            orderId: row.p.providerOrderId,
            reason: 'MOCK_DECLINED',
          },
    );
    const result = await processPaymentWebhook(webhook.rawBody, webhook.headers, req.requestId);
    res.json({ mock: true, outcome: result });
  },
);
