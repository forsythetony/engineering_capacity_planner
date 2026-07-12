import type { IsoDate, Weekday } from '@ecp/shared';
import { addDays, enumerateWorkingDays } from '@ecp/shared';
import { ENGINE_DEFAULTS } from '@ecp/shared';
import { dayCapacity, type CapacityContext } from './capacity.js';
import type { SprintWindow } from './calendar.js';

/**
 * The Gantt Planner's weekly capacity math (project plan §6a).
 *
 * A sprint is sliced into 7-day **weeks** from its start. Each week's capacity
 * is the team throughput over that week's working days, and its verdict compares
 * the points *placed* into the week against that capacity. This reuses the
 * projection engine's per-day {@link dayCapacity} unchanged: because a member's
 * velocity is prorated across the sprint's working days, summing `dayCapacity`
 * over a subset of days (one week) yields exactly that week's slice of sprint
 * capacity — with PTO/on-call/overrides landing in the specific week they fall.
 */

/** Floating-point slack for load-vs-capacity comparisons. */
const EPS = 1e-9;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A 7-day slice of a sprint. */
export interface WeekWindow {
  /** 0-based index within the sprint. */
  index: number;
  /** First calendar day of the week (inclusive). */
  start: IsoDate;
  /** Last calendar day of the week (inclusive; clipped to the sprint end). */
  end: IsoDate;
  /** Working days within the week, in order. */
  workingDays: IsoDate[];
}

/** Load-vs-capacity band for a single week. */
export type WeekVerdict = 'green' | 'yellow' | 'red';

/** A week with its computed capacity, placed load, and verdict. */
export interface WeekPlan {
  index: number;
  start: IsoDate;
  end: IsoDate;
  /** Team capacity for the week, in points. */
  capacity: number;
  /** Points placed into the week. */
  placedPoints: number;
  verdict: WeekVerdict;
}

export interface WeeklyPlanInput {
  /** Sprint bounds (authoritative — from the stored sprint). */
  startDate: IsoDate;
  endDate: IsoDate;
  /** The team's working weekdays, used to prorate capacity. */
  workingDays: Weekday[];
  /** Pre-built capacity context (members, PTO, on-call, overrides). */
  capacityCtx: CapacityContext;
  /** Points placed into each week, keyed by 0-based week index. */
  placedPointsByWeek: ReadonlyMap<number, number>;
  /** Fraction of capacity at/above which a week turns yellow (default 1.0). */
  yellowLoadFraction?: number;
}

/** Slice `[start, end]` into consecutive 7-day weeks (the last may be short). */
export function sprintWeeks(
  start: IsoDate,
  end: IsoDate,
  workingDays: Weekday[],
): WeekWindow[] {
  const weeks: WeekWindow[] = [];
  let weekStart = start;
  let index = 0;
  while (weekStart <= end) {
    const naturalEnd = addDays(weekStart, 6);
    const weekEnd = naturalEnd <= end ? naturalEnd : end;
    weeks.push({
      index,
      start: weekStart,
      end: weekEnd,
      workingDays: enumerateWorkingDays(weekStart, weekEnd, workingDays),
    });
    weekStart = addDays(weekEnd, 1);
    index++;
  }
  return weeks;
}

/**
 * Classify a week by how loaded it is:
 * - **red** — placed load exceeds capacity (over-committed),
 * - **yellow** — placed load is at/above `yellowLoadFraction` of capacity but
 *   not over it ("tight"),
 * - **green** — comfortable slack.
 *
 * A week with no capacity (everyone out) is red if anything is placed in it,
 * green otherwise.
 */
export function weekVerdict(
  placedPoints: number,
  capacity: number,
  yellowLoadFraction: number = ENGINE_DEFAULTS.WEEK_YELLOW_LOAD_FRACTION,
): WeekVerdict {
  if (capacity <= EPS) return placedPoints > EPS ? 'red' : 'green';
  if (placedPoints > capacity + EPS) return 'red';
  if (placedPoints + EPS >= capacity * yellowLoadFraction) return 'yellow';
  return 'green';
}

/** Compute the per-week capacity / load / verdict for one sprint. */
export function weeklyPlan(input: WeeklyPlanInput): WeekPlan[] {
  const fraction = input.yellowLoadFraction ?? ENGINE_DEFAULTS.WEEK_YELLOW_LOAD_FRACTION;
  // A SprintWindow spanning the whole sprint gives dayCapacity the correct
  // proration denominator (the sprint's total working-day count).
  const sprintWindow: SprintWindow = {
    index: 0,
    start: input.startDate,
    end: input.endDate,
    workingDays: enumerateWorkingDays(input.startDate, input.endDate, input.workingDays),
  };

  return sprintWeeks(input.startDate, input.endDate, input.workingDays).map((week) => {
    let capacity = 0;
    for (const day of week.workingDays) capacity += dayCapacity(day, sprintWindow, input.capacityCtx);
    capacity = round2(capacity);
    const placedPoints = input.placedPointsByWeek.get(week.index) ?? 0;
    return {
      index: week.index,
      start: week.start,
      end: week.end,
      capacity,
      placedPoints,
      verdict: weekVerdict(placedPoints, capacity, fraction),
    };
  });
}
