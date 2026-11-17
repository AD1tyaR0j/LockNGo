/**
 * Zod-free entry point (`@sl/shared/constants`) for clients that only need enums and limits,
 * so they do not bundle the validation library.
 */
export * from './enums';

/** Hard platform limits for MVP. Commercial values (prices) live in admin-configured pricing rules. */
export const BOOKING_LIMITS = {
  minHours: 1,
  maxHours: 72,
  maxAdvanceDays: 7,
} as const;
