import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { pgConstraint, pgErrorCode } from '../db/client.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found', requestId: req.requestId },
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.requestId;
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, requestId, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        requestId,
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  // Malformed JSON bodies from express.json()
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
    res
      .status(400)
      .json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body', requestId } });
    return;
  }
  const code = pgErrorCode(err);
  if (code === '23P01' && pgConstraint(err) === 'storage_bookings_no_overlap') {
    res.status(409).json({
      error: {
        code: 'NO_AVAILABILITY',
        message: 'That compartment was just taken. Please request a new quote.',
        requestId,
      },
    });
    return;
  }
  logger.error({ err, requestId }, 'unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId },
  });
}
