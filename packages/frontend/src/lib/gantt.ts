import type { IsoDate, Sprint, TeamMember, UserStory, WorkItem } from '@ecp/shared';
import { addDays } from '@ecp/shared';
import { buildCapacityContext, weeklyPlan, type WeekPlan } from '@ecp/engine';
import type { EpicScope } from './projection';

/**
 * View-model for the Gantt Planner tab (project plan §6a). Given an epic scope
 * and a selected sprint, it derives the week columns (capacity + placed load +
 * verdict), the horizontal label lanes, the placed chips per `(lane × week)`
 * cell, the per-member weekly-capacity breakdown, and the unplaced backlog
 * "bag". Pure — it runs the engine's `weeklyPlan` in the browser so the board
 * recomputes live, mirroring `projection.ts` for the timeline.
 */

/** No label → this catch-all lane. */
export const UNLABELED = 'Unlabeled';

function effectiveLabels(
  w: WorkItem,
  story: UserStory | undefined,
  applyParentLabels: boolean,
  ignored: ReadonlySet<string>,
): string[] {
  const labels = [...(w.labels ?? [])];
  if (applyParentLabels) labels.push(...(story?.labels ?? []));
  return [...new Set(labels.map((l) => l.trim()).filter((l) => l !== '' && !ignored.has(l)))];
}

const primaryLabel = (
  w: WorkItem,
  story: UserStory | undefined,
  applyParentLabels: boolean,
  ignored: ReadonlySet<string>,
): string => effectiveLabels(w, story, applyParentLabels, ignored)[0] ?? UNLABELED;

const isDone = (w: WorkItem): boolean => w.status === 'Done';

/** A horizontal lane: an epic subdivision sourced from a label. */
export interface GanttLane {
  label: string;
  /** Total points of the subdivision across the whole epic. */
  totalPoints: number;
}

/** Placed chips in one `(lane × week)` cell. */
export interface GanttCell {
  items: WorkItem[];
  /** Remaining (not-done) points placed in the cell. */
  points: number;
}

/** One member's weekly-capacity breakdown for the selected sprint. */
export interface MemberWeekCapacity {
  member: TeamMember;
  /** Capacity per week index, in points. */
  perWeek: number[];
  total: number;
  /** PTO / on-call / velocity-override call-outs overlapping the sprint. */
  notes: string[];
}

export interface GanttView {
  sprint: Sprint | null;
  weeks: WeekPlan[];
  lanes: GanttLane[];
  /** Cell lookup, keyed by `${laneLabel}::${weekIndex}`. */
  cells: Map<string, GanttCell>;
  members: MemberWeekCapacity[];
  /** Unplaced, not-done items — the backlog "bag". */
  bag: WorkItem[];
  placedCount: number;
}

const cellKey = (label: string, weekIndex: number): string => `${label}::${weekIndex}`;

export function ganttSprintEnd(sprint: Sprint, sprintLengthDays: number): IsoDate {
  if (!Number.isFinite(sprintLengthDays) || sprintLengthDays <= 0) return sprint.endDate;
  const cadenceEnd = addDays(sprint.startDate, Math.max(1, Math.round(sprintLengthDays)) - 1);
  return cadenceEnd < sprint.endDate ? cadenceEnd : sprint.endDate;
}

