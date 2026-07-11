import type { IsoDate, Oncall, Pto, TeamMember, VelocityOverride } from '@ecp/shared';
import type { Sprint } from './calendar.js';

interface DateRange {
  start: IsoDate;
  end: IsoDate;
}

/**
 * Pre-indexed inputs for the per-day capacity calculation. Built once via
 * {@link buildCapacityContext} and reused across every day of the projection.
 */
export interface CapacityContext {
  /** Active members only (inactive members contribute nothing). */
  members: TeamMember[];
  ptoByMember: Map<string, DateRange[]>;
  oncallByMember: Map<string, DateRange[]>;
  overridesByMember: Map<string, VelocityOverride[]>;
  oncallMultiplier: number;
}

export interface CapacityInputs {
  members: TeamMember[];
  pto: Pto[];
  oncall: Oncall[];
  velocityOverrides: VelocityOverride[];
  oncallMultiplier: number;
}

/** Inclusive containment on ISO dates (lexical compare is valid for `YYYY-MM-DD`). */
function inRange(date: IsoDate, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

function groupRanges<T extends { memberId: string; startDate: IsoDate; endDate: IsoDate }>(
  rows: readonly T[],
): Map<string, DateRange[]> {
  const map = new Map<string, DateRange[]>();
  for (const r of rows) {
    const list = map.get(r.memberId) ?? [];
    list.push({ start: r.startDate, end: r.endDate });
    map.set(r.memberId, list);
  }
  return map;
}

export function buildCapacityContext(inputs: CapacityInputs): CapacityContext {
  const overridesByMember = new Map<string, VelocityOverride[]>();
  for (const ov of inputs.velocityOverrides) {
    const list = overridesByMember.get(ov.memberId) ?? [];
    list.push(ov);
    overridesByMember.set(ov.memberId, list);
  }
  return {
    members: inputs.members.filter((m) => m.active),
    ptoByMember: groupRanges(inputs.pto),
    oncallByMember: groupRanges(inputs.oncall),
    overridesByMember,
    oncallMultiplier: inputs.oncallMultiplier,
  };
}

/**
 * A member's availability factor for a single day, in `[0, 1+]`:
 * - `0` on PTO,
 * - scaled by the on-call multiplier when on call,
 * - scaled by every velocity override active that day.
 *
 * These compose multiplicatively — e.g. a ramping hire (override 0.5) who is
 * also on call (multiplier 0.5) contributes `0.25` that day.
 */
export function memberDayFactor(
  member: TeamMember,
  date: IsoDate,
  ctx: CapacityContext,
): number {
  const ptos = ctx.ptoByMember.get(member.id);
  if (ptos && ptos.some((r) => inRange(date, r))) return 0;

  let factor = 1;
  const oncalls = ctx.oncallByMember.get(member.id);
  if (oncalls && oncalls.some((r) => inRange(date, r))) factor *= ctx.oncallMultiplier;

  const overrides = ctx.overridesByMember.get(member.id);
  if (overrides) {
    for (const ov of overrides) {
      if (inRange(date, { start: ov.startDate, end: ov.endDate })) factor *= ov.multiplier;
    }
  }
  return factor;
}

/**
 * Points the team produces on a single working `date` within `sprint`.
 *
 * A member's per-sprint velocity is spread evenly across the sprint's working
 * days (`baseVelocity / workingDaysInSprint`), then scaled by that member's
 * availability for the day. Summed across active members, this is the day's
 * throughput. Prorating by the sprint's own working-day count means a partial
 * (already-underway) sprint contributes only its remaining days.
 */
export function dayCapacity(date: IsoDate, sprint: Sprint, ctx: CapacityContext): number {
  const workingDaysInSprint = sprint.workingDays.length;
  if (workingDaysInSprint === 0) return 0;
  let total = 0;
  for (const member of ctx.members) {
    total += (member.baseVelocity / workingDaysInSprint) * memberDayFactor(member, date, ctx);
  }
  return total;
}

/** Total points the team can produce across a full sprint. */
export function sprintCapacity(sprint: Sprint, ctx: CapacityContext): number {
  let total = 0;
  for (const day of sprint.workingDays) total += dayCapacity(day, sprint, ctx);
  return total;
}
