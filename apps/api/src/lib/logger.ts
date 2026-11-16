import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config().NODE_ENV === 'test' ? 'silent' : config().LOG_LEVEL,
  // Never log credentials, tokens or PINs, even if they end up on a logged object.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-mock-signature"]',
      '*.password',
      '*.pin',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
});
