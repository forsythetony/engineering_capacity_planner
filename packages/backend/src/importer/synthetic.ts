import type {
  Dependency,
  DomainDataset,
  Epic,
  EpicMilestone,
  Importer,
  IsoDate,
  Oncall,
  Pto,
  Team,
  TeamMember,
  UserStory,
  VelocityOverride,
  WorkItem,
  WorkItemStatus,
} from '@ecp/shared';
import { addDays, CADENCE_DEFAULTS, defaultGlobalSettings } from '@ecp/shared';
import { Rng } from './rng.js';

export interface SyntheticConfig {
  /** Seed for the deterministic generator. Same seed ⇒ identical dataset. */
  seed?: number;
  /** Approximate number of work items to generate. */
  targetWorkItemCount?: number;
  /** Number of user stories to group the work items under. */
  storyCount?: number;
  /**
   * Reference date the epic timeline is anchored to. Also used as the team's
   * sprint anchor (a Tuesday). Fixed by default so output is fully
   * reproducible.
   */
  referenceDate?: IsoDate;
}

const DEFAULTS = {
  seed: 1,
  targetWorkItemCount: 50,
  storyCount: 10,
  // 2026-01-06 is a Tuesday — matches the default sprint start weekday.
  referenceDate: '2026-01-06',
} as const;

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
  const referenceDate = config.referenceDate ?? DEFAULTS.referenceDate;
  const rng = new Rng(seed);

  // --- Team & roster -------------------------------------------------------
  const team: Team = {
    id: 'team-platform',
    name: 'Platform Team',
    sprintLengthDays: CADENCE_DEFAULTS.SPRINT_LENGTH_DAYS,
    sprintStartWeekday: CADENCE_DEFAULTS.SPRINT_START_WEEKDAY,
    sprintAnchorDate: referenceDate,
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
    });
  }
  const activeMembers = members.filter((m) => m.active);

  // --- Capacity modifiers (PTO, on-call, ramping override) -----------------
  const pto: Pto[] = [
    {
      id: 'PTO1',
      memberId: activeMembers[0]!.id,
      startDate: addDays(referenceDate, 10),
      endDate: addDays(referenceDate, 14),
    },
    {
      id: 'PTO2',
      memberId: activeMembers[1]!.id,
      startDate: addDays(referenceDate, 24),
      endDate: addDays(referenceDate, 25),
    },
  ];

  const oncall: Oncall[] = [
    {
      id: 'OC1',
      memberId: activeMembers[2]!.id,
      startDate: referenceDate,
      endDate: addDays(referenceDate, 13),
    },
  ];

  // A ramping hire producing half output for their first three weeks.
  const velocityOverrides: VelocityOverride[] = [
    {
      id: 'VO1',
      memberId: activeMembers[activeMembers.length - 1]!.id,
      startDate: referenceDate,
      endDate: addDays(referenceDate, 20),
      multiplier: 0.5,
    },
  ];

  // --- Epic & milestones ("relevant days") --------------------------------
  const epic: Epic = {
    key: EPIC_KEY,
    title: 'Checkout Revamp',
    teamId: team.id,
  };

  const milestones: EpicMilestone[] = [
    {
      id: 'MS1',
      epicKey: EPIC_KEY,
      name: 'Feature freeze',
      date: addDays(referenceDate, 40),
      isGating: false,
    },
    {
      id: 'MS2',
      epicKey: EPIC_KEY,
      name: 'First QA in stage pass',
      date: addDays(referenceDate, 55),
      isGating: true, // exactly one gating milestone drives the verdict
    },
    {
      id: 'MS3',
      epicKey: EPIC_KEY,
      name: 'Launch',
      date: addDays(referenceDate, 75),
      isGating: false,
    },
  ];

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
    });
  }

  // --- Dependency web (a DAG; blocker index always < blocked index) --------
  const dependencies = buildDependencies(workItems, rng);

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
    settings: defaultGlobalSettings(),
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
