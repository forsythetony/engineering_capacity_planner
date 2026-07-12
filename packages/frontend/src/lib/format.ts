import type { IsoDate } from '@ecp/shared';
import type { Verdict } from '@ecp/engine';
import { formatHumanDate, formatHumanDateShort, parseIso } from '@ecp/shared';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Canonical full date, e.g. `"Sun Jul 12, 2026"`. */
export const formatDate = formatHumanDate;

/** Compact date without the year, e.g. `"Sun Jul 12"` — for tight timeline markers. */
export const formatDayShort = formatHumanDateShort;

/** Month + year, e.g. `"Jul 2026"` — for axis ticks. */
export function formatMonth(date: IsoDate): string {
  const dt = parseIso(date);
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  green: 'On track',
  yellow: 'At risk',
  red: 'Off track',
};
