import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb } from './db/client.js';
import { startSweeper } from './jobs/sweeper.js';
import { logger } from './lib/logger.js';
import { paymentProvider } from './modules/payments/index.js';

const cfg = config();
const app = createApp();
const stopSweeper = startSweeper();

const server = app.listen(cfg.PORT, () => {
  logger.info({ port: cfg.PORT, env: cfg.NODE_ENV }, 'api listening');
  if (paymentProvider().isMock) logger.warn('PAYMENTS ARE MOCKED — no real money moves');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  stopSweeper();
  server.close(() => {
    void closeDb().then(() => process.exit(0));
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
