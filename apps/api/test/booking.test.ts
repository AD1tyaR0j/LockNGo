import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db/client.js';
import { clock, addHours, addMinutes } from '../src/lib/clock.js';
import { runSweep } from '../src/jobs/sweeper.js';
import { mockProvider } from '../src/modules/payments/index.js';
import { storageBookings } from '../src/db/schema.js';
import {
  api,
  auth,
  book,
  createOutlet,
  paidBooking,
  pay,
  quote,
  registerCustomer,
} from './helpers.js';

afterAll(closeDb);
afterEach(() => vi.restoreAllMocks());

const timeTravel = (to: Date) => vi.spyOn(clock, 'now').mockReturnValue(to);

describe('quote and booking', () => {
  it('quote → booking → mock payment confirms the booking via the signed webhook path', async () => {
    const o = await createOutlet();
    const c = await registerCustomer();
    const q = await quote(c.token, o.outletId, { durationHours: 3 });
    expect(q.status).toBe(201);
    expect(q.body.total.currency).toBe('INR');
    expect(Number.isInteger(q.body.total.amountMinor)).toBe(true);

    const b = await book(c.token, q.body.id);
    expect(b.status).toBe(201);
    expect(b.body.booking.status).toBe('PENDING_PAYMENT');
    expect(b.body.payment.isMock).toBe(true);
    expect(b.body.booking.total.amountMinor).toBe(q.body.total.amountMinor);
    expect(b.body.booking.compartment.isSimulated).toBe(true);

    const p = await pay(c.token, b.body.payment.id);
    expect(p.body).toMatchObject({ mock: true, outcome: 'BOOKING_CONFIRMED' });
    const detail = await api().get(`/api/v1/storage/bookings/${b.body.booking.id}`).set(auth(c.token));
    expect(detail.body.status).toBe('CONFIRMED');
    expect(detail.body.payment.status).toBe('CAPTURED');
    expect(detail.body.events.map((e: { type: string }) => e.type)).toEqual([
      'BOOKING_CREATED',
      'PAYMENT_CAPTURED',
    ]);
  });

  it('a failed payment never produces a confirmed booking and releases the compartment', async () => {
    const o = await createOutlet();
    const c = await registerCustomer();
    const q = await quote(c.token, o.outletId);
    const b = await book(c.token, q.body.id);
    const p = await pay(c.token, b.body.payment.id, 'failure');
    expect(p.body.outcome).toBe('BOOKING_CANCELLED');
    const d = await api().get(`/api/v1/storage/bookings/${b.body.booking.id}`).set(auth(c.token));
    expect(d.body.status).toBe('CANCELLED');
    expect(d.body.payment.status).toBe('FAILED');
    // A later success webhook for the same order cannot resurrect it.
    const again = await pay(c.token, b.body.payment.id, 'success');
    expect(again.body.outcome).toBe('IGNORED');
    // Inventory is free again.
    const c2 = await registerCustomer();
    expect((await quote(c2.token, o.outletId)).status).toBe(201);
  });

  it('the price the customer pays comes from the server quote, not the client', async () => {
    const o = await createOutlet();
    const c = await registerCustomer();
    const q = await quote(c.token, o.outletId);
    const res = await api()
      .post('/api/v1/storage/bookings')
      .set(auth(c.token))
      .set('Idempotency-Key', 'tamper-attempt-1')
      .send({ quoteId: q.body.id, amountMinor: 1 });
    expect(res.status).toBe(201);
    expect(res.body.booking.total.amountMinor).toBe(q.body.total.amountMinor);
  });

  it('booking creation is idempotent per Idempotency-Key and a quote cannot be reused', async () => {
    const o = await createOutlet([
      { code: 'S1', size: 'S' },
      { code: 'S2', size: 'S' },
    ]);
    const c = await registerCustomer();
    const q = await quote(c.token, o.outletId);
    const a = await book(c.token, q.body.id, 'same-key-123');
    const b = await book(c.token, q.body.id, 'same-key-123');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.booking.id).toBe(a.body.booking.id);
    expect(b.body.payment.id).toBe(a.body.payment.id);
    const reuse = await book(c.token, q.body.id, 'different-key-456');
    expect(reuse.status).toBe(409);
    expect(reuse.body.error.code).toBe('QUOTE_USED');
  });

  it('requires an Idempotency-Key', async () => {
    const o = await createOutlet();
    const c = await registerCustomer();
    const q = await quote(c.token, o.outletId);
    const res = await api().post('/api/v1/storage/bookings').set(auth(c.token)).send({ quoteId: q.body.id });
    expect(res.status).toBe(400);
  });

  it("a customer cannot view, cancel, pay for or use another customer's booking or quote", async () => {
    const o = await createOutlet([
      { code: 'S1', size: 'S' },
      { code: 'S2', size: 'S' },
    ]);
    const owner = await registerCustomer();
    const other = await registerCustomer();
    const q = await quote(owner.token, o.outletId);
    const b = await book(owner.token, q.body.id);
    const id = b.body.booking.id;
    expect((await api().get(`/api/v1/storage/bookings/${id}`).set(auth(other.token))).status).toBe(404);
    expect((await api().post(`/api/v1/storage/bookings/${id}/cancel`).set(auth(other.token))).status).toBe(404);
    expect((await api().post(`/api/v1/storage/bookings/${id}/credential`).set(auth(other.token))).status).toBe(404);
    expect(
      (await api().post(`/api/v1/storage/bookings/${id}/access`).set(auth(other.token)).send({ purpose: 'DEPOSIT' }))
        .status,
    ).toBe(404);
    expect((await pay(other.token, b.body.payment.id)).status).toBe(404);
    const list = await api().get('/api/v1/storage/bookings').set(auth(other.token));
    expect(list.body.items).toHaveLength(0);
    // Quotes are bound to the customer too.
    const q2 = await quote(owner.token, o.outletId);
    expect(q2.status).toBe(201);
    expect((await book(other.token, q2.body.id)).status).toBe(404);
  });
});

