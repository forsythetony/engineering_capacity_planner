import type { IsoDate } from '@ecp/shared';
import type { Verdict } from '@ecp/engine';
import { parseIso } from '@ecp/shared';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** e.g. `"Feb 25"`. */
export function formatDay(date: IsoDate): string {
  const dt = parseIso(date);
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

/** e.g. `"Feb 25, 2026"`. */
export function formatFullDay(date: IsoDate): string {
  return `${formatDay(date)}, ${parseIso(date).getUTCFullYear()}`;
}

/** e.g. `"Jan 2026"`. */
export function formatMonth(date: IsoDate): string {
  const dt = parseIso(date);
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  green: 'On track',
  yellow: 'At risk',
  red: 'Off track',
};
