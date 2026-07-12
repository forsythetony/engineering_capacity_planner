import type { IsoDate, Team } from '@ecp/shared';
import { addDays, diffDays, enumerateWorkingDays } from '@ecp/shared';

/**
 * A single sprint, derived purely from the team's cadence config.
 *
 * Boundaries are tiled off {@link Team.sprintAnchorDate} in fixed
 * {@link Team.sprintLengthDays} steps, so `sprint 0` starts on the anchor,
 * `sprint 1` one length later, `sprint -1` one length earlier, and so on. Since
 * the anchor is a real sprint start, every boundary lands on the configured
 * start weekday (when the length is a whole number of weeks).
 */
export interface SprintWindow {
  index: number;
  /** First calendar day of the sprint (inclusive). */
  start: IsoDate;
  /** Last calendar day of the sprint (inclusive). */
  end: IsoDate;
  /** Working days within the sprint, in order. */
  workingDays: IsoDate[];
}

/** Index of the sprint that contains `date` (may be negative, before anchor). */
export function sprintIndexFor(date: IsoDate, team: Team): number {
  return Math.floor(diffDays(team.sprintAnchorDate, date) / team.sprintLengthDays);
}

/** Build the sprint with a given index. */
export function sprintByIndex(team: Team, index: number): SprintWindow {
  const start = addDays(team.sprintAnchorDate, index * team.sprintLengthDays);
  const end = addDays(start, team.sprintLengthDays - 1);
  return {
    index,
    start,
    end,
    workingDays: enumerateWorkingDays(start, end, team.workingDays),
  };
}

/** The sprint that contains `date`. */
export function sprintFor(date: IsoDate, team: Team): SprintWindow {
  return sprintByIndex(team, sprintIndexFor(date, team));
}

/**
 * A memoized `index → Sprint` lookup for one team. The projection walks many
 * days that share a sprint, so caching avoids rebuilding the same sprint (and
 * re-enumerating its working days) repeatedly.
 */
export function makeSprintCache(team: Team): (index: number) => SprintWindow {
  const cache = new Map<number, SprintWindow>();
  return (index: number): SprintWindow => {
    let sprint = cache.get(index);
    if (sprint === undefined) {
      sprint = sprintByIndex(team, index);
      cache.set(index, sprint);
    }
    return sprint;
  };
}