describe('double-booking prevention', () => {
  it('concurrent customers racing for the last compartment: exactly one wins', async () => {
    const o = await createOutlet([{ code: 'S1', size: 'S' }]);
    const customers = await Promise.all(Array.from({ length: 8 }, () => registerCustomer()));
    // Everyone gets a quote first (quotes do not hold inventory).
    const quotes = await Promise.all(customers.map((c) => quote(c.token, o.outletId)));
    expect(quotes.every((q) => q.status === 201)).toBe(true);
    const results = await Promise.all(customers.map((c, i) => book(c.token, quotes[i]!.body.id)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    for (const r of results.filter((r) => r.status === 409)) {
      expect(r.body.error.code).toBe('NO_AVAILABILITY');
    }
  });

  it('allows non-overlapping bookings of the same compartment and blocks overlapping ones', async () => {
    const o = await createOutlet([{ code: 'S1', size: 'S' }]);
    const a = await registerCustomer();
    const b = await registerCustomer();
    const now = clock.now();
    const later = addHours(now, 5).toISOString();
    await paidBooking(a.token, o.outletId, { durationHours: 2 });
    // Starts after the first ends: fine.
    expect((await quote(b.token, o.outletId, { startsAt: later, durationHours: 2 })).status).toBe(201);
    // Overlaps the first: no availability.
    const overlapping = await quote(b.token, o.outletId, { startsAt: addHours(now, 1).toISOString(), durationHours: 2 });
    expect(overlapping.status).toBe(409);
  });

  it('the database EXCLUDE constraint rejects overlaps even if application checks are bypassed', async () => {
    const o = await createOutlet([{ code: 'S1', size: 'S' }]);
    const c = await registerCustomer();
    const id = await paidBooking(c.token, o.outletId, { durationHours: 2 });
    const [orig] = await getDb().select().from(storageBookings).where(sql`id = ${id}`);
    const insertOverlap = (status: string, ref: string) =>
      getDb().execute(sql`
        WITH q AS (
          INSERT INTO price_quotes (customer_id, service_type, outlet_id, size, starts_at, ends_at,
            amount_minor, breakdown, pricing_rule_id, expires_at)
          SELECT customer_id, 'STORAGE', outlet_id, 'S', starts_at, expires_at, 1, '[]'::jsonb,
            pricing_rule_id, now() FROM price_quotes WHERE id = ${orig!.priceQuoteId}
          RETURNING id)
        INSERT INTO storage_bookings (reference, customer_id, outlet_id, compartment_id, starts_at, expires_at,
          status, price_quote_id, amount_minor, idempotency_key)
        SELECT ${ref}, customer_id, outlet_id, compartment_id, starts_at + interval '30 minutes',
          expires_at + interval '1 hour', ${status}::booking_status, (SELECT id FROM q), 1, ${ref}
        FROM storage_bookings WHERE id = ${id}`);
    await expect(insertOverlap('CONFIRMED', 'SLB-RAWTEST1')).rejects.toMatchObject({
      cause: { code: '23P01' },
    });
    // Non-blocking statuses (e.g. historical CANCELLED rows) may overlap.
    await expect(insertOverlap('CANCELLED', 'SLB-RAWTEST2')).resolves.toBeDefined();
  });
});

describe('expiry and late payments', () => {
  it('an unpaid hold expires and releases inventory', async () => {
    const o = await createOutlet([{ code: 'S1', size: 'S' }]);
    const a = await registerCustomer();
    const q = await quote(a.token, o.outletId);
    const b = await book(a.token, q.body.id);
    const other = await registerCustomer();
    expect((await quote(other.token, o.outletId)).status).toBe(409);

    timeTravel(addMinutes(new Date(), 11));
    const sweep = await runSweep();
    expect(sweep.expiredHolds).toBeGreaterThanOrEqual(1);
    vi.restoreAllMocks();

    const d = await api().get(`/api/v1/storage/bookings/${b.body.booking.id}`).set(auth(a.token));
    expect(d.body.status).toBe('EXPIRED');
    expect((await quote(other.token, o.outletId)).status).toBe(201);
  });

  it('a payment captured after the hold lapsed does not confirm the booking and is flagged for refund', async () => {
    const o = await createOutlet();
    const c = await registerCustomer();
    const q = await quote(c.token, o.outletId);
    const b = await book(c.token, q.body.id);
    // Payment arrives late, before the sweeper has run.
    timeTravel(addMinutes(new Date(), 11));
    const p = await pay(c.token, b.body.payment.id);
    vi.restoreAllMocks();
    expect(p.body.outcome).toBe('REFUND_REQUIRED');
    const d = await api().get(`/api/v1/storage/bookings/${b.body.booking.id}`).set(auth(c.token));
    expect(d.body.status).toBe('EXPIRED');
    expect(d.body.payment.status).toBe('REFUND_REQUIRED');
  });

  it('a paid booking whose window ends without a deposit expires', async () => {
    const o = await createOutlet();
    const c = await registerCustomer();
    const id = await paidBooking(c.token, o.outletId, { durationHours: 1 });
    timeTravel(addHours(new Date(), 2));
    await runSweep();
    vi.restoreAllMocks();
    const d = await api().get(`/api/v1/storage/bookings/${id}`).set(auth(c.token));
    expect(d.body.status).toBe('EXPIRED');
  });
});

describe('payment webhooks', () => {
  it('duplicate deliveries of the same event are processed once', async () => {
    const o = await createOutlet();
    const c = await registerCustomer();
    const q = await quote(c.token, o.outletId);
    const b = await book(c.token, q.body.id);
    const mock = mockProvider()!;
    const { rawBody, headers } = mock.buildWebhook({
      id: 'evt_dup_test_1',
      type: 'payment.captured',
      orderId: b.body.payment.providerOrderId,
      paymentId: 'pay_1',
      amountMinor: b.body.payment.amount.amountMinor,
      currency: 'INR',
    });
    const send = () =>
      api()
        .post('/api/v1/webhooks/payments/mock')
        .set('content-type', 'application/json')
        .set(headers)
        .send(rawBody.toString());
    const [r1, r2] = await Promise.all([send(), send()]);
    expect([r1.body.outcome, r2.body.outcome].sort()).toEqual(['BOOKING_CONFIRMED', 'DUPLICATE']);
    const r3 = await send();
    expect(r3.body.outcome).toBe('DUPLICATE');
    const d = await api().get(`/api/v1/storage/bookings/${b.body.booking.id}`).set(auth(c.token));
    expect(d.body.events.filter((e: { type: string }) => e.type === 'PAYMENT_CAPTURED')).toHaveLength(1);
  });

  it('rejects webhooks with an invalid signature', async () => {
    const res = await api()
      .post('/api/v1/webhooks/payments/mock')
      .set('content-type', 'application/json')
      .set('x-mock-signature', 'ab'.repeat(32))
      .send(JSON.stringify({ id: 'x', type: 'payment.captured', orderId: 'o', paymentId: 'p', amountMinor: 1, currency: 'INR' }));
    expect(res.status).toBe(401);
  });

  it('flags an amount mismatch instead of confirming', async () => {
    const o = await createOutlet();
    const c = await registerCustomer();
    const q = await quote(c.token, o.outletId);
    const b = await book(c.token, q.body.id);
    const { rawBody, headers } = mockProvider()!.buildWebhook({
      id: 'evt_mismatch_1',
      type: 'payment.captured',
      orderId: b.body.payment.providerOrderId,
      paymentId: 'pay_x',
      amountMinor: 1,
      currency: 'INR',
    });
    const res = await api()
      .post('/api/v1/webhooks/payments/mock')
      .set('content-type', 'application/json')
      .set(headers)
      .send(rawBody.toString());
    expect(res.body.outcome).toBe('AMOUNT_MISMATCH');
    const d = await api().get(`/api/v1/storage/bookings/${b.body.booking.id}`).set(auth(c.token));
    expect(d.body.status).toBe('PENDING_PAYMENT');
  });
});

describe('cancellation', () => {
  it('cancelling a paid, unused booking flags the payment for refund; ACTIVE bookings cannot be cancelled', async () => {
    const o = await createOutlet();
    const c = await registerCustomer();
    const id = await paidBooking(c.token, o.outletId);
    const res = await api().post(`/api/v1/storage/bookings/${id}/cancel`).set(auth(c.token));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.payment.status).toBe('REFUND_REQUIRED');
    const again = await api().post(`/api/v1/storage/bookings/${id}/cancel`).set(auth(c.token));
    expect(again.status).toBe(409);
  });
});
