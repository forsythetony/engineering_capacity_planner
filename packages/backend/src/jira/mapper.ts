import type {
  Dependency,
  DomainDataset,
  Epic,
  PlannedPlacement,
  Sprint,
  TeamMember,
  UserStory,
  WorkItem,
  WorkItemStatus,
} from '@ecp/shared';
import { CADENCE_DEFAULTS, addDays, defaultGlobalSettings, diffDays, formatIso } from '@ecp/shared';
import type { JiraMapping } from './mapping.js';
import type { JiraIssue, JiraIssueFields, JiraSprint, JiraUser } from './types.js';

/** Default per-member velocity for imported members (points/sprint). */
const DEFAULT_BASE_VELOCITY = 10;

/** Raw pieces the importer gathers from Jira, handed to the pure mapper. */
export interface JiraDatasetInput {
  epicIssue: JiraIssue;
  /** Direct children of the epic (the story layer). */
  storyIssues: JiraIssue[];
  /** Children of the stories (the work-item layer). */
  workIssues: JiraIssue[];
  sprints: JiraSprint[];
  mapping: JiraMapping;
  /** Anchor to fall back to when no sprint supplies a start date. */
  fallbackAnchorDate: string;
  /** Date used to choose a week for active-sprint Jira placements. */
  placementDate?: string;
}

/** Trim a Jira ISO *datetime* down to a calendar `YYYY-MM-DD`. */
function toIsoDate(datetime: string | undefined): string | null {
  if (!datetime) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(datetime);
  return m ? m[1]! : null;
}

function sprintEndForCadence(start: string, end: string): string {
  const cadenceEnd = addDays(start, CADENCE_DEFAULTS.SPRINT_LENGTH_DAYS - 1);
  return cadenceEnd < end ? cadenceEnd : end;
}

/**
 * Map a Jira status onto the domain lifecycle. The status *category* is the
 * stable signal (statuses are renameable per project); "In Review" has no
 * category of its own, so a name match promotes it out of "In Progress".
 */
function mapStatus(fields: JiraIssueFields): WorkItemStatus {
  const status = fields.status;
  const name = status?.name ?? '';
  if (/review/i.test(name)) return 'In Review';
  switch (status?.statusCategory?.key) {
    case 'done':
      return 'Done';
    case 'indeterminate':
      return 'In Progress';
    case 'new':
    default:
      return 'To Do';
  }
}

function pointsOf(fields: JiraIssueFields, mapping: JiraMapping): number {
  const raw = fields[mapping.storyPointsField];
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function labelsOf(fields: JiraIssueFields, mapping: JiraMapping): string[] {
  const raw = fields[mapping.labelsField];
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

const assigneeOf = (fields: JiraIssueFields): JiraUser | null =>
  (fields.assignee as JiraUser | null | undefined) ?? null;

function sprintIdsOf(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const ids: string[] = [];
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) ids.push(String(v));
    else if (typeof v === 'string') {
      const direct = /^\d+$/.exec(v.trim());
      if (direct) ids.push(v.trim());
      const legacy = /(?:^|[,[\s])id=(\d+)(?:,|\]|$)/.exec(v);
      if (legacy) ids.push(legacy[1]!);
    } else if (typeof v === 'object' && v !== null && 'id' in v) {
      const id = (v as { id?: unknown }).id;
      if ((typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && id.trim() !== '')) {
        ids.push(String(id));
      }
    }
  }
  return ids;
}

function sprintStateOf(raw: unknown, sprintId: string): JiraSprint['state'] | null {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  for (const v of values) {
    if (typeof v !== 'object' || v === null) continue;
    const id = (v as { id?: unknown }).id;
    if (String(id) !== sprintId) continue;
    const state = (v as { state?: unknown }).state;
    return state === 'future' || state === 'active' || state === 'closed' ? state : null;
  }
  return null;
}

function weekCount(sprint: Sprint): number {
  return Math.max(1, Math.ceil((diffDays(sprint.startDate, sprint.endDate) + 1) / 7));
}

function weekIndexForSprint(sprint: Sprint, state: JiraSprint['state'] | null, placementDate: string): number {
  const last = weekCount(sprint) - 1;
  if (state === 'future') return 0;
  if (state === 'closed') return last;
  if (placementDate <= sprint.startDate) return 0;
  if (placementDate >= sprint.endDate) return last;
  return Math.min(last, Math.max(0, Math.floor(diffDays(sprint.startDate, placementDate) / 7)));
}

function latestSprintId(ids: string[], sprintsById: ReadonlyMap<string, Sprint>): string | null {
  let latest: Sprint | null = null;
  for (const id of ids) {
    const sprint = sprintsById.get(id);
    if (!sprint) continue;
    if (
      latest === null ||
      sprint.startDate > latest.startDate ||
      (sprint.startDate === latest.startDate && Number(sprint.id) > Number(latest.id))
    ) {
      latest = sprint;
    }
  }
  return latest?.id ?? null;
}

/** Pick a reasonably-sized avatar URL from Jira's size-keyed map, or null. */
export function pickAvatarUrl(user: Pick<JiraUser, 'avatarUrls'> | null | undefined): string | null {
  const urls = user?.avatarUrls;
  if (!urls) return null;
  return urls['48x48'] ?? urls['32x32'] ?? Object.values(urls)[0] ?? null;
}

/**
 * Translate a bundle of raw Jira issues + sprints into a self-consistent
 * {@link DomainDataset} of *facts* (Jira owns these). Local *intent* — PTO,
 * on-call, velocity overrides, and milestones — is left empty here and
 * preserved by the reconcile step, not by the importer. Jira sprint assignments
 * become best-effort suggested Gantt placements; reconcile only applies them to
 * items the user has not already placed manually.
 *
 * Pure and deterministic: no clock, no I/O, so it is exhaustively unit-testable.
 */
