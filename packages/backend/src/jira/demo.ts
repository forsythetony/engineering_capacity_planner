import { generateSyntheticDataset } from '../importer/synthetic.js';
import { FakeJiraClient } from './fake-client.js';
import type { JiraMapping } from './mapping.js';
import { pushDatasetToJira } from './push.js';

/** The mapping the demo board is built with (matches the fake's field catalog). */
export const DEMO_MAPPING: JiraMapping = {
  projectKey: 'CKT',
  epicKey: null,
  boardId: 1,
  storyPointsField: 'customfield_10016',
  sprintField: 'customfield_10020',
  labelsField: 'labels',
  blocksLinkType: 'Blocks',
  teamName: 'CKT (Jira)',
};

/**
 * Build an in-memory {@link FakeJiraClient} pre-seeded from the synthetic
 * dataset (demo mode, `ECP_JIRA_FAKE=true`). The whole epic subtree and a few
 * sprints exist "in Jira", so the field mapper and Sync work end-to-end in the
 * real app with no credentials — the same fake the tests use.
 */
export async function createDemoJiraClient(seed = 1): Promise<FakeJiraClient> {
  const dataset = generateSyntheticDataset({ seed, targetWorkItemCount: 40, storyCount: 8 });
  const jira = new FakeJiraClient();
  await pushDatasetToJira(jira, dataset, DEMO_MAPPING);
  // A couple of sprints on the board so the Gantt has week columns.
  jira.setSprints(1, [
    { id: 21, name: 'Sprint 1', state: 'active', startDate: '2026-01-27T00:00:00.000+00:00', endDate: '2026-02-10T00:00:00.000+00:00' },
    { id: 22, name: 'Sprint 2', state: 'future', startDate: '2026-02-10T00:00:00.000+00:00', endDate: '2026-02-24T00:00:00.000+00:00' },
  ]);
  return jira;
}
