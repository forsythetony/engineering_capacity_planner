import type {
  Dependency,
  DomainDataset,
  Epic,
  EpicMilestone,
  Importer,
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
  WorkItemStatus,
} from '@ecp/shared';
import type { Setting } from '@ecp/shared';
import {
  addDays,
  CADENCE_DEFAULTS,
  defaultGlobalSettings,
  ENGINE_DEFAULTS,
  getWeekday,
  isWorkingDay,
  SETTING_KEYS,
} from '@ecp/shared';
import {
  buildCapacityContext,
  project,
  sprintByIndex,
  sprintIndexFor,
  weeklyPlan,
} from '@ecp/engine';
import { Rng } from './rng.js';

export interface SyntheticConfig {
  /** Seed for the deterministic generator. Same seed ⇒ identical dataset. */
  seed?: number;
  /** Approximate number of work items to generate. */
  targetWorkItemCount?: number;
  /** Number of user stories to group the work items under. */
  storyCount?: number;
  /**
   * The planning "today" the scenario is built around (stored as the
   * `planning_today` setting so the UI opens on it). Fixed by default so output
   * is fully reproducible.
   */
  today?: IsoDate;
  /**
   * The gating "First QA in stage pass" target date the plan leads up to. When
   * omitted it is *calibrated* to the projected dev-complete date (see
   * {@link CALIBRATED_BUFFER_WORKING_DAYS}) so the default scenario opens in the
   * yellow band rather than at an arbitrary verdict.
   */
  gatingDate?: IsoDate;
}

const DEFAULTS = {
  seed: 1,
  targetWorkItemCount: 50,
  storyCount: 10,
  // Planning as of Sun Jul 12, 2026; the gating day is calibrated from here.
  today: '2026-07-12',
} as const;

/**
 * When the gating date is calibrated (not supplied), place it this many working
 * days *after* the projected dev-complete date. The value sits inside the
 * default green buffer threshold ({@link ENGINE_DEFAULTS.GREEN_MIN_BUFFER_DAYS}),
 * so the epic opens in the **yellow** band: on track, but eating into buffer.
 */
const CALIBRATED_BUFFER_WORKING_DAYS = 2;

/** Number of leading "foundation" work items that many others depend on. */
const FOUNDATION_COUNT = 3;

const EPIC_KEY = 'CKT';

const MEMBER_NAMES = ['Ada', 'Björn', 'Chen', 'Dara', 'Esteban', 'Farah'] as const;

const STORY_TITLES = [
  'Foundations & data model',
  'Cart service API',
  'Payment integration',
  'Checkout UI',
  'Address & shipping',
  'Promotions & discounts',
  'Order confirmation',
  'Observability & metrics',
  'Error handling & retries',
  'Accessibility pass',
  'Performance hardening',
  'Feature flags & rollout',
] as const;

const WORK_VERBS = [
  'Implement',
  'Refactor',
  'Add tests for',
  'Wire up',
  'Design',
  'Fix',
  'Document',
  'Optimize',
] as const;

const WORK_NOUNS = [
  'cart totals endpoint',
  'tax calculation',
  'card tokenization',
  'address validation',
  'promo code parser',
  'idempotency keys',
  'retry backoff',
  'inventory check',
  'shipping estimate',
  'order state machine',
  'confirmation email',
  'audit logging',
  'rate limiter',
  'session cache',
  'webhook receiver',
  'error boundary',
  'loading skeletons',
  'form validation',
  'currency formatting',
  'analytics events',
] as const;

/** Generic Checkout-epic components; each work item carries one as a label. */
const LABELS = [
  'Cart',
  'Payments',
  'Shipping',
  'Promotions',
  'Checkout UI',
  'Order Confirmation',
  'Notifications',
  'Analytics',
  'Accessibility',
  'QA & Launch',
] as const;

/** How many sprints (current + upcoming) the Gantt Planner offers. */
const SPRINT_COUNT = 4;

const POINT_VALUES = [1, 2, 3, 5, 8] as const;
const POINT_WEIGHTS = [2, 3, 3, 2, 1] as const;

const STATUSES: readonly WorkItemStatus[] = ['To Do', 'In Progress', 'In Review', 'Done'];
const STATUS_WEIGHTS = [7, 4, 3, 6] as const;

/**
 * Generate a deterministic ~50-item epic (project plan §7):
 * work items grouped under user stories, varied points / statuses / assignees,
 * and a dependency web with a few high-leverage foundation blockers.
 *
 * The dataset is guaranteed self-consistent (every foreign key resolves) and
 * the dependency graph is a DAG (a blocker always precedes what it blocks).
 */
