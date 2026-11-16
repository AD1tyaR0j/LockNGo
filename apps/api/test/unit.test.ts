import { describe, expect, it } from 'vitest';
import { priceStorage } from '../src/modules/pricing/pricing.js';
import { isOpenAt } from '../src/modules/outlets/hours.js';
import {
  BOOKING_TRANSITIONS,
  canTransition,
  nextCompartmentStatus,
} from '../src/modules/storage/state-machine.js';
import { nextAccessPurpose } from '../src/modules/storage/service.js';

describe('priceStorage', () => {
  it('computes integer paise with tax', () => {
    const p = priceStorage({ baseAmountMinor: 2000, perHourAmountMinor: 3000, taxBps: 1800 }, 3);
    // subtotal 11000, tax 1980
    expect(p.totalMinor).toBe(12980);
    expect(p.breakdown.map((l) => l.amountMinor)).toEqual([2000, 9000, 1980]);
  });

  it('rounds tax half-up to the paisa', () => {
    // subtotal 1003 * 18% = 180.54 -> 181
    const p = priceStorage({ baseAmountMinor: 3, perHourAmountMinor: 1000, taxBps: 1800 }, 1);
    expect(p.totalMinor).toBe(1003 + 181);
  });

  it('omits tax line when tax is zero', () => {
    const p = priceStorage({ baseAmountMinor: 0, perHourAmountMinor: 100, taxBps: 0 }, 2);
    expect(p.breakdown).toHaveLength(2);
    expect(p.totalMinor).toBe(200);
  });

  it('rejects fractional hours and negative or float rates', () => {
    const rule = { baseAmountMinor: 1, perHourAmountMinor: 1, taxBps: 0 };
    expect(() => priceStorage(rule, 1.5)).toThrow();
    expect(() => priceStorage(rule, 0)).toThrow();
    expect(() => priceStorage({ ...rule, perHourAmountMinor: -1 }, 1)).toThrow();
    expect(() => priceStorage({ ...rule, baseAmountMinor: 1.2 }, 1)).toThrow();
  });
});

describe('isOpenAt (Asia/Kolkata, UTC+5:30)', () => {
  const tz = 'Asia/Kolkata';
  const at = (istHHMM: string) => {
    const [h, m] = istHHMM.split(':').map(Number);
    // 2026-01-15 at IST time -> UTC
    return new Date(Date.UTC(2026, 0, 15, h! - 5, m! - 30));
  };
  const day = { open: '08:00', close: '23:00', is24x7: false };

  it('handles a same-day window', () => {
    expect(isOpenAt(day, tz, at('07:59'))).toBe(false);
    expect(isOpenAt(day, tz, at('08:00'))).toBe(true);
    expect(isOpenAt(day, tz, at('22:59'))).toBe(true);
    expect(isOpenAt(day, tz, at('23:00'))).toBe(false);
  });

  it('handles an overnight window', () => {
    const night = { open: '20:00', close: '02:00', is24x7: false };
    expect(isOpenAt(night, tz, at('21:00'))).toBe(true);
    expect(isOpenAt(night, tz, at('01:30'))).toBe(true);
    expect(isOpenAt(night, tz, at('12:00'))).toBe(false);
  });

  it('24x7 is always open', () => {
    expect(isOpenAt({ open: '00:00', close: '00:00', is24x7: true }, tz, at('03:00'))).toBe(true);
  });
});

describe('booking state machine', () => {
  it('terminal states have no exits', () => {
    for (const s of ['COMPLETED', 'CANCELLED', 'EXPIRED'] as const) {
      expect(BOOKING_TRANSITIONS[s]).toEqual([]);
    }
  });

  it('cannot complete or free a booking without going through ACTIVE', () => {
    expect(canTransition('CONFIRMED', 'COMPLETED')).toBe(false);
    expect(canTransition('ACCESS_READY', 'COMPLETED')).toBe(false);
    expect(canTransition('PENDING_PAYMENT', 'ACTIVE')).toBe(false);
  });

  it('an ACTIVE booking (items inside) cannot be cancelled or expired', () => {
    expect(canTransition('ACTIVE', 'CANCELLED')).toBe(false);
    expect(canTransition('ACTIVE', 'EXPIRED')).toBe(false);
  });

  it('derives the next physical action', () => {
    const now = new Date('2026-01-01T10:00:00Z');
    const window = { startsAt: new Date('2026-01-01T09:00:00Z'), expiresAt: new Date('2026-01-01T12:00:00Z') };
    expect(nextAccessPurpose({ ...window, status: 'ACCESS_READY' }, now)).toBe('DEPOSIT');
    expect(nextAccessPurpose({ ...window, status: 'ACTIVE' }, now)).toBe('RETRIEVE');
    expect(nextAccessPurpose({ ...window, status: 'PENDING_PAYMENT' }, now)).toBeNull();
    // Overstay: retrieval is still allowed after the paid window ends.
    expect(nextAccessPurpose({ ...window, status: 'ACTIVE' }, new Date('2026-01-02T00:00:00Z'))).toBe('RETRIEVE');
    // Deposit only inside the window.
    expect(nextAccessPurpose({ ...window, status: 'CONFIRMED' }, new Date('2026-01-01T08:00:00Z'))).toBeNull();
  });
});

describe('compartment operational state machine', () => {
  it('allows the documented transitions', () => {
    expect(nextCompartmentStatus('IN_SERVICE', 'DISABLE')).toBe('OUT_OF_SERVICE');
    expect(nextCompartmentStatus('OUT_OF_SERVICE', 'RETURN_TO_SERVICE')).toBe('IN_SERVICE');
    expect(nextCompartmentStatus('OUT_OF_SERVICE', 'MARK_NEEDS_INSPECTION')).toBe('NEEDS_INSPECTION');
    expect(nextCompartmentStatus('NEEDS_INSPECTION', 'RETURN_TO_SERVICE')).toBe('IN_SERVICE');
  });

  it('rejects invalid transitions', () => {
    expect(() => nextCompartmentStatus('IN_SERVICE', 'RETURN_TO_SERVICE')).toThrow();
    expect(() => nextCompartmentStatus('OUT_OF_SERVICE', 'DISABLE')).toThrow();
  });
});
