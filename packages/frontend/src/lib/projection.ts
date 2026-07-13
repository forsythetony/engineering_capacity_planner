import type {
  Dependency,
  DomainDataset,
  Epic,
  EpicMilestone,
  IsoDate,
  Oncall,
  PlannedPlacement,
  Pto,
  Sprint,
  Team,
  TeamMember,
  UserStory,
  VelocityOverride,
  WorkItem,
} from '@ecp/shared';
import { SETTING_KEYS } from '@ecp/shared';
import { project, readEngineConfig, type ProjectionResult } from '@ecp/engine';

/** Everything the timeline needs about a single epic, pulled from the dataset. */
export interface EpicScope {
  epic: Epic;
  team: Team;
  /**
   * The gating "relevant day" that drives the verdict, or `null` when the epic
   * has none yet (e.g. right after a Jira import — Jira has no such concept).
   * The timeline prompts the user to add one; the other tabs work without it.
   */
  gating: EpicMilestone | null;
  /** All of the epic's milestones, ascending by date. */
  milestones: EpicMilestone[];
  /** The epic's user stories (the grouping layer above work items). */
  stories: UserStory[];
  workItems: WorkItem[];
  /** "Blocks" edges whose endpoints are both inside this epic. */
  dependencies: Dependency[];
  members: TeamMember[];
  pto: Pto[];
  oncall: Oncall[];
  velocityOverrides: VelocityOverride[];
  /** The team's stored sprints (Gantt Planner selector), ascending by start. */
  sprints: Sprint[];
  /** Week placements for this epic's work items (Gantt Planner). */
  placements: PlannedPlacement[];
  /** Engine knob defaults read from the dataset's settings. */
  defaults: { greenMinBufferDays: number; oncallMultiplier: number; weekYellowLoadFraction: number };
  /** Epic-scoped label controls for Gantt lanes. */
  labelConfig: { applyParentLabels: boolean; ignoreLabels: string[] };
  /**
   * The "today" to open the projection on, from the `planning_today` setting;
   * `null` for real data, where the UI uses the actual current date.
   */
  planningToday: IsoDate | null;
}

/** The live, user-editable inputs that drive a re-projection. */
export interface Scenario {
  today: IsoDate;
  /** Items removed from the plan ("cut this ticket"). */
  cutItemKeys: ReadonlySet<string>;
  /** Items forced to Done (mark complete). */
  doneItemKeys: ReadonlySet<string>;
  greenMinBufferDays: number;
  oncallMultiplier: number;
}

/** Extract and pre-scope one epic's inputs from the full dataset. */
export function scopeEpic(dataset: DomainDataset, epicKey: string): EpicScope {
  const epic = dataset.epics.find((e) => e.key === epicKey);
  if (!epic) throw new Error(`Epic ${epicKey} not found`);
  const team = dataset.teams.find((t) => t.id === epic.teamId);
  if (!team) throw new Error(`Team ${epic.teamId} not found`);
  const gating = dataset.milestones.find((m) => m.epicKey === epicKey && m.isGating) ?? null;

  const milestones = dataset.milestones
    .filter((m) => m.epicKey === epicKey)
    .sort((a, b) => a.date.localeCompare(b.date));
  const stories = dataset.stories.filter((s) => s.epicKey === epicKey);
  const storyKeys = new Set(stories.map((s) => s.key));
  const workItems = dataset.workItems
    .filter((w) => storyKeys.has(w.storyKey))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  const itemKeys = new Set(workItems.map((w) => w.key));
  const dependencies = dataset.dependencies.filter(
    (d) => itemKeys.has(d.blockerItemKey) && itemKeys.has(d.blockedItemKey),
  );

  const members = dataset.members.filter((m) => m.teamId === team.id);
  const memberIds = new Set(members.map((m) => m.id));
  const pto = dataset.pto.filter((p) => memberIds.has(p.memberId));
  const oncall = dataset.oncall.filter((o) => memberIds.has(o.memberId));
  const velocityOverrides = dataset.velocityOverrides.filter((v) => memberIds.has(v.memberId));

  const sprints = (dataset.sprints ?? [])
    .filter((s) => s.teamId === team.id)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const placements = (dataset.placements ?? []).filter((p) => itemKeys.has(p.workItemKey));

  const cfg = readEngineConfig(dataset);
  return {
    epic,
    team,
    gating,
    milestones,
    stories,
    workItems,
    dependencies,
    members,
    pto,
    oncall,
    velocityOverrides,
    sprints,
    placements,
    defaults: {
      greenMinBufferDays: cfg.greenMinBufferDays ?? 5,
      oncallMultiplier: cfg.oncallMultiplier ?? 0.5,
      weekYellowLoadFraction: cfg.weekYellowLoadFraction ?? 1,
    },
    labelConfig: {
      applyParentLabels: readEpicSetting(dataset, epicKey, SETTING_KEYS.GANTT_APPLY_PARENT_LABELS, false),
      ignoreLabels: readEpicSetting(dataset, epicKey, SETTING_KEYS.GANTT_IGNORE_LABELS, []),
    },
    planningToday: readGlobalString(dataset, SETTING_KEYS.PLANNING_TODAY),
  };
}

/** Read a global string setting (JSON-encoded), or `null` if absent. */
function readGlobalString(dataset: DomainDataset, key: string): string | null {
  const row = dataset.settings.find((s) => s.scope === 'global' && s.key === key);
  if (!row) return null;
  const parsed = JSON.parse(row.value);
  return typeof parsed === 'string' ? parsed : null;
}

/** Read an epic-scoped setting (JSON-encoded), or a fallback if absent/invalid. */
function readEpicSetting<T>(dataset: DomainDataset, epicKey: string, key: string, fallback: T): T {
  const row = dataset.settings.find((s) => s.scope === 'epic' && s.scopeId === epicKey && s.key === key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

/** Apply a scenario's cuts / mark-done to the epic's work items. */
export function effectiveWorkItems(scope: EpicScope, scenario: Scenario): WorkItem[] {
  return scope.workItems
    .filter((w) => !scenario.cutItemKeys.has(w.key))
    .map((w) => (scenario.doneItemKeys.has(w.key) ? { ...w, status: 'Done' } : w));
}

/**
 * Re-run the pure engine for the current scenario. Requires a gating day, so
 * callers must guard on {@link EpicScope.gating} (the timeline shows a prompt
 * to add one when it's absent).
 */
export function runScenario(scope: EpicScope, scenario: Scenario): ProjectionResult {
  if (!scope.gating) throw new Error('runScenario requires a gating milestone');
  return project({
    today: scenario.today,
    team: scope.team,
    members: scope.members,
    pto: scope.pto,
    oncall: scope.oncall,
    velocityOverrides: scope.velocityOverrides,
    workItems: effectiveWorkItems(scope, scenario),
    gatingDate: scope.gating.date,
    config: {
      greenMinBufferDays: scenario.greenMinBufferDays,
      oncallMultiplier: scenario.oncallMultiplier,
    },
  });
}