export function generateSyntheticDataset(config: SyntheticConfig = {}): DomainDataset {
  const seed = config.seed ?? DEFAULTS.seed;
  const targetWorkItemCount = config.targetWorkItemCount ?? DEFAULTS.targetWorkItemCount;
  const storyCount = config.storyCount ?? DEFAULTS.storyCount;
  const today = config.today ?? DEFAULTS.today;
  const rng = new Rng(seed);

  // The sprint anchor is the most recent sprint-start weekday on/before today,
  // so `today` falls inside the current sprint.
  const sprintAnchorDate = mostRecentWeekday(today, CADENCE_DEFAULTS.SPRINT_START_WEEKDAY);

  // --- Team & roster -------------------------------------------------------
  const team: Team = {
    id: 'team-platform',
    name: 'Platform Team',
    sprintLengthDays: CADENCE_DEFAULTS.SPRINT_LENGTH_DAYS,
    sprintStartWeekday: CADENCE_DEFAULTS.SPRINT_START_WEEKDAY,
    sprintAnchorDate,
    workingDays: [...CADENCE_DEFAULTS.WORKING_DAYS],
  };

  const memberCount = 5;
  const members: TeamMember[] = [];
  for (let i = 0; i < memberCount; i++) {
    members.push({
      id: `M${i + 1}`,
      teamId: team.id,
      name: MEMBER_NAMES[i]!,
      baseVelocity: rng.int(8, 14),
      // Make one member inactive to exercise the flag; the rest take work.
      active: i !== memberCount - 1,
      // Synthetic members are purely local (not linked to a Jira account).
      jiraAccountId: null,
      avatarUrl: null,
    });
  }
  const activeMembers = members.filter((m) => m.active);

  // --- Capacity modifiers (PTO, on-call, ramping override) -----------------
  // Anchored within the planning window so they bite before the gating day.
  const pto: Pto[] = [
    {
      id: 'PTO1',
      memberId: activeMembers[0]!.id,
      startDate: addDays(today, 3),
      endDate: addDays(today, 7),
      note: 'Summer holiday',
    },
    {
      id: 'PTO2',
      memberId: activeMembers[1]!.id,
      startDate: addDays(today, 8),
      endDate: addDays(today, 9),
      note: null,
    },
  ];

  const oncall: Oncall[] = [
    {
      id: 'OC1',
      memberId: activeMembers[2]!.id,
      startDate: sprintAnchorDate,
      endDate: addDays(sprintAnchorDate, 13), // the current sprint
      note: 'Primary rotation',
    },
  ];

  // A ramping hire producing half output through the planning window.
  const velocityOverrides: VelocityOverride[] = [
    {
      id: 'VO1',
      memberId: activeMembers[activeMembers.length - 1]!.id,
      startDate: today,
      endDate: addDays(today, 13),
      multiplier: 0.5,
      note: 'Ramping hire',
    },
  ];

  // --- Epic ----------------------------------------------------------------
  const epic: Epic = {
    key: EPIC_KEY,
    title: 'Checkout Revamp',
    teamId: team.id,
  };

  // --- User stories --------------------------------------------------------
  const stories: UserStory[] = [];
  for (let i = 0; i < storyCount; i++) {
    stories.push({
      key: `${EPIC_KEY}-S${i + 1}`,
      epicKey: EPIC_KEY,
      title: STORY_TITLES[i % STORY_TITLES.length]!,
    });
  }

  // --- Work items ----------------------------------------------------------
  // Foundation items live in the first story and are generated first so many
  // later items can depend on them (giving them high downstream leverage).
  const storyAssignment = distributeAcrossStories(targetWorkItemCount, storyCount, rng);
  const workItems: WorkItem[] = [];

  for (let idx = 0; idx < targetWorkItemCount; idx++) {
    const isFoundation = idx < FOUNDATION_COUNT;
    const storyIndex = isFoundation ? 0 : storyAssignment[idx]!;
    const story = stories[storyIndex]!;
    const key = `${EPIC_KEY}-${idx + 1}`;

    const points = isFoundation
      ? rng.pick([5, 8])
      : rng.weighted(POINT_VALUES, POINT_WEIGHTS);

    // Foundation items skew toward being underway/done; others follow the
    // general status mix.
    const status: WorkItemStatus = isFoundation
      ? rng.weighted(['In Progress', 'In Review', 'Done'], [3, 2, 3])
      : rng.weighted(STATUSES, STATUS_WEIGHTS);

    const assigneeId =
      status === 'To Do' && rng.chance(0.15) ? null : rng.pick(activeMembers).id;

    workItems.push({
      key,
      storyKey: story.key,
      title: `${rng.pick(WORK_VERBS)} ${rng.pick(WORK_NOUNS)}`,
      points,
      status,
      assigneeId,
      labels: [rng.pick(LABELS)],
    });
  }

  // --- Dependency web (a DAG; blocker index always < blocked index) --------
  const dependencies = buildDependencies(workItems, rng);

  // --- Milestones ("relevant days"), calibrated to the projection ----------
  // The gating day is placed just after the projected dev-complete date so the
  // default scenario opens in the yellow band (unless a date is supplied).
  const gatingDate =
    config.gatingDate ??
    calibrateGatingDate({
      today,
      team,
      members,
      pto,
      oncall,
      velocityOverrides,
      workItems,
    });

  const milestones: EpicMilestone[] = [
    {
      id: 'MS1',
      epicKey: EPIC_KEY,
      name: 'Feature freeze',
      date: addDays(gatingDate, -5),
      isGating: false,
    },
    {
      id: 'MS2',
      epicKey: EPIC_KEY,
      name: 'First QA in stage pass',
      date: gatingDate,
      isGating: true, // exactly one gating milestone drives the verdict
    },
    {
      id: 'MS3',
      epicKey: EPIC_KEY,
      name: 'Launch',
      date: addDays(gatingDate, 14),
      isGating: false,
    },
  ];

  // --- Sprints (stored entities) and a calibrated set of week placements ---
  const sprints = generateSprints(team, today);
  const placements = seedPlacements({
    sprints,
    team,
    members,
    pto,
    oncall,
    velocityOverrides,
    workItems,
  });

  return {
    teams: [team],
    members,
    velocityOverrides,
    pto,
    oncall,
    epics: [epic],
    milestones,
    stories,
    workItems,
    dependencies,
    sprints,
    placements,
    settings: [...defaultGlobalSettings(), planningTodaySetting(today)],
  };
}

