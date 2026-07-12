import type { Importer } from '@ecp/shared';
import type { AppConfig } from '../config.js';
import { JiraImporter } from './jira.js';
import { SyntheticImporter } from './synthetic.js';

/**
 * Build the importer selected by config (`ECP_DATA_SOURCE`). This is the single
 * place the app decides where data comes from; swapping synthetic ↔ Jira is a
 * config change, not a code change (project plan §7).
 */
export function createImporter(config: AppConfig): Importer {
  switch (config.dataSource) {
    case 'synthetic':
      return new SyntheticImporter({ seed: config.syntheticSeed });
    case 'jira':
      return new JiraImporter(config.jira);
  }
}