export function datasetFromJira(input: JiraDatasetInput): DomainDataset {
  const { epicIssue, storyIssues, workIssues, sprints, mapping } = input;
  const placementDate = input.placementDate ?? formatIso(new Date());

  // --- Sprints (earliest start becomes the team's cadence anchor) ----------
  const teamId = `team-jira-${mapping.projectKey.toLowerCase()}`;
  const domainSprints: Sprint[] = [];
  let earliestStart: string | null = null;
  for (const s of sprints) {
    const start = toIsoDate(s.startDate);
    const rawEnd = toIsoDate(s.endDate);
    const end = start && rawEnd ? sprintEndForCadence(start, rawEnd) : rawEnd;
    if (!start || !end) continue; // sprints without dates can't drive week columns
    if (earliestStart === null || start < earliestStart) earliestStart = start;
    domainSprints.push({ id: String(s.id), teamId, name: s.name, startDate: start, endDate: end });
  }
  domainSprints.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const domainSprintById = new Map(domainSprints.map((s) => [s.id, s]));
  const rawSprintStateById = new Map(sprints.map((s) => [String(s.id), s.state]));

  const team = {
    id: teamId,
    name: mapping.teamName,
    sprintLengthDays: CADENCE_DEFAULTS.SPRINT_LENGTH_DAYS,
    sprintStartWeekday: CADENCE_DEFAULTS.SPRINT_START_WEEKDAY,
    sprintAnchorDate: earliestStart ?? input.fallbackAnchorDate,
    workingDays: [...CADENCE_DEFAULTS.WORKING_DAYS],
  };

  // --- Epic & stories ------------------------------------------------------
  const epic: Epic = {
    key: epicIssue.key,
    title: epicIssue.fields.summary ?? epicIssue.key,
    teamId,
  };

  const stories: UserStory[] = storyIssues.map((s) => ({
    key: s.key,
    epicKey: epic.key,
    title: s.fields.summary ?? s.key,
  }));
  const storyKeys = new Set(stories.map((s) => s.key));

  // A catch-all story keeps the dataset self-consistent if a work item's parent
  // isn't among the fetched stories (e.g. an item hung directly off the epic).
  const UNGROUPED_KEY = `${epic.key}-UNGROUPED`;
  let usedUngrouped = false;

  // --- Work items & members ------------------------------------------------
  const members = new Map<string, TeamMember>();
  const workItems: WorkItem[] = [];
  const placements: PlannedPlacement[] = [];
  const workItemKeys = new Set<string>();

  for (const issue of workIssues) {
    const parentKey = issue.fields.parent?.key ?? null;
    const storyKey = parentKey && storyKeys.has(parentKey) ? parentKey : UNGROUPED_KEY;
    if (storyKey === UNGROUPED_KEY) usedUngrouped = true;

    const assignee = assigneeOf(issue.fields);
    if (assignee) {
      members.set(assignee.accountId, {
        id: assignee.accountId,
        teamId,
        name: assignee.displayName,
        baseVelocity: DEFAULT_BASE_VELOCITY,
        active: assignee.active ?? true,
        jiraAccountId: assignee.accountId,
        avatarUrl: pickAvatarUrl(assignee),
      });
    }

    workItems.push({
      key: issue.key,
      storyKey,
      title: issue.fields.summary ?? issue.key,
      points: pointsOf(issue.fields, mapping),
      status: mapStatus(issue.fields),
      assigneeId: assignee?.accountId ?? null,
      labels: labelsOf(issue.fields, mapping),
    });
    workItemKeys.add(issue.key);

    if (mapping.sprintField && mapStatus(issue.fields) !== 'Done') {
      const rawSprint = issue.fields[mapping.sprintField];
      const sprintId = latestSprintId(sprintIdsOf(rawSprint), domainSprintById);
      const sprint = sprintId ? domainSprintById.get(sprintId) : null;
      if (sprint && sprintId) {
        placements.push({
          id: `jira-${issue.key}-sprint`,
          workItemKey: issue.key,
          sprintId,
          weekIndex: weekIndexForSprint(
            sprint,
            sprintStateOf(rawSprint, sprintId) ?? rawSprintStateById.get(sprintId) ?? null,
            placementDate,
          ),
        });
      }
    }
  }

  if (usedUngrouped) {
    stories.push({ key: UNGROUPED_KEY, epicKey: epic.key, title: 'Ungrouped' });
  }

  // --- Dependencies from "blocks" issue links ------------------------------
  const seen = new Set<string>();
  const dependencies: Dependency[] = [];
  const addEdge = (blocker: string, blocked: string) => {
    if (blocker === blocked) return;
    if (!workItemKeys.has(blocker) || !workItemKeys.has(blocked)) return;
    const id = `${blocker}__${blocked}`;
    if (seen.has(id)) return;
    seen.add(id);
    dependencies.push({ id, blockerItemKey: blocker, blockedItemKey: blocked });
  };
  for (const issue of workIssues) {
    for (const link of issue.fields.issuelinks ?? []) {
      if (link.type.name !== mapping.blocksLinkType) continue;
      // Outward end ("blocks"): this issue blocks the outward issue.
      if (link.outwardIssue) addEdge(issue.key, link.outwardIssue.key);
      // Inward end ("is blocked by"): the inward issue blocks this one.
      if (link.inwardIssue) addEdge(link.inwardIssue.key, issue.key);
    }
  }

  return {
    teams: [team],
    members: [...members.values()],
    velocityOverrides: [],
    pto: [],
    oncall: [],
    epics: [epic],
    milestones: [],
    stories,
    workItems,
    dependencies,
    sprints: domainSprints,
    placements,
    settings: defaultGlobalSettings(),
  };
}
