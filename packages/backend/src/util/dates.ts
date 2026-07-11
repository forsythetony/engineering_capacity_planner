import type { IsoDate } from '@ecp/shared';

/** Parse an ISO `YYYY-MM-DD` date into a UTC `Date` at midnight. */
export function parseIso(date: IsoDate): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format a UTC `Date` back to an ISO `YYYY-MM-DD` string. */
export function formatIso(date: Date): IsoDate {
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Return `date` shifted by `days` calendar days (may be negative). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const dt = parseIso(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatIso(dt);
}
