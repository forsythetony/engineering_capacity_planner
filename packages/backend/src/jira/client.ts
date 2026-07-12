import type {
  JiraBoard,
  JiraCreatedIssue,
  JiraCreateIssueInput,
  JiraCreateLinkInput,
  JiraField,
  JiraIssue,
  JiraIssueLinkType,
  JiraSearchResult,
  JiraSprint,
} from './types.js';

/**
 * The Jira integration seam. Every Jira interaction the app performs goes
 * through this interface, so the real HTTP client
 * ({@link import('./http-client.js').HttpJiraClient}) and the in-memory
 * {@link import('./fake-client.js').FakeJiraClient} used by tests and the
 * round-trip harness are drop-in interchangeable.
 *
 * Reads back the current Cloud REST v3 + Agile 1.0 surface (see
 * {@link import('./types.js')} for the wire shapes); writes cover exactly what
 * `seed:jira` needs to stand up a test board.
 */
export interface JiraClient {
  // --- Read (import) -------------------------------------------------------
  /** `GET /rest/api/3/field` — the field catalog that powers mapping. */
  listFields(): Promise<JiraField[]>;
  /** `GET /rest/api/3/issueLinkType` — used to resolve the "blocks" link type. */
  listIssueLinkTypes(): Promise<JiraIssueLinkType[]>;
  /**
   * `POST /rest/api/3/search/jql` — cursor-paginated. Callers pass an explicit
   * `fields` list (required by the endpoint) and follow `nextPageToken` until
   * `isLast`.
   */
  searchJql(input: {
    jql: string;
    fields: string[];
    maxResults?: number;
    nextPageToken?: string;
  }): Promise<JiraSearchResult>;
  /** `GET /rest/api/3/issue/{idOrKey}` — one issue, e.g. the mapping sample. */
  getIssue(idOrKey: string, fields?: string[]): Promise<JiraIssue>;
  /** `GET /rest/agile/1.0/board?projectKeyOrId=…` — boards for a project. */
  listBoards(projectKeyOrId?: string): Promise<JiraBoard[]>;
  /** `GET /rest/agile/1.0/board/{boardId}/sprint` — a board's sprints. */
  listSprints(boardId: number): Promise<JiraSprint[]>;

  // --- Write (seed:jira) ---------------------------------------------------
  /** `POST /rest/api/3/issue`. */
  createIssue(input: JiraCreateIssueInput): Promise<JiraCreatedIssue>;
  /** `POST /rest/api/3/issueLink`. */
  createIssueLink(input: JiraCreateLinkInput): Promise<void>;
  /**
   * Move an issue to a named status via a workflow transition (status can't be
   * set on create in Jira). Best-effort: a no-op if no transition reaches the
   * target status. Used by `seed:jira` to reproduce the dataset's statuses.
   */
  setStatus(issueKey: string, statusName: string): Promise<void>;
}