/** The current sprint plus the next few, derived from the team's cadence. */
function generateSprints(team: Team, today: IsoDate): Sprint[] {
  const currentIndex = sprintIndexFor(today, team);
  const sprints: Sprint[] = [];
  for (let i = 0; i < SPRINT_COUNT; i++) {
    const window = sprintByIndex(team, currentIndex + i);
    sprints.push({
      id: `SP${i + 1}`,
      teamId: team.id,
      name: `Sprint ${i + 1}`,
      startDate: window.start,
      endDate: window.end,
    });
  }
  return sprints;
}

/**
 * Seed a plausible starting plan: place a subset of the not-yet-done backlog
 * into the first two sprints' weeks so the board opens populated (with the rest
 * left in the backlog "bag"). Loads are calibrated against each week's computed
 * capacity so the demo shows an over-committed week alongside comfortable ones.
 */
function seedPlacements(inputs: {
  sprints: Sprint[];
  team: Team;
  members: TeamMember[];
  pto: Pto[];
  oncall: Oncall[];
  velocityOverrides: VelocityOverride[];
  workItems: WorkItem[];
}): PlannedPlacement[] {
  const { sprints, team } = inputs;
  if (sprints.length === 0) return [];

  const ctx = buildCapacityContext({
    members: inputs.members,
    pto: inputs.pto,
    oncall: inputs.oncall,
    velocityOverrides: inputs.velocityOverrides,
    oncallMultiplier: ENGINE_DEFAULTS.ONCALL_MULTIPLIER,
  });

  // Target load per slot as a fraction of that week's capacity. The first week
  // is intentionally over-committed (red); the rest sit comfortably (green).
  const slotTargets: Array<{ sprintIdx: number; weekIndex: number; loadFraction: number }> = [
    { sprintIdx: 0, weekIndex: 0, loadFraction: 1.15 },
    { sprintIdx: 0, weekIndex: 1, loadFraction: 0.55 },
    { sprintIdx: 1, weekIndex: 0, loadFraction: 0.8 },
    { sprintIdx: 1, weekIndex: 1, loadFraction: 0.45 },
  ];

  const candidates = inputs.workItems.filter((w) => w.status !== 'Done');
  const placements: PlannedPlacement[] = [];
  let cursor = 0;
  let ppId = 0;

  for (const slot of slotTargets) {
    const sprint = sprints[slot.sprintIdx];
    if (!sprint) continue;
    const weeks = weeklyPlan({
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      workingDays: team.workingDays,
      capacityCtx: ctx,
      placedPointsByWeek: new Map(),
    });
    const capacity = weeks[slot.weekIndex]?.capacity ?? 0;
    const target = capacity * slot.loadFraction;

    let placed = 0;
    while (cursor < candidates.length && placed < target) {
      const item = candidates[cursor]!;
      placements.push({
        id: `PP${++ppId}`,
        workItemKey: item.key,
        sprintId: sprint.id,
        weekIndex: slot.weekIndex,
      });
      placed += item.points;
      cursor++;
    }
  }

  return placements;
}

