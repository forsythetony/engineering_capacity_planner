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
  JiraUser,
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

const AVATAR_COLORS = ['5b8cff', '2fb673', 'e0a63a', 'e05a5a', 'a56bff', '3ec6c6'];

/**
 * A self-contained (no-network) SVG data-URI avatar, so the demo board shows
 * real-looking avatar images offline. Real Jira supplies actual `avatarUrls`;
 * this only fills the gap for the in-memory fake.
 */
function demoAvatarDataUri(seed: string, label: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const color = AVATAR_COLORS[h % AVATAR_COLORS.length];
  const initials = label
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">` +
    `<circle cx="24" cy="24" r="24" fill="#${color}"/>` +
    `<text x="24" y="31" font-family="sans-serif" font-size="20" fill="#fff" text-anchor="middle">${initials}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Give a user demo avatar URLs if they don't already carry any. */
function withDemoAvatar(u: JiraUser): JiraUser {
  if (u.avatarUrls) return u;
  return { ...u, avatarUrls: { '48x48': demoAvatarDataUri(u.accountId, u.displayName) } };
}

/** The authenticated user reported by the fake's `getCurrentUser()`. */
export const DEFAULT_CURRENT_USER: JiraUser = {
  accountId: 'acc-self',
  displayName: 'Demo User',
  emailAddress: 'demo@example.com',
  active: true,
};

export interface FakeJiraOptions {
  fields?: JiraField[];
  linkTypes?: JiraIssueLinkType[];
  boards?: JiraBoard[];
  /** Extra directory users searchable by `searchUsers` (beyond issue assignees). */
  users?: JiraUser[];
  currentUser?: JiraUser;
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
  private readonly directoryUsers: JiraUser[];
  private readonly currentUser: JiraUser;
  private readonly issues = new Map<string, JiraIssue>();
  private readonly sprintsByBoard = new Map<number, JiraSprint[]>();
  private readonly counters = new Map<string, number>();
  private nextId = 10000;

  constructor(options: FakeJiraOptions = {}) {
    this.fields = options.fields ?? DEFAULT_FIELD_CATALOG;
    this.linkTypes = options.linkTypes ?? DEFAULT_LINK_TYPES;
    this.boards = options.boards ?? [
      { id: 1, name: 'Board', type: 'scrum', location: { projectKey: 'CKT' } },
    ];
    this.directoryUsers = options.users ?? [];
    this.currentUser = options.currentUser ?? DEFAULT_CURRENT_USER;
  }

  // --- Test/seed helpers ---------------------------------------------------
  /** Register sprints for a board (as `seed:jira` would create them). */
  setSprints(boardId: number, sprints: JiraSprint[]): void {
    this.sprintsByBoard.set(boardId, sprints);
  }

  /**
   * Insert a fully-formed issue (e.g. from an obfuscated sync fixture) under
   * its existing key/id, without going through `createIssue` numbering.
   */
  seedIssue(issue: JiraIssue): void {
    const clone: JiraIssue = {
      id: issue.id,
      key: issue.key,
      fields: { ...issue.fields, issuelinks: [...(issue.fields.issuelinks ?? [])] },
    };
    const assignee = clone.fields.assignee as JiraUser | null | undefined;
    if (assignee?.accountId) clone.fields.assignee = withDemoAvatar(assignee);
    this.issues.set(clone.key, clone);
    const n = Number(clone.key.slice(clone.key.lastIndexOf('-') + 1));
    if (Number.isFinite(n)) {
      const projectKey = this.projectKeyOf(clone.key);
      this.counters.set(projectKey, Math.max(this.counters.get(projectKey) ?? 0, n));
    }
    const idNum = Number(clone.id);
    if (Number.isFinite(idNum) && idNum >= this.nextId) this.nextId = idNum + 1;
  }

  /** All stored issues (unprojected), for assertions. */
  allIssues(): JiraIssue[] {
    return [...this.issues.values()];
  }

  private projectKeyOf(key: string): string {
    return key.slice(0, key.lastIndexOf('-'));
  }

  // --- Read ----------------------------------------------------------------
  async getCurrentUser(): Promise<JiraUser> {
    return withDemoAvatar({ ...this.currentUser });
  }

  /** Assignees on stored issues + any injected directory users, deduped. */
  private knownUsers(): JiraUser[] {
    const byId = new Map<string, JiraUser>();
    for (const issue of this.issues.values()) {
      const a = issue.fields.assignee as JiraUser | null | undefined;
      if (a?.accountId) byId.set(a.accountId, a);
    }
    for (const u of this.directoryUsers) byId.set(u.accountId, u);
    return [...byId.values()];
  }

  async searchUsers(query: string): Promise<JiraUser[]> {
    const q = query.trim().toLowerCase();
    return this.knownUsers()
      .filter((u) => q === '' || u.displayName.toLowerCase().includes(q))
      .map((u) => withDemoAvatar({ ...u }));
  }

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

  async listBoards(projectKeyOrId?: string, name?: string): Promise<JiraBoard[]> {
    const project = projectKeyOrId?.trim().toLowerCase();
    const q = name?.trim().toLowerCase();
    return this.boards
      .filter((b) => !project || b.location?.projectKey?.toLowerCase() === project)
      .filter((b) => !q || b.name.toLowerCase().includes(q))
      .map((b) => ({ ...b }));
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
    // Give the assignee a demo avatar so synced work items carry one offline.
    const assignee = fields.assignee as JiraUser | null | undefined;
    if (assignee?.accountId) fields.assignee = withDemoAvatar(assignee);

    this.issues.set(key, { id, key, fields });
    return { id, key, self: `https://fake.atlassian.net/rest/api/3/issue/${id}` };
  }

  async setStatus(issueKey: string, statusName: string): Promise<void> {
    const issue = this.issues.get(issueKey);
    if (!issue) throw new Error(`Fake Jira: setStatus on missing issue ${issueKey}`);
    issue.fields.status = statusFor(statusName);
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
