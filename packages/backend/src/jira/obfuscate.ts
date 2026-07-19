/**
 * Anonymize a {@link JiraSyncCache} into a shareable fixture.
 *
 * Preserves structure that other developers need to build against (hierarchy,
 * statuses, points, labels, dependency topology, sprint dates/states) while
 * scrubbing identifying text: summaries, people, emails, avatars, project keys,
 * sprint names/goals, and team display names.
 */
import type { JiraMapping } from './mapping.js';
import type { JiraSyncCache } from './sync-cache.js';
import type { JiraIssue, JiraIssueFields, JiraIssueLink, JiraSprint, JiraUser } from './types.js';

/** Default project key used in obfuscated fixtures. */
export const OBFUSCATED_PROJECT_KEY = 'DEMO';

export interface ObfuscateOptions {
  /** Project key written into remapped issue keys. Default {@link OBFUSCATED_PROJECT_KEY}. */
  projectKey?: string;
  /** Display name for the synthesized team. */
  teamName?: string;
}

/** Shareable, anonymized Jira sync snapshot (same shape as the local cache). */
export interface ObfuscatedJiraFixture extends JiraSyncCache {
  /** Human note so consumers know the file is anonymized. */
  note: string;
}

/**
 * Stable remapper: original issue key → `DEMO-N` (order = epic, stories, work).
 * Also remaps people, sprint ids, and internal issue ids.
 */
class ObfuscationMaps {
  readonly projectKey: string;
  private nextIssue = 1;
  private nextPerson = 1;
  private nextSprint = 1;
  private nextInternalId = 10000;
  private readonly issueKeys = new Map<string, string>();
  private readonly people = new Map<string, JiraUser>();
  private readonly sprintIds = new Map<string, number>();

  constructor(projectKey: string) {
    this.projectKey = projectKey;
  }

  issueKey(original: string): string {
    let mapped = this.issueKeys.get(original);
    if (!mapped) {
      mapped = `${this.projectKey}-${this.nextIssue++}`;
      this.issueKeys.set(original, mapped);
    }
    return mapped;
  }

  person(user: JiraUser | null | undefined): JiraUser | null {
    if (!user?.accountId) return null;
    let mapped = this.people.get(user.accountId);
    if (!mapped) {
      const n = this.nextPerson++;
      mapped = {
        accountId: `acc-${n}`,
        displayName: `Person ${n}`,
        active: user.active ?? true,
      };
      this.people.set(user.accountId, mapped);
    }
    return { ...mapped };
  }

  sprintId(original: number | string): number {
    const key = String(original);
    let mapped = this.sprintIds.get(key);
    if (mapped == null) {
      mapped = this.nextSprint++;
      this.sprintIds.set(key, mapped);
    }
    return mapped;
  }

  internalId(): string {
    return String(this.nextInternalId++);
  }
}

function remapIssueRef(maps: ObfuscationMaps, key: string | undefined): { key: string } | undefined {
  if (!key) return undefined;
  return { key: maps.issueKey(key) };
}

function remapLink(maps: ObfuscationMaps, link: JiraIssueLink): JiraIssueLink {
  return {
    ...(link.id != null ? { id: link.id } : {}),
    type: { ...link.type },
    ...(link.outwardIssue
      ? { outwardIssue: remapIssueRef(maps, link.outwardIssue.key)! }
      : {}),
    ...(link.inwardIssue ? { inwardIssue: remapIssueRef(maps, link.inwardIssue.key)! } : {}),
  };
}

/** Remap sprint custom-field payloads (object, array, or legacy string). */
function remapSprintField(maps: ObfuscationMaps, raw: unknown): unknown {
  if (raw == null) return raw;
  if (Array.isArray(raw)) return raw.map((v) => remapSprintField(maps, v));
  if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw.trim()))) {
    return maps.sprintId(raw);
  }
  if (typeof raw === 'string') {
    // Legacy Greenhopper "id=123,..." blob — remap the id token only.
    return raw.replace(/(^|[,[\s])id=(\d+)(?=,|\]|$)/g, (_m, prefix: string, id: string) => {
      return `${prefix}id=${maps.sprintId(id)}`;
    });
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const out: Record<string, unknown> = { ...obj };
    if (obj.id != null) {
      out.id = maps.sprintId(obj.id as number | string);
      if (typeof obj.name === 'string') out.name = `Sprint ${out.id}`;
    } else if (typeof obj.name === 'string') {
      out.name = 'Sprint';
    }
    if ('goal' in out) delete out.goal;
    return out;
  }
  return raw;
}

