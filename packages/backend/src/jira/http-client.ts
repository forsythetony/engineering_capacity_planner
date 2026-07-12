import type { JiraClient } from './client.js';
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

/** Connection details for a real Jira Cloud site. Secrets live in env only. */
export interface JiraConnection {
  /** e.g. `https://your-org.atlassian.net` (no trailing slash required). */
  baseUrl: string;
  email: string;
  /** API token — HTTP Basic password half. Never persisted to the DB. */
  apiToken: string;
}

/**
 * Real Jira Cloud client over `fetch`, targeting the current REST v3 platform
 * API and Agile 1.0 API. Authenticates with HTTP Basic (`email:apiToken`).
 *
 * Not exercised in CI (no live Jira in the build sandbox); the
 * {@link import('./fake-client.js').FakeJiraClient} mirrors these exact request
 * and response shapes so the mapper and round-trip logic are proven headless,
 * and this client drops in unchanged when pointed at a real site.
 */
export class HttpJiraClient implements JiraClient {
  private readonly base: string;
  private readonly authHeader: string;

  constructor(conn: JiraConnection) {
    this.base = conn.baseUrl.replace(/\/+$/, '');
    this.authHeader =
      'Basic ' + Buffer.from(`${conn.email}:${conn.apiToken}`, 'utf8').toString('base64');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Jira ${method} ${path} → ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
    }
    // 204 No Content (e.g. createIssueLink) has an empty body.
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  listFields(): Promise<JiraField[]> {
    return this.request<JiraField[]>('GET', '/rest/api/3/field');
  }

  listIssueLinkTypes(): Promise<JiraIssueLinkType[]> {
    return this.request<{ issueLinkTypes: JiraIssueLinkType[] }>(
      'GET',
      '/rest/api/3/issueLinkType',
    ).then((r) => r.issueLinkTypes ?? []);
  }

  searchJql(input: {
    jql: string;
    fields: string[];
    maxResults?: number;
    nextPageToken?: string;
  }): Promise<JiraSearchResult> {
    return this.request<JiraSearchResult>('POST', '/rest/api/3/search/jql', {
      jql: input.jql,
      fields: input.fields,
      maxResults: input.maxResults ?? 100,
      ...(input.nextPageToken ? { nextPageToken: input.nextPageToken } : {}),
    });
  }

  getIssue(idOrKey: string, fields?: string[]): Promise<JiraIssue> {
    return this.request<JiraIssue>('GET', `/rest/api/3/issue/${encodeURIComponent(idOrKey)}`, undefined, {
      fields: fields && fields.length > 0 ? fields.join(',') : '*all',
    });
  }

  listBoards(projectKeyOrId?: string): Promise<JiraBoard[]> {
    return this.request<{ values: JiraBoard[] }>('GET', '/rest/agile/1.0/board', undefined, {
      projectKeyOrId,
    }).then((r) => r.values ?? []);
  }

  listSprints(boardId: number): Promise<JiraSprint[]> {
    return this.request<{ values: JiraSprint[] }>(
      'GET',
      `/rest/agile/1.0/board/${boardId}/sprint`,
    ).then((r) => r.values ?? []);
  }

  createIssue(input: JiraCreateIssueInput): Promise<JiraCreatedIssue> {
    return this.request<JiraCreatedIssue>('POST', '/rest/api/3/issue', input);
  }

  async createIssueLink(input: JiraCreateLinkInput): Promise<void> {
    await this.request<void>('POST', '/rest/api/3/issueLink', {
      type: { name: input.type },
      inwardIssue: { key: input.inwardKey },
      outwardIssue: { key: input.outwardKey },
    });
  }

  async setStatus(issueKey: string, statusName: string): Promise<void> {
    const path = `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`;
    const { transitions } = await this.request<{
      transitions: Array<{ id: string; name: string; to?: { name: string } }>;
    }>('GET', path);
    const match = transitions.find((t) => t.to?.name === statusName || t.name === statusName);
    if (!match) return; // best-effort: workflow has no path to this status
    await this.request<void>('POST', path, { transition: { id: match.id } });
  }
}
