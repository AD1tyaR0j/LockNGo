import type { BookingStatus, CompartmentOperationalStatus } from '@sl/shared';
import { conflict } from '../../lib/errors.js';

/**
 * Storage booking lifecycle. Physical compartment state is tracked separately
 * (see docs/adr/0004-compartment-vs-booking-state.md).
 *
 * PENDING_PAYMENT ─ payment verified ─> CONFIRMED ─ PIN issued ─> ACCESS_READY
 *        │                                  │                         │
 *        ├─ payment failed / cancel ─> CANCELLED <─ cancel ───────────┤
 *        └─ hold expired ──────────> EXPIRED <─ window ended, never deposited
 * CONFIRMED|ACCESS_READY ─ door open+close after authorised DEPOSIT unlock ─> ACTIVE
 * ACTIVE ─ door open+close after authorised RETRIEVE unlock ─> COMPLETED
 * ACTIVE ─ dispute raised ─> DISPUTED
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['ACCESS_READY', 'ACTIVE', 'CANCELLED', 'EXPIRED'],
  ACCESS_READY: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  ACTIVE: ['COMPLETED', 'DISPUTED'],
  DISPUTED: ['ACTIVE', 'COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export function assertBookingTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw conflict('INVALID_STATE_TRANSITION', `Booking cannot move from ${from} to ${to}`, {
      from,
      to,
    });
  }
}

export type CompartmentAction = 'DISABLE' | 'MARK_NEEDS_INSPECTION' | 'RETURN_TO_SERVICE';

const COMPARTMENT_ACTIONS: Record<
  CompartmentAction,
  { from: readonly CompartmentOperationalStatus[]; to: CompartmentOperationalStatus }
> = {
  DISABLE: { from: ['IN_SERVICE', 'NEEDS_INSPECTION'], to: 'OUT_OF_SERVICE' },
  MARK_NEEDS_INSPECTION: { from: ['IN_SERVICE', 'OUT_OF_SERVICE'], to: 'NEEDS_INSPECTION' },
  RETURN_TO_SERVICE: { from: ['NEEDS_INSPECTION', 'OUT_OF_SERVICE'], to: 'IN_SERVICE' },
};

export function nextCompartmentStatus(
  current: CompartmentOperationalStatus,
  action: CompartmentAction,
): CompartmentOperationalStatus {
  const rule = COMPARTMENT_ACTIONS[action];
  if (!rule.from.includes(current)) {
    throw conflict('INVALID_STATE_TRANSITION', `Cannot ${action} a compartment that is ${current}`);
  }
  return rule.to;
}
