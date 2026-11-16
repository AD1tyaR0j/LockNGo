import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { authenticateUser, requestId } from './middleware/context.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRouter, meRouter } from './modules/auth/routes.js';
import { outletsRouter } from './modules/outlets/routes.js';
import { storageRouter } from './modules/storage/routes.js';
import { mockCheckoutRouter, paymentWebhookRouter } from './modules/payments/routes.js';
import { deviceRouter } from './modules/devices/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { paymentProvider } from './modules/payments/index.js';

export function createApp() {
  const cfg = config();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      // Avoid logging bodies (may contain PII) — method, url, status and timing only.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(
    cors({
      origin: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()),
      allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-request-id'],
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', paymentProvider: paymentProvider().name, paymentsAreMock: paymentProvider().isMock });
  });

  // Webhooks need the raw body: mount before express.json().
  app.use('/api/v1/webhooks/payments', paymentWebhookRouter);

  app.use(express.json({ limit: '100kb' }));

  // Device API is separate from user auth.
  app.use('/api/v1/devices', deviceRouter);

  app.use('/api/v1', authenticateUser);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/me', meRouter);
  app.use('/api/v1/outlets', outletsRouter);
  app.use('/api/v1/storage', storageRouter);
  app.use('/api/v1/payments/mock', mockCheckoutRouter);
  app.use('/api/v1/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
