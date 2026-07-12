import type {
  IsoDate,
  Oncall,
  Pto,
  Team,
  TeamMember,
  VelocityOverride,
  WorkItem,
} from '@ecp/shared';
import { addDays, isWorkingDay, workingDaysBetween } from '@ecp/shared';
import { makeSprintCache, sprintIndexFor } from './calendar.js';
import { buildCapacityContext, dayCapacity, sprintCapacity } from './capacity.js';
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from './config.js';

/** Floating-point slack for accumulation comparisons. */
const EPS = 1e-9;

/** Red / yellow / green feasibility band (project plan §5). */
export type Verdict = 'green' | 'yellow' | 'red';

export interface ProjectionInput {
  /** The date the projection is made from ("today"). */
  today: IsoDate;
  team: Team;
  members: TeamMember[];
  pto?: Pto[];
  oncall?: Oncall[];
  velocityOverrides?: VelocityOverride[];
  /** The epic's work items. Remaining points are derived from their statuses. */
  workItems: WorkItem[];
  /** The gating "relevant day" the verdict is measured against. */
  gatingDate: IsoDate;
  /** Optional overrides for any engine knob. */
  config?: Partial<EngineConfig>;
}

/** Per-sprint capacity, for rendering the timeline (project plan §6). */
export interface SprintProjection {
  index: number;
  start: IsoDate;
  end: IsoDate;
  /** Full-sprint capacity in points. */
  capacity: number;
}

export interface ProjectionResult {
  /** Points not yet done. */
  remainingPoints: number;
  /** Date the remaining work is projected to finish, or `null` if unreachable. */
  projectedDevCompleteDate: IsoDate | null;
  gatingDate: IsoDate;
  /**
   * Buffer in working days = `workingDaysBetween(devComplete, gatingDate)`.
   * Positive = slack before the gating day; `0` = finishing exactly on it;
   * negative = finishing after it. `null` when dev-complete is unreachable.
   */
  bufferWorkingDays: number | null;
  verdict: Verdict;
  /** Human-readable explanation of the verdict. */
  reason: string;
  /** Full-sprint capacities from today's sprint through the projected finish. */
  sprints: SprintProjection[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Sum of points across work items that are not yet `Done`. */
export function remainingPoints(items: readonly WorkItem[]): number {
  return items.reduce((sum, item) => (item.status === 'Done' ? sum : sum + item.points), 0);
}

/**
 * Project an epic's dev-complete date and classify it against its gating day
 * (project plan §5). Pure and deterministic: given identical inputs it always
 * returns the identical result.
 *
 * The algorithm walks forward one working day at a time from `today`,
 * accumulating each day's team throughput (see {@link dayCapacity}) until the
 * remaining points are covered. The day the cumulative capacity first meets the
 * remaining work is the projected dev-complete date.
 */
export function project(input: ProjectionInput): ProjectionResult {
  const cfg: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, ...input.config };
  const remaining = remainingPoints(input.workItems);

  const ctx = buildCapacityContext({
    members: input.members,
    pto: input.pto ?? [],
    oncall: input.oncall ?? [],
    velocityOverrides: input.velocityOverrides ?? [],
    oncallMultiplier: cfg.oncallMultiplier,
  });
  const getSprint = makeSprintCache(input.team);

  // --- Walk forward day by day until the remaining work is covered. --------
  let projectedDevCompleteDate: IsoDate | null = null;
  if (remaining <= EPS) {
    projectedDevCompleteDate = input.today;
  } else {
    let cumulative = 0;
    let day = input.today;
    for (let i = 0; i <= cfg.maxHorizonDays; i++, day = addDays(day, 1)) {
      if (!isWorkingDay(day, input.team.workingDays)) continue;
      const sprint = getSprint(sprintIndexFor(day, input.team));
      cumulative += dayCapacity(day, sprint, ctx);
      if (cumulative + EPS >= remaining) {
        projectedDevCompleteDate = day;
        break;
      }
    }
  }

  // --- Buffer + verdict. ---------------------------------------------------
  const { verdict, reason, bufferWorkingDays } = classify(
    projectedDevCompleteDate,
    remaining,
    input,
    cfg,
  );

  // --- Sprint capacity trace for the timeline UI. --------------------------
  const firstIndex = sprintIndexFor(input.today, input.team);
  const lastIndex =
    projectedDevCompleteDate !== null
      ? sprintIndexFor(projectedDevCompleteDate, input.team)
      : firstIndex;
  const sprints: SprintProjection[] = [];
  for (let idx = firstIndex; idx <= lastIndex; idx++) {
    const sprint = getSprint(idx);
    sprints.push({
      index: sprint.index,
      start: sprint.start,
      end: sprint.end,
      capacity: round2(sprintCapacity(sprint, ctx)),
    });
  }

  return {
    remainingPoints: remaining,
    projectedDevCompleteDate,
    gatingDate: input.gatingDate,
    bufferWorkingDays,
    verdict,
    reason,
    sprints,
  };
}

function classify(
  devComplete: IsoDate | null,
  remaining: number,
  input: ProjectionInput,
  cfg: EngineConfig,
): { verdict: Verdict; reason: string; bufferWorkingDays: number | null } {
  const gating = input.gatingDate;

  if (devComplete === null) {
    return {
      verdict: 'red',
      bufferWorkingDays: null,
      reason: `Remaining ${round2(remaining)} points cannot be completed before the ${cfg.maxHorizonDays}-day horizon with current capacity.`,
    };
  }

  const buffer = workingDaysBetween(devComplete, gating, input.team.workingDays);

  if (remaining <= EPS) {
    // Everything is already done; the verdict still reflects the buffer band.
    const verdict: Verdict =
      buffer < 0 ? 'red' : buffer < cfg.greenMinBufferDays ? 'yellow' : 'green';
    return {
      verdict,
      bufferWorkingDays: buffer,
      reason: `All work is complete; ${buffer} working day(s) of buffer before the gating day ${gating}.`,
    };
  }

  if (buffer < 0) {
    return {
      verdict: 'red',
      bufferWorkingDays: buffer,
      reason: `Projected dev-complete ${devComplete} is ${-buffer} working day(s) past the gating day ${gating}.`,
    };
  }
  if (buffer < cfg.greenMinBufferDays) {
    return {
      verdict: 'yellow',
      bufferWorkingDays: buffer,
      reason: `Projected dev-complete ${devComplete} leaves only ${buffer} working day(s) of buffer before ${gating} (want ≥ ${cfg.greenMinBufferDays}).`,
    };
  }
  return {
    verdict: 'green',
    bufferWorkingDays: buffer,
    reason: `Projected dev-complete ${devComplete} leaves ${buffer} working days of buffer before the gating day ${gating}.`,
  };
}
