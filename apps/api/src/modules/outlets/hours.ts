import type { OperatingHours } from '@sl/shared';

/** Minutes since local midnight in the given IANA time zone. */
export function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  const m = Number(parts.find((p) => p.type === 'minute')?.value);
  return h * 60 + m;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Whether the outlet is open at `at`. Supports overnight windows (e.g. 20:00–02:00).
 * The closing minute itself is treated as closed.
 */
export function isOpenAt(hours: OperatingHours, timeZone: string, at: Date): boolean {
  if (hours.is24x7) return true;
  const open = toMinutes(hours.open);
  const close = toMinutes(hours.close);
  if (open === close) return false;
  const now = localMinutes(at, timeZone);
  return open < close ? now >= open && now < close : now >= open || now < close;
}
