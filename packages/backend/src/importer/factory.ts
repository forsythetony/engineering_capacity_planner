import type { Importer, Setting } from '@ecp/shared';
import type { AppConfig, JiraConfig } from '../config.js';
import type { JiraClient } from '../jira/client.js';
import { HttpJiraClient } from '../jira/http-client.js';
import { resolveMapping } from '../jira/mapping.js';
import { JiraImporter } from './jira.js';
import { SyntheticImporter } from './synthetic.js';

/** Jira *connection* env vars (secrets). Mapping lives in settings, not here. */
const REQUIRED_CONNECTION: Array<{ key: keyof JiraConfig; env: string }> = [
  { key: 'baseUrl', env: 'JIRA_BASE_URL' },
  { key: 'email', env: 'JIRA_EMAIL' },
  { key: 'apiToken', env: 'JIRA_API_TOKEN' },
];

/**
 * Build the importer selected by config (`ECP_DATA_SOURCE`). This is the single
 * place the app decides where data comes from; swapping synthetic ↔ Jira is a
 * config change, not a code change (project plan §7).
 *
 * Connection secrets come from the environment ({@link JiraConfig}); the field
 * *mapping* comes from persisted {@link Setting}s (the Configuration tab's live
 * field picker), falling back to env for a fresh, unconfigured database.
 *
 * `clientOverride` injects a {@link JiraClient} (e.g. the in-memory fake) for
 * tests and the round-trip harness, bypassing the HTTP client and its
 * connection-secret requirement.
 */
export function createImporter(
  config: AppConfig,
  settings: Setting[] = [],
  clientOverride?: JiraClient,
): Importer {
  switch (config.dataSource) {
    case 'synthetic':
      return new SyntheticImporter({ seed: config.syntheticSeed });
    case 'jira': {
      const client = clientOverride ?? buildHttpClient(config.jira);
      return new JiraImporter(client, resolveMapping(settings, config.jira));
    }
  }
}

function buildHttpClient(jira: JiraConfig): HttpJiraClient {
  const missing = REQUIRED_CONNECTION.filter(({ key }) => jira[key] == null).map(({ env }) => env);
  if (missing.length > 0) {
    throw new Error(`Jira connection incomplete — set: ${missing.join(', ')}`);
  }
  return new HttpJiraClient({ baseUrl: jira.baseUrl!, email: jira.email!, apiToken: jira.apiToken! });
}
