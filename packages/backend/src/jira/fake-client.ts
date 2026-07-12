import type { JiraClient } from './client.js';
import type {
  JiraBoard,
  JiraCreatedIssue,
  JiraCreateIssueInput,
  JiraCreateLinkInput,
  JiraField,
  JiraIssue,
  JiraIssueFields,
  JiraIssueLinkType,
  JiraSearchResult,
  JiraSprint,
  JiraStatus,
} from './types.js';

/** A realistic default field catalog (Story Points + Sprint as custom fields). */
export const DEFAULT_FIELD_CATALOG: JiraField[] = [
  { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string' } },
  { id: 'status', name: 'Status', custom: false, schema: { type: 'status' } },
  { id: 'assignee', name: 'Assignee', custom: false, schema: { type: 'user' } },
  { id: 'parent', name: 'Parent', custom: false, schema: { type: 'issuelinks' } },
  { id: 'labels', name: 'Labels', custom: false, schema: { type: 'array', items: 'string' } },
  { id: 'issuetype', name: 'Issue Type', custom: false, schema: { type: 'issuetype' } },
  {
    id: 'customfield_10016',
    name: 'Story Points',
    custom: true,
    schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' },
  },
  {
    id: 'customfield_10020',
    name: 'Sprint',
    custom: true,
    schema: { type: 'array', items: 'json', custom: 'com.pyxis.greenhopper.jira:gh-sprint' },
  },
];

export const DEFAULT_LINK_TYPES: JiraIssueLinkType[] = [
  { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
  { id: '10001', name: 'Relates', inward: 'relates to', outward: 'relates to' },
];

/** Map a status *name* to a plausible Jira status object (with category). */
function statusFor(name: string): JiraStatus {
  const key =
    name === 'Done' ? 'done' : name === 'To Do' || name === '' ? 'new' : 'indeterminate';
  const categoryName = key === 'done' ? 'Done' : key === 'new' ? 'To Do' : 'In Progress';
  return { name: name || 'To Do', statusCategory: { key, name: categoryName } };
}

/** Keep only the requested fields (mirrors the real API's explicit `fields`). */
function project(fields: JiraIssueFields, requested: string[] | undefined): JiraIssueFields {
  if (!requested || requested.length === 0 || requested.includes('*all')) return { ...fields };
  const out: JiraIssueFields = {};
  for (const f of requested) {
    if (f in fields) out[f] = fields[f];
  }
  return out;
}

export interface FakeJiraOptions {
  fields?: JiraField[];
  linkTypes?: JiraIssueLinkType[];
  boards?: JiraBoard[];
}

/**
 * In-memory Jira double implementing the full {@link JiraClient} surface with
 * faithful wire shapes: cursor-paginated `search/jql`, field projection, and the
 * inward/outward reflection of `issuelinks` on both endpoints. Supports the
 * write path too, so `seed:jira` can stand up a board and the importer can read
 * it straight back — the whole round-trip runs headless, no network.
 *
 * The JQL matcher understands only the clauses the importer emits
 * (`project =`, `issuetype = Epic`, `parent =`, `parent in (...)`), which is all
 * this double needs to be exercised end-to-end.
 */
export class FakeJiraClient implements JiraClient {
  private readonly fields: JiraField[];
  private readonly linkTypes: JiraIssueLinkType[];
  private readonly boards: JiraBoard[];
  private readonly issues = new Map<string, JiraIssue>();
  private readonly sprintsByBoard = new Map<number, JiraSprint[]>();
  private readonly counters = new Map<string, number>();
  private nextId = 10000;

  constructor(options: FakeJiraOptions = {}) {
    this.fields = options.fields ?? DEFAULT_FIELD_CATALOG;
    this.linkTypes = options.linkTypes ?? DEFAULT_LINK_TYPES;
    this.boards = options.boards ?? [{ id: 1, name: 'Board', type: 'scrum' }];
  }

  // --- Test/seed helpers ---------------------------------------------------
  /** Register sprints for a board (as `seed:jira` would create them). */
  setSprints(boardId: number, sprints: JiraSprint[]): void {
    this.sprintsByBoard.set(boardId, sprints);
  }

  /** All stored issues (unprojected), for assertions. */
  allIssues(): JiraIssue[] {
    return [...this.issues.values()];
  }

  private projectKeyOf(key: string): string {
    return key.slice(0, key.lastIndexOf('-'));
  }

  // --- Read ----------------------------------------------------------------
  async listFields(): Promise<JiraField[]> {
    return this.fields.map((f) => ({ ...f }));
  }

  async listIssueLinkTypes(): Promise<JiraIssueLinkType[]> {
    return this.linkTypes.map((t) => ({ ...t }));
  }

  async getIssue(idOrKey: string, fields?: string[]): Promise<JiraIssue> {
    const issue = this.issues.get(idOrKey);
    if (!issue) throw new Error(`Fake Jira: issue ${idOrKey} not found`);
    return { id: issue.id, key: issue.key, fields: project(issue.fields, fields) };
  }

  async searchJql(input: {
    jql: string;
    fields: string[];
    maxResults?: number;
    nextPageToken?: string;
  }): Promise<JiraSearchResult> {
    const match = this.compile(input.jql);
    const all = [...this.issues.values()].filter((i) => match(i));
    const maxResults = input.maxResults ?? 100;
    const start = input.nextPageToken ? Number(input.nextPageToken) : 0;
    const slice = all.slice(start, start + maxResults);
    const end = start + slice.length;
    const isLast = end >= all.length;
    return {
      issues: slice.map((i) => ({ id: i.id, key: i.key, fields: project(i.fields, input.fields) })),
      isLast,
      ...(isLast ? {} : { nextPageToken: String(end) }),
    };
  }

  /** Compile the importer's narrow JQL dialect into an issue predicate. */
  private compile(jql: string): (issue: JiraIssue) => boolean {
    const cleaned = jql.replace(/\s+ORDER BY\s+.*$/i, '').trim();
    const clauses = cleaned.split(/\s+AND\s+/i).map((c) => c.trim()).filter(Boolean);
    const preds: Array<(i: JiraIssue) => boolean> = [];
    for (const clause of clauses) {
      const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '');
      let m: RegExpExecArray | null;
      if ((m = /^project\s*=\s*(.+)$/i.exec(clause))) {
        const key = unquote(m[1]!);
        preds.push((i) => this.projectKeyOf(i.key) === key);
      } else if ((m = /^issuetype\s*=\s*(.+)$/i.exec(clause))) {
        const type = unquote(m[1]!);
        preds.push((i) => (i.fields.issuetype?.name ?? '') === type);
      } else if ((m = /^parent\s*=\s*(.+)$/i.exec(clause))) {
        const key = unquote(m[1]!);
        preds.push((i) => i.fields.parent?.key === key);
      } else if ((m = /^parent\s+in\s*\((.+)\)$/i.exec(clause))) {
        const keys = new Set(m[1]!.split(',').map(unquote));
        preds.push((i) => (i.fields.parent ? keys.has(i.fields.parent.key) : false));
      } else {
        throw new Error(`Fake Jira: unsupported JQL clause "${clause}"`);
      }
    }
    return (issue) => preds.every((p) => p(issue));
  }

  async listBoards(projectKeyOrId?: string): Promise<JiraBoard[]> {
    void projectKeyOrId;
    return this.boards.map((b) => ({ ...b }));
  }

  async listSprints(boardId: number): Promise<JiraSprint[]> {
    return (this.sprintsByBoard.get(boardId) ?? []).map((s) => ({ ...s }));
  }

  // --- Write ---------------------------------------------------------------
  async createIssue(input: JiraCreateIssueInput): Promise<JiraCreatedIssue> {
    const f = input.fields;
    const projectKey = (f.project as { key?: string } | undefined)?.key;
    if (!projectKey) throw new Error('Fake Jira: createIssue requires fields.project.key');

    const n = (this.counters.get(projectKey) ?? 0) + 1;
    this.counters.set(projectKey, n);
    const key = `${projectKey}-${n}`;
    const id = String(this.nextId++);

    // Normalize status (accept a name string or a full object) and default the rest.
    const rawStatus = f.status;
    const status =
      typeof rawStatus === 'string'
        ? statusFor(rawStatus)
        : (rawStatus as JiraStatus | undefined) ?? statusFor('To Do');

    const fields: JiraIssueFields = {
      ...f,
      status,
      issuetype: (f.issuetype as { name: string } | undefined) ?? { name: 'Story' },
      labels: Array.isArray(f.labels) ? (f.labels as string[]) : [],
      issuelinks: [],
    };
    delete (fields as Record<string, unknown>).project;

    this.issues.set(key, { id, key, fields });
    return { id, key, self: `https://fake.atlassian.net/rest/api/3/issue/${id}` };
  }

  async createIssueLink(input: JiraCreateLinkInput): Promise<void> {
    const type = this.linkTypes.find((t) => t.name === input.type);
    if (!type) throw new Error(`Fake Jira: unknown link type "${input.type}"`);
    const outward = this.issues.get(input.outwardKey);
    const inward = this.issues.get(input.inwardKey);
    if (!outward || !inward) {
      throw new Error(`Fake Jira: createIssueLink references a missing issue`);
    }
    // Reflect on both endpoints exactly as GET issue would report them:
    // the blocker (outward end) shows `outwardIssue` → the issue it blocks.
    (outward.fields.issuelinks ??= []).push({ type, outwardIssue: { key: inward.key } });
    // the blocked (inward end) shows `inwardIssue` → the issue blocking it.
    (inward.fields.issuelinks ??= []).push({ type, inwardIssue: { key: outward.key } });
  }
}
