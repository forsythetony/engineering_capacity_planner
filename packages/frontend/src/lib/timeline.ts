import type { IsoDate } from '@ecp/shared';
import { addDays, diffDays, formatIso, parseIso } from '@ecp/shared';

/** A linear date→fraction scale across a fixed date domain. */
export interface Scale {
  start: IsoDate;
  end: IsoDate;
  /** Total span in days (≥ 1). */
  days: number;
  /** Position of a date as a fraction `[0, 1]` of the domain (clamped). */
  fractionOf(date: IsoDate): number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function makeScale(start: IsoDate, end: IsoDate): Scale {
  const days = Math.max(1, diffDays(start, end));
  return {
    start,
    end,
    days,
    fractionOf: (date: IsoDate) => clamp01(diffDays(start, date) / days),
  };
}

/**
 * A date domain spanning all of `dates`, with padding on each end. Undefined /
 * empty inputs are ignored; at least one date must be present.
 */
export function computeDomain(
  dates: ReadonlyArray<IsoDate | null | undefined>,
  paddingDays = 7,
): { start: IsoDate; end: IsoDate } {
  const valid = dates.filter((d): d is IsoDate => Boolean(d)).sort();
  if (valid.length === 0) throw new Error('computeDomain: no dates provided');
  return {
    start: addDays(valid[0]!, -paddingDays),
    end: addDays(valid[valid.length - 1]!, paddingDays),
  };
}

/** First-of-month dates within `[start, end]`, inclusive — for axis ticks. */
export function monthTicks(start: IsoDate, end: IsoDate): IsoDate[] {
  const ticks: IsoDate[] = [];
  let d = firstOfMonthOnOrAfter(start);
  while (d <= end) {
    ticks.push(d);
    d = firstOfNextMonth(d);
  }
  return ticks;
}

function firstOfMonthOnOrAfter(date: IsoDate): IsoDate {
  const dt = parseIso(date);
  if (dt.getUTCDate() === 1) return date;
  return formatIso(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1)));
}

function firstOfNextMonth(date: IsoDate): IsoDate {
  const dt = parseIso(date);
  return formatIso(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1)));
}
