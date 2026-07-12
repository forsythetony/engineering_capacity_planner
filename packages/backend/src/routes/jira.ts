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

export function registerJiraRoutes(
  app: FastifyInstance,
  db: Db,
  config: AppConfig,
  jiraClient?: JiraClient,
): void {
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
