import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  accessRequestSchema,
  createBookingSchema,
  paginationSchema,
  storageQuoteRequestSchema,
} from '@sl/shared';
import { getDb } from '../../db/client.js';
import { storageBookings } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { config } from '../../config.js';
import { requirePermission, requireUser } from '../../middleware/context.js';
import {
  cancelBooking,
  createBooking,
  createStorageQuote,
  getBookingDetail,
  getOwnedBooking,
  issueCredential,
  requestAccessFromApp,
} from './service.js';

const accessLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => (config().NODE_ENV === 'test' ? 1000 : 10),
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

const bookingId = (raw: unknown) => {
  const r = z.string().uuid().safeParse(raw);
  if (!r.success) throw notFound('Booking');
  return r.data;
};

export const storageRouter = Router();
storageRouter.use(requirePermission('storage:book'));

storageRouter.post('/quotes', async (req, res) => {
  const user = requireUser(req);
  res.status(201).json(await createStorageQuote(user.id, storageQuoteRequestSchema.parse(req.body)));
});

storageRouter.post('/bookings', async (req, res) => {
  const user = requireUser(req);
  const key = req.header('idempotency-key');
  if (!key || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
    throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header (8–100 chars) is required');
  }
  const input = createBookingSchema.parse(req.body);
  const result = await createBooking({
    customerId: user.id,
    quoteId: input.quoteId,
    idempotencyKey: key,
    requestId: req.requestId,
  });
  res.status(201).json(result);
});

storageRouter.get('/bookings', async (req, res) => {
  const user = requireUser(req);
  const p = paginationSchema.parse(req.query);
  const db = getDb();
  const rows = await db
    .select({ id: storageBookings.id })
    .from(storageBookings)
    .where(eq(storageBookings.customerId, user.id))
    .orderBy(desc(storageBookings.createdAt))
    .limit(p.limit)
    .offset(p.offset);
  const [total] = await db
    .select({ n: count() })
    .from(storageBookings)
    .where(eq(storageBookings.customerId, user.id));
  res.json({
    items: await Promise.all(rows.map((r) => getBookingDetail(db, r.id))),
    total: total?.n ?? 0,
    limit: p.limit,
    offset: p.offset,
  });
});

storageRouter.get('/bookings/:bookingId', async (req, res) => {
  const user = requireUser(req);
  const db = getDb();
  const b = await getOwnedBooking(db, user.id, bookingId(req.params.bookingId));
  res.json(await getBookingDetail(db, b.id));
});

storageRouter.post('/bookings/:bookingId/cancel', async (req, res) => {
  const user = requireUser(req);
  const id = bookingId(req.params.bookingId);
  await cancelBooking(user.id, id, req.requestId);
  res.json(await getBookingDetail(getDb(), id));
});

storageRouter.post('/bookings/:bookingId/credential', accessLimiter, async (req, res) => {
  const user = requireUser(req);
  res
    .status(201)
    .json(await issueCredential(user.id, bookingId(req.params.bookingId), req.requestId));
});

storageRouter.post('/bookings/:bookingId/access', accessLimiter, async (req, res) => {
  const user = requireUser(req);
  const { purpose } = accessRequestSchema.parse(req.body);
  res
    .status(202)
    .json(await requestAccessFromApp(user.id, bookingId(req.params.bookingId), purpose, req.requestId));
});

