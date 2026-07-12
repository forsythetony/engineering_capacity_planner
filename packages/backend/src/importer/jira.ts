import type { DomainDataset, Importer } from '@ecp/shared';
import type { JiraConfig } from '../config.js';

/** Jira config fields that must be present before a real import can run. */
const REQUIRED: Array<{ key: keyof JiraConfig; env: string }> = [
  { key: 'baseUrl', env: 'JIRA_BASE_URL' },
  { key: 'email', env: 'JIRA_EMAIL' },
  { key: 'apiToken', env: 'JIRA_API_TOKEN' },
  { key: 'projectKey', env: 'JIRA_PROJECT_KEY' },
  { key: 'storyPointsField', env: 'JIRA_STORY_POINTS_FIELD' },
  { key: 'blocksLinkType', env: 'JIRA_BLOCKS_LINK_TYPE' },
];

/**
 * Jira data source (project plan §7, Phase 7 — not yet implemented).
 *
 * The seam is real: it implements the same {@link Importer} interface the
 * engine, timeline, and graph already consume, and reads all of its connection
 * and mapping details from {@link JiraConfig} (env-provided). When Phase 7 lands
 * it fills in {@link fetch} using these settings; nothing else changes.
 *
 * Until then it fails fast with a clear, actionable message — first flagging any
 * missing configuration, then noting it isn't implemented.
 */
export class JiraImporter implements Importer {
  readonly name = 'jira';

  constructor(private readonly config: JiraConfig) {}

  /** Config keys still missing, as their environment-variable names. */
  missingConfig(): string[] {
    return REQUIRED.filter(({ key }) => this.config[key] == null).map(({ env }) => env);
  }

  async fetch(): Promise<DomainDataset> {
    const missing = this.missingConfig();
    if (missing.length > 0) {
      throw new Error(`Jira configuration incomplete — set: ${missing.join(', ')}`);
    }
    throw new Error(
      'JiraImporter is configured but not implemented yet (Phase 7). ' +
        'Set ECP_DATA_SOURCE=synthetic to run against synthetic data for now.',
    );
  }
}
