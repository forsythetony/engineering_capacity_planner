import type { IsoDate, Weekday } from './domain.js';

const MS_PER_DAY = 86_400_000;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Canonical human date, e.g. `"Sun Jul 12, 2026"`. */
export function formatHumanDate(date: IsoDate): string {
  const dt = parseIso(date);
  return `${WEEKDAY_NAMES[dt.getUTCDay()]} ${MONTH_NAMES[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`;
}

/** Human date without the year, e.g. `"Sun Jul 12"`. */
export function formatHumanDateShort(date: IsoDate): string {
  const dt = parseIso(date);
  return `${WEEKDAY_NAMES[dt.getUTCDay()]} ${MONTH_NAMES[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

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

/** Whole calendar days from `from` to `to` (negative if `to` precedes `from`). */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / MS_PER_DAY);
}

/** Weekday of a date, `0` = Sunday … `6` = Saturday (matches `Date.getUTCDay()`). */
export function getWeekday(date: IsoDate): Weekday {
  return parseIso(date).getUTCDay() as Weekday;
}

/** True if `date` falls on one of `workingDays`. */
export function isWorkingDay(date: IsoDate, workingDays: readonly Weekday[]): boolean {
  return workingDays.includes(getWeekday(date));
}

/**
 * The first working day on or after `date`. Throws if `workingDays` is empty
 * (no working day could ever be found).
 */
export function nextWorkingDay(date: IsoDate, workingDays: readonly Weekday[]): IsoDate {
  if (workingDays.length === 0) throw new Error('nextWorkingDay: no working days configured');
  let d = date;
  for (let i = 0; i < 7; i++) {
    if (isWorkingDay(d, workingDays)) return d;
    d = addDays(d, 1);
  }
  // Unreachable: any 7-day window contains every weekday.
  throw new Error('nextWorkingDay: no working day found within a week');
}

/** All working days in the inclusive range `[start, end]`, in order. */
export function enumerateWorkingDays(
  start: IsoDate,
  end: IsoDate,
  workingDays: readonly Weekday[],
): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (isWorkingDay(d, workingDays)) out.push(d);
  }
  return out;
}

/**
 * Signed count of working days between two dates: the number of working days
 * strictly after the earlier date, up to and including the later date. Returns
 * a positive number when `to` is after `from`, negative when `to` is before
 * `from`, and `0` when they are equal.
 *
 * This is the buffer metric used by the capacity engine (project plan §5):
 * `workingDaysBetween(projectedDevComplete, gatingDate)` is the slack, in
 * working days, before the gating relevant day.
 */
export function workingDaysBetween(
  from: IsoDate,
  to: IsoDate,
  workingDays: readonly Weekday[],
): number {
  if (from === to) return 0;
  const sign = to > from ? 1 : -1;
  const [lo, hi] = sign > 0 ? [from, to] : [to, from];
  let count = 0;
  for (let d = addDays(lo, 1); d <= hi; d = addDays(d, 1)) {
    if (isWorkingDay(d, workingDays)) count++;
  }
  return sign * count;
}