/**
 * Pick a gating date that makes the default projection land in the yellow band:
 * run the pure engine on the generated backlog to find the projected
 * dev-complete date, then step forward {@link CALIBRATED_BUFFER_WORKING_DAYS}
 * working days. That leaves a small positive buffer — below the green
 * threshold, so "on track, but tight". Falls back to a fixed offset if the work
 * is unreachable within the projection horizon.
 */
function calibrateGatingDate(inputs: {
  today: IsoDate;
  team: Team;
  members: TeamMember[];
  pto: Pto[];
  oncall: Oncall[];
  velocityOverrides: VelocityOverride[];
  workItems: WorkItem[];
}): IsoDate {
  const projected = project({
    ...inputs,
    // Placeholder: the gating date does not affect the projected date itself.
    gatingDate: inputs.today,
    config: { oncallMultiplier: ENGINE_DEFAULTS.ONCALL_MULTIPLIER },
  }).projectedDevCompleteDate;

  if (projected === null) return addDays(inputs.today, 28);

  let date = projected;
  for (let added = 0; added < CALIBRATED_BUFFER_WORKING_DAYS; ) {
    date = addDays(date, 1);
    if (isWorkingDay(date, inputs.team.workingDays)) added++;
  }
  return date;
}

/** The most recent date on/before `date` that falls on `weekday`. */
function mostRecentWeekday(date: IsoDate, weekday: number): IsoDate {
  let d = date;
  for (let i = 0; i < 7; i++) {
    if (getWeekday(d) === weekday) return d;
    d = addDays(d, -1);
  }
  return date; // unreachable: any 7-day window contains every weekday
}

/** The `planning_today` setting the UI opens its projection on. */
function planningTodaySetting(today: IsoDate): Setting {
  return {
    key: SETTING_KEYS.PLANNING_TODAY,
    scope: 'global',
    scopeId: null,
    value: JSON.stringify(today),
  };
}

/**
 * Split `total` work items across `storyCount` stories. Story 0 reserves the
 * foundation items; the remainder is distributed with some random variation so
 * story sizes differ. Returns the story index for each work-item index.
 */
function distributeAcrossStories(total: number, storyCount: number, rng: Rng): number[] {
  const assignment: number[] = [];
  for (let i = 0; i < FOUNDATION_COUNT; i++) assignment.push(0);
  for (let i = FOUNDATION_COUNT; i < total; i++) {
    assignment.push(rng.int(0, storyCount - 1));
  }
  return assignment;
}

/**
 * Build the dependency edges. Each non-foundation item may be blocked by a
 * foundation item and/or an earlier ordinary item, ensuring acyclicity and a
 * handful of high-leverage blockers.
 */
function buildDependencies(workItems: readonly WorkItem[], rng: Rng): Dependency[] {
  const deps: Dependency[] = [];
  const seen = new Set<string>();
  let depId = 0;

  const add = (blockerIdx: number, blockedIdx: number): void => {
    if (blockerIdx >= blockedIdx) return; // keep it a DAG
    const blocker = workItems[blockerIdx]!.key;
    const blocked = workItems[blockedIdx]!.key;
    const edge = `${blocker}->${blocked}`;
    if (seen.has(edge)) return;
    seen.add(edge);
    deps.push({ id: `D${++depId}`, blockerItemKey: blocker, blockedItemKey: blocked });
  };

  for (let i = FOUNDATION_COUNT; i < workItems.length; i++) {
    // ~55% of items are gated on a foundation item.
    if (rng.chance(0.55)) {
      add(rng.int(0, FOUNDATION_COUNT - 1), i);
    }
    // ~25% also depend on some earlier ordinary item, creating chains.
    if (i > FOUNDATION_COUNT + 1 && rng.chance(0.25)) {
      add(rng.int(FOUNDATION_COUNT, i - 1), i);
    }
  }

  return deps;
}

/** The synthetic {@link Importer} implementation (project plan §7). */
export class SyntheticImporter implements Importer {
  readonly name = 'synthetic';

  constructor(private readonly config: SyntheticConfig = {}) {}

  async fetch(): Promise<DomainDataset> {
    return generateSyntheticDataset(this.config);
  }
}
