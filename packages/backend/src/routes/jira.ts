/**
 * Jira introspection endpoint (project plan §7). Powers the Configuration tab's
 * live field mapper: it fetches the field catalog, the issue-link types, and a
 * real sample issue from the target board so the user can *point at* the field
 * that holds story points / the sprint / labels rather than typing an opaque
 * `customfield_*` id. The app records the canonical id and uses it thereafter.
 */
import type { Setting } from '@ecp/shared';
import { SETTING_KEYS } from '@ecp/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/database.js';
import { readDataset } from '../db/persist.js';
import { HttpError } from '../http-error.js';
import { buildJiraClient } from '../importer/factory.js';
import type { JiraClient } from '../jira/client.js';
import { pickAvatarUrl } from '../jira/mapper.js';

/** Read a global string setting (JSON-decoded), or null. */
function settingStr(settings: Setting[], key: string): string | null {
  const row = settings.find((s) => s.scope === 'global' && s.key === key);
  if (!row) return null;
  try {
    const v = JSON.parse(row.value);
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Choose an issue to show as the mapping sample. Prefer a work item under the
 * epic (that's where story points carry a value); fall back to any project
 * issue.
 */
async function pickSample(
  client: JiraClient,
  projectKey: string,
  epicKey: string | null,
): Promise<string | null> {
  // Fall back to the project's first epic when none is pinned, so we can still
  // drill to a work item (that's where story points carry a value).
  let epic = epicKey;
  if (!epic) {
    const epics = await client.searchJql({
      jql: `project = "${projectKey}" AND issuetype = Epic ORDER BY created ASC`,
      fields: ['summary'],
      maxResults: 1,
    });
    epic = epics.issues[0]?.key ?? null;
  }
  if (epic) {
    const stories = await client.searchJql({ jql: `parent = "${epic}"`, fields: ['summary'], maxResults: 1 });
    const story = stories.issues[0]?.key;
    if (story) {
      const work = await client.searchJql({ jql: `parent = "${story}"`, fields: ['summary'], maxResults: 1 });
      if (work.issues[0]) return work.issues[0].key;
      return story;
    }
    return epic;
  }
  const any = await client.searchJql({
    jql: `project = "${projectKey}" ORDER BY created DESC`,
    fields: ['summary'],
    maxResults: 1,
  });
  return any.issues[0]?.key ?? null;
}

export interface JiraSampleResponse {
  projectKey: string;
  sampleKey: string | null;
  /** The sample issue's full fields, for the field picker. */
  fields: Record<string, unknown> | null;
  /** Field catalog: canonical id → human name + value type. */
  catalog: Array<{ id: string; name: string; custom: boolean; type: string | null }>;
  linkTypes: Array<{ id: string; name: string; inward: string; outward: string }>;
}

/** Case-insensitive substring match, tolerant of an empty query (matches all). */
function matches(haystack: string, q: string | undefined): boolean {
  const needle = (q ?? '').trim().toLowerCase();
  return needle === '' || haystack.toLowerCase().includes(needle);
}

export function registerJiraRoutes(
  app: FastifyInstance,
  db: Db,
  config: AppConfig,
  jiraClient?: JiraClient,
): void {
  /** Build the client or throw a 400 the wizard can render. */
  const client = (): JiraClient => {
    try {
      return buildJiraClient(config.jira, jiraClient);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
  };

  /** Resolve the project key from the query, persisted settings, or env. */
  const resolveProject = (query?: string): string | null => {
    const settings = readDataset(db).settings;
    return (
      query?.trim() ||
      settingStr(settings, SETTING_KEYS.JIRA_PROJECT_KEY) ||
      config.jira.projectKey ||
      null
    );
  };

  // --- Connection status (setup wizard "Connect" step) ---------------------
  // Reports whether the configured credentials actually reach Jira, plus who
  // we're authenticated as. Never returns the token.
  app.get('/api/jira/connection', async () => {
    let c: JiraClient;
    try {
      c = buildJiraClient(config.jira, jiraClient);
    } catch (err) {
      return {
        connected: false,
        baseUrl: config.jira.baseUrl,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    try {
      const me = await c.getCurrentUser();
      return {
        connected: true,
        baseUrl: config.jira.baseUrl,
        displayName: me.displayName,
        email: me.emailAddress ?? config.jira.email,
        accountId: me.accountId,
      };
    } catch (err) {
      return {
        connected: false,
        baseUrl: config.jira.baseUrl,
        error: `Jira request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });

  // --- Board typeahead -----------------------------------------------------
  app.get('/api/jira/boards', async (req) => {
    const q = (req.query ?? {}) as { q?: string };
    try {
      const boards = await client().listBoards();
      return {
        boards: boards
          .filter((b) => matches(b.name, q.q))
          .slice(0, 25)
          .map((b) => ({ id: b.id, name: b.name, type: b.type, projectKey: b.location?.projectKey ?? null })),
      };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Jira request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // --- Epic typeahead (scoped to the selected/persisted project) -----------
  app.get('/api/jira/epics', async (req) => {
    const q = (req.query ?? {}) as { q?: string; project?: string };
    const projectKey = resolveProject(q.project);
    if (!projectKey) throw new HttpError(400, 'Select a board or set a project key first.');
    try {
      // The narrow fake JQL dialect has no `~`, so fetch epics and filter here;
      // real Jira returns a bounded set per project too.
      const res = await client().searchJql({
        jql: `project = "${projectKey}" AND issuetype = Epic ORDER BY created DESC`,
        fields: ['summary'],
        maxResults: 100,
      });
      const epics = res.issues
        .map((i) => ({ key: i.key, summary: (i.fields.summary as string | undefined) ?? i.key }))
        .filter((e) => matches(e.key, q.q) || matches(e.summary, q.q))
        .slice(0, 25);
      return { projectKey, epics };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Jira request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // --- People-picker (member search + link) --------------------------------
  app.get('/api/jira/users', async (req) => {
    const q = (req.query ?? {}) as { q?: string };
    try {
      const users = await client().searchUsers((q.q ?? '').trim());
      return {
        users: users.slice(0, 20).map((u) => ({
          accountId: u.accountId,
          displayName: u.displayName,
          email: u.emailAddress ?? null,
          avatarUrl: pickAvatarUrl(u),
        })),
      };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Jira request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  app.get('/api/jira/sample', async (req): Promise<JiraSampleResponse> => {
    const q = (req.query ?? {}) as { project?: string; epic?: string };
    const settings = readDataset(db).settings;
    const projectKey =
      q.project?.trim() || settingStr(settings, SETTING_KEYS.JIRA_PROJECT_KEY) || config.jira.projectKey;
    if (!projectKey) {
      throw new HttpError(400, 'Set a Jira project key to load a sample.');
    }
    const epicKey = q.epic?.trim() || settingStr(settings, SETTING_KEYS.JIRA_EPIC_KEY);

    let client: JiraClient;
    try {
      client = buildJiraClient(config.jira, jiraClient);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }

    try {
      const [catalog, linkTypes] = await Promise.all([
        client.listFields(),
        client.listIssueLinkTypes(),
      ]);
      const sampleKey = await pickSample(client, projectKey, epicKey);
      const fields = sampleKey ? (await client.getIssue(sampleKey, ['*all'])).fields : null;
      return {
        projectKey,
        sampleKey,
        fields: fields as Record<string, unknown> | null,
        catalog: catalog.map((c) => ({ id: c.id, name: c.name, custom: c.custom, type: c.schema?.type ?? null })),
        linkTypes: linkTypes.map((t) => ({ id: t.id, name: t.name, inward: t.inward, outward: t.outward })),
      };
    } catch (err) {
      throw new HttpError(502, `Jira request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
