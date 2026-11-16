import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { deviceCommandAckSchema, deviceEventSchema, deviceHeartbeatSchema } from '@sl/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { config } from '../../config.js';
import { requireDevice } from '../../middleware/context.js';
import {
  acknowledgeCommand,
  ingestDeviceEvent,
  pollCommands,
  recordHeartbeat,
  verifyPinAtDevice,
} from './service.js';

/**
 * Internal device API, separate from customer routes. Milestone 1 transport is HTTPS polling;
 * Phase 2 replaces it with MQTT over TLS (see docs/adr/0005-device-transport.md).
 */
export const deviceRouter = Router();
deviceRouter.use(requireDevice);

const dev = (req: { device?: import('../../middleware/context.js').AuthDevice }) => {
  if (!req.device) throw new AppError(401, 'UNAUTHENTICATED', 'Device authentication required');
  return req.device;
};

deviceRouter.post('/heartbeat', async (req, res) => {
  res.json(await recordHeartbeat(dev(req), deviceHeartbeatSchema.parse(req.body)));
});

deviceRouter.get('/commands', async (req, res) => {
  res.json({ commands: await pollCommands(dev(req)) });
});

deviceRouter.post('/commands/:commandId/ack', async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.commandId);
  if (!id.success) throw notFound('Command');
  res.json(await acknowledgeCommand(dev(req), id.data, deviceCommandAckSchema.parse(req.body)));
});

deviceRouter.post('/events', async (req, res) => {
  res.json(await ingestDeviceEvent(dev(req), deviceEventSchema.parse(req.body)));
});

const pinLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => (config().NODE_ENV === 'test' ? 1000 : 30),
  keyGenerator: (req) => req.device?.id ?? 'unknown',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

deviceRouter.post('/access/verify-pin', pinLimiter, async (req, res) => {
  const body = z
    .object({ compartmentCode: z.string().max(12), pin: z.string().regex(/^\d{6}$/) })
    .parse(req.body);
  const r = await verifyPinAtDevice(dev(req), body.compartmentCode, body.pin);
  if (!r.ok) throw r.error;
  res.status(202).json({ commandId: r.commandId, purpose: r.purpose });
});