/** Build the Gantt view for one sprint. */
export function buildGanttView(scope: EpicScope, sprintId: string | null): GanttView {
  const sprint = scope.sprints.find((s) => s.id === sprintId) ?? scope.sprints[0] ?? null;

  const byKey = new Map(scope.workItems.map((w) => [w.key, w]));
  const storyByKey = new Map(scope.stories.map((s) => [s.key, s]));
  const ignoredLabels = new Set(scope.labelConfig.ignoreLabels);
  const laneLabel = (w: WorkItem): string =>
    primaryLabel(w, storyByKey.get(w.storyKey), scope.labelConfig.applyParentLabels, ignoredLabels);
  const ctx = buildCapacityContext({
    members: scope.members,
    pto: scope.pto,
    oncall: scope.oncall,
    velocityOverrides: scope.velocityOverrides,
    oncallMultiplier: scope.defaults.oncallMultiplier,
  });

  // Placements in the selected sprint, indexed into cells and weekly loads.
  const placementsHere = sprint
    ? scope.placements.filter((p) => p.sprintId === sprint.id)
    : [];
  const cells = new Map<string, GanttCell>();
  const placedPointsByWeek = new Map<number, number>();
  const placedKeys = new Set<string>();
  for (const p of placementsHere) {
    const item = byKey.get(p.workItemKey);
    if (!item) continue;
    placedKeys.add(item.key);
    const key = cellKey(laneLabel(item), p.weekIndex);
    const cell = cells.get(key) ?? { items: [], points: 0 };
    cell.items.push(item);
    if (!isDone(item)) {
      cell.points += item.points;
      placedPointsByWeek.set(p.weekIndex, (placedPointsByWeek.get(p.weekIndex) ?? 0) + item.points);
    }
    cells.set(key, cell);
  }

  const weeks = sprint
    ? weeklyPlan({
        startDate: sprint.startDate,
        endDate: ganttSprintEnd(sprint, scope.team.sprintLengthDays),
        workingDays: scope.team.workingDays,
        capacityCtx: ctx,
        placedPointsByWeek,
        yellowLoadFraction: scope.defaults.weekYellowLoadFraction,
      })
    : [];

  // Lanes: distinct labels across the epic, biggest subdivision first.
  const totals = new Map<string, number>();
  for (const w of scope.workItems) {
    const label = laneLabel(w);
    totals.set(label, (totals.get(label) ?? 0) + w.points);
  }
  const lanes: GanttLane[] = [...totals.entries()]
    .map(([label, totalPoints]) => ({ label, totalPoints }))
    .sort((a, b) => b.totalPoints - a.totalPoints || a.label.localeCompare(b.label));

  const members = sprint
    ? scope.members
        .filter((m) => m.active)
        .map((m) => memberWeekCapacity(m, sprint, scope))
    : [];

  // The bag: unplaced (in any sprint), not-done work.
  const allPlaced = new Set(scope.placements.map((p) => p.workItemKey));
  const bag = scope.workItems.filter((w) => !allPlaced.has(w.key) && !isDone(w));

  return { sprint, weeks, lanes, cells, members, bag, placedCount: placedKeys.size };
}

/** Look up a cell (may be empty). */
export function ganttCell(
  view: GanttView,
  laneLabel: string,
  weekIndex: number,
): GanttCell | undefined {
  return view.cells.get(cellKey(laneLabel, weekIndex));
}

/** Per-week capacity for a single member, plus availability call-outs. */
function memberWeekCapacity(
  member: TeamMember,
  sprint: Sprint,
  scope: EpicScope,
): MemberWeekCapacity {
  const sprintEnd = ganttSprintEnd(sprint, scope.team.sprintLengthDays);
  const soloCtx = buildCapacityContext({
    members: [member],
    pto: scope.pto.filter((p) => p.memberId === member.id),
    oncall: scope.oncall.filter((o) => o.memberId === member.id),
    velocityOverrides: scope.velocityOverrides.filter((v) => v.memberId === member.id),
    oncallMultiplier: scope.defaults.oncallMultiplier,
  });
  const weeks = weeklyPlan({
    startDate: sprint.startDate,
    endDate: sprintEnd,
    workingDays: scope.team.workingDays,
    capacityCtx: soloCtx,
    placedPointsByWeek: new Map(),
    yellowLoadFraction: scope.defaults.weekYellowLoadFraction,
  });
  const perWeek = weeks.map((w) => w.capacity);
  const total = Math.round(perWeek.reduce((a, b) => a + b, 0) * 100) / 100;

  const overlaps = (start: IsoDate, end: IsoDate): boolean =>
    start <= sprintEnd && end >= sprint.startDate;
  const notes: string[] = [];
  for (const p of scope.pto) {
    if (p.memberId === member.id && overlaps(p.startDate, p.endDate)) {
      notes.push(`PTO ${p.startDate} → ${p.endDate}${p.note ? ` (${p.note})` : ''}`);
    }
  }
  for (const o of scope.oncall) {
    if (o.memberId === member.id && overlaps(o.startDate, o.endDate)) {
      notes.push(`On-call ${o.startDate} → ${o.endDate}${o.note ? ` (${o.note})` : ''}`);
    }
  }
  for (const v of scope.velocityOverrides) {
    if (v.memberId === member.id && overlaps(v.startDate, v.endDate)) {
      notes.push(`×${v.multiplier} ${v.startDate} → ${v.endDate}${v.note ? ` (${v.note})` : ''}`);
    }
  }

  return { member, perWeek, total, notes };
}
