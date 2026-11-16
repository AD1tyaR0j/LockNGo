import type { QuoteLine } from '@sl/shared';

export interface StoragePricingRule {
  baseAmountMinor: number;
  perHourAmountMinor: number;
  /** Basis points: 1800 = 18%. */
  taxBps: number;
}

export interface StoragePrice {
  totalMinor: number;
  breakdown: QuoteLine[];
}

/**
 * Pure storage price calculation. All values are integer paise.
 * Tax is rounded half-up to the nearest paisa on the taxable subtotal.
 */
export function priceStorage(rule: StoragePricingRule, durationHours: number): StoragePrice {
  if (!Number.isInteger(durationHours) || durationHours < 1) {
    throw new RangeError('durationHours must be a positive integer');
  }
  for (const v of [rule.baseAmountMinor, rule.perHourAmountMinor, rule.taxBps]) {
    if (!Number.isInteger(v) || v < 0)
      throw new RangeError('pricing values must be non-negative integers');
  }
  const base = rule.baseAmountMinor;
  const hourly = rule.perHourAmountMinor * durationHours;
  const subtotal = base + hourly;
  const tax = Math.floor((subtotal * rule.taxBps + 5000) / 10000);
  const breakdown: QuoteLine[] = [
    { label: 'Base fee', amountMinor: base },
    { label: `Storage (${durationHours} h)`, amountMinor: hourly },
  ];
  if (rule.taxBps > 0) {
    breakdown.push({ label: `Tax (${(rule.taxBps / 100).toFixed(2)}%)`, amountMinor: tax });
  }
  return { totalMinor: subtotal + tax, breakdown };
}