function obfuscateFields(
  maps: ObfuscationMaps,
  fields: JiraIssueFields,
  summary: string,
  mapping: JiraMapping,
): JiraIssueFields {
  const out: JiraIssueFields = { ...fields, summary };

  if (fields.assignee) out.assignee = maps.person(fields.assignee);
  else if ('assignee' in fields) out.assignee = null;

  if (fields.parent?.key) out.parent = { key: maps.issueKey(fields.parent.key) };

  if (fields.issuelinks) out.issuelinks = fields.issuelinks.map((l) => remapLink(maps, l));

  // Labels are intentionally preserved — they drive Gantt lanes and are the
  // main structural signal we want collaborators to build against.
  if (Array.isArray(fields.labels)) out.labels = [...fields.labels];
  if (mapping.labelsField !== 'labels' && Array.isArray(fields[mapping.labelsField])) {
    out[mapping.labelsField] = [...(fields[mapping.labelsField] as string[])];
  }

  if (mapping.sprintField && mapping.sprintField in fields) {
    out[mapping.sprintField] = remapSprintField(maps, fields[mapping.sprintField]);
  }

  // Story points and status stay as-is (already non-identifying).
  return out;
}

function obfuscateIssue(
  maps: ObfuscationMaps,
  issue: JiraIssue,
  summary: string,
  mapping: JiraMapping,
): JiraIssue {
  return {
    id: maps.internalId(),
    key: maps.issueKey(issue.key),
    fields: obfuscateFields(maps, issue.fields, summary, mapping),
  };
}

function obfuscateSprint(maps: ObfuscationMaps, sprint: JiraSprint, index: number): JiraSprint {
  const id = maps.sprintId(sprint.id);
  return {
    id,
    name: `Sprint ${index + 1}`,
    state: sprint.state,
    ...(sprint.startDate ? { startDate: sprint.startDate } : {}),
    ...(sprint.endDate ? { endDate: sprint.endDate } : {}),
    ...(sprint.originBoardId != null ? { originBoardId: 1 } : {}),
  };
}

function obfuscateMapping(maps: ObfuscationMaps, mapping: JiraMapping, teamName: string): JiraMapping {
  return {
    ...mapping,
    projectKey: maps.projectKey,
    epicKey: mapping.epicKey ? maps.issueKey(mapping.epicKey) : null,
    boardId: mapping.boardId == null ? null : 1,
    teamName,
  };
}

/**
 * Produce an anonymized fixture from a local sync cache. Deterministic for a
 * given input order (epic → stories → work items → sprints).
 */
export function obfuscateSyncCache(
  cache: JiraSyncCache,
  options: ObfuscateOptions = {},
): ObfuscatedJiraFixture {
  const projectKey = options.projectKey ?? OBFUSCATED_PROJECT_KEY;
  const teamName = options.teamName ?? 'Demo Team';
  const maps = new ObfuscationMaps(projectKey);

  // Pre-register keys in hierarchy order so DEMO-1 is always the epic.
  maps.issueKey(cache.epicIssue.key);
  for (const s of cache.storyIssues) maps.issueKey(s.key);
  for (const w of cache.workIssues) maps.issueKey(w.key);

  const epicIssue = obfuscateIssue(maps, cache.epicIssue, 'Epic 1', cache.mapping);
  const storyIssues = cache.storyIssues.map((s, i) =>
    obfuscateIssue(maps, s, `Story ${i + 1}`, cache.mapping),
  );
  const workIssues = cache.workIssues.map((w, i) =>
    obfuscateIssue(maps, w, `Work item ${i + 1}`, cache.mapping),
  );
  const sprints = cache.sprints.map((s, i) => obfuscateSprint(maps, s, i));
  const mapping = obfuscateMapping(maps, cache.mapping, teamName);

  return {
    version: cache.version,
    cachedAt: cache.cachedAt,
    note:
      'Obfuscated Jira sync fixture — labels, statuses, points, and topology preserved; ' +
      'summaries, people, and project identifiers anonymized. Safe to commit.',
    mapping,
    epicIssue,
    storyIssues,
    workIssues,
    sprints,
  };
}
