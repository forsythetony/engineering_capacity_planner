/**
 * Raw Jira Cloud REST API shapes (the subset we read/write), as of the current
 * (2025–2026) platform + Agile APIs. These mirror the wire format exactly so the
 * {@link import('./http-client.js').HttpJiraClient} and the in-memory
 * {@link import('./fake-client.js').FakeJiraClient} are interchangeable, and the
 * mapper ({@link import('./mapper.js')}) is the single place that translates
 * these into the domain model.
 *
 * References (verified current):
 * - Search: `POST /rest/api/3/search/jql` — cursor pagination via
 *   `nextPageToken`; the old `/rest/api/3/search` returns 410 Gone.
 * - Fields: `GET /rest/api/3/field`.
 * - Issues attach to their parent (epic/story) via the standard `parent` field;
 *   the "Epic Link" custom field is deprecated.
 * - Sprints: `GET /rest/agile/1.0/board/{boardId}/sprint`.
 */

/** A field descriptor from `GET /rest/api/3/field`. */
export interface JiraField {
  /** Canonical id used in issue `fields`, e.g. `"customfield_10016"` or `"summary"`. */
  id: string;
  key?: string;
  /** Human-readable name, e.g. `"Story Points"`. */
  name: string;
  custom: boolean;
  schema?: { type: string; items?: string; custom?: string };
}

/** A Jira status category; the stable signal for lifecycle mapping. */
export interface JiraStatusCategory {
  /** `"new"` | `"indeterminate"` | `"done"`. */
  key: string;
  name: string;
}

export interface JiraStatus {
  name: string;
  statusCategory: JiraStatusCategory;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  active?: boolean;
}

export interface JiraIssueRef {
  key: string;
}

/** One entry of an issue's `issuelinks` field. */
export interface JiraIssueLink {
  id?: string;
  type: { id?: string; name: string; inward: string; outward: string };
  /** Present when this issue is the *outward* end of the link. */
  outwardIssue?: JiraIssueRef;
  /** Present when this issue is the *inward* end of the link. */
  inwardIssue?: JiraIssueRef;
}

/**
 * An issue as returned by search/get. `fields` is intentionally open — story
 * points and the sprint live in instance-specific custom fields resolved via
 * the mapping, so we can't type them statically.
 */
export interface JiraIssue {
  id: string;
  key: string;
  fields: JiraIssueFields;
}

export interface JiraIssueFields {
  summary?: string;
  status?: JiraStatus;
  labels?: string[];
  assignee?: JiraUser | null;
  parent?: JiraIssueRef | null;
  issuetype?: { name: string; subtask?: boolean };
  issuelinks?: JiraIssueLink[];
  /** Custom fields (story points, sprint, …) keyed by `customfield_*`. */
  [customField: string]: unknown;
}

/** Response of `POST /rest/api/3/search/jql` (cursor-paginated). */
export interface JiraSearchResult {
  issues: JiraIssue[];
  /** Present when more pages remain; feed back as `nextPageToken`. */
  nextPageToken?: string;
  isLast?: boolean;
}

export interface JiraIssueLinkType {
  id: string;
  name: string;
  inward: string;
  outward: string;
}

export interface JiraBoard {
  id: number;
  name: string;
  type: string;
}

/** A sprint from `GET /rest/agile/1.0/board/{boardId}/sprint`. */
export interface JiraSprint {
  id: number;
  name: string;
  state: 'future' | 'active' | 'closed';
  /** ISO-8601 *datetime* (e.g. `2026-04-11T15:22:00.000+10:00`); may be absent. */
  startDate?: string;
  endDate?: string;
  originBoardId?: number;
  goal?: string;
}

/** Input to `POST /rest/api/3/issue`. */
export interface JiraCreateIssueInput {
  fields: Record<string, unknown>;
}

/** Response of `POST /rest/api/3/issue`. */
export interface JiraCreatedIssue {
  id: string;
  key: string;
  self?: string;
}

/** Input to `POST /rest/api/3/issueLink`. */
export interface JiraCreateLinkInput {
  /** Link-type name, e.g. `"Blocks"`. */
  type: string;
  /** The issue on the *inward* ("is blocked by") side. */
  inwardKey: string;
  /** The issue on the *outward* ("blocks") side. */
  outwardKey: string;
}
