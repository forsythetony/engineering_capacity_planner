/**
 * Seed a **real Jira instance** with the synthetic dataset — the "push test data
 * into Jira" half of the Phase 7 round-trip (project plan §7). This is the
 * remote counterpart to `seed:local`.
 *
 * It creates an epic, its stories, the work items (with story points, labels,
 * assignees, statuses), and the "blocks" links, so you can then point the app at
 * that epic and hit **Sync** to exercise the first-load path end-to-end against
 * a live server.
 *
 * Usage:
 *   # Against real Jira — reads JIRA_* connection + mapping from .env / env:
 *   npm run seed:jira -w @ecp/backend
 *   npm run seed:jira -w @ecp/backend -- --items 60 --no-assignee
 *
 *   # Headless demo against the in-memory fake (no network, no credentials):
 *   npm run seed:jira -w @ecp/backend -- --fake
 *
 * Notes for live Jira:
 * - Assignees need real accountIds; the synthetic ids won't resolve, so pass
 *   `--no-assignee` (or map members to real accounts first).
 * - Sprints are read from your board on Sync; this script does not create them.
 */
import { loadConfig, loadDotenv } from '../config.js';
import { generateSyntheticDataset } from '../importer/synthetic.js';
import { FakeJiraClient } from '../jira/fake-client.js';
import { HttpJiraClient } from '../jira/http-client.js';
import { type JiraMapping, resolveMapping } from '../jira/mapping.js';
import { pushDatasetToJira } from '../jira/push.js';
import type { JiraClient } from '../jira/client.js';

function parseArgs(argv: string[]) {
  const args = { seed: 1, items: 50, includeAssignee: true, fake: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--items') args.items = Number(argv[++i]);
    else if (a === '--no-assignee') args.includeAssignee = false;
    else if (a === '--fake') args.fake = true;
  }
  return args;
}

const FAKE_MAPPING: JiraMapping = {
  projectKey: 'CKT',
  epicKey: null,
  boardId: 1,
  storyPointsField: 'customfield_10016',
  sprintField: 'customfield_10020',
  labelsField: 'labels',
  blocksLinkType: 'Blocks',
  teamName: 'CKT (Jira)',
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadDotenv();
  const config = loadConfig();

  const dataset = generateSyntheticDataset({ seed: args.seed, targetWorkItemCount: args.items });

  let client: JiraClient;
  let mapping: JiraMapping;
  if (args.fake) {
    client = new FakeJiraClient();
    mapping = FAKE_MAPPING;
  } else {
    const { baseUrl, email, apiToken } = config.jira;
    const missing = [
      ['JIRA_BASE_URL', baseUrl],
      ['JIRA_EMAIL', email],
      ['JIRA_API_TOKEN', apiToken],
    ].filter(([, v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(`Jira connection incomplete — set: ${missing.join(', ')} (or run with --fake).`);
    }
    client = new HttpJiraClient({ baseUrl: baseUrl!, email: email!, apiToken: apiToken! });
    mapping = resolveMapping([], config.jira);
  }

  const target = args.fake ? 'the in-memory fake' : mapping.projectKey;
  console.log(`\nSeeding Jira (${target}) from synthetic dataset (seed=${args.seed})…\n`);

  const result = await pushDatasetToJira(client, dataset, mapping, {
    includeAssignee: args.includeAssignee,
  });

  console.log(`  Epic:         ${result.epicKey}`);
  console.log(`  Stories:      ${result.storyCount}`);
  console.log(`  Work items:   ${result.workItemCount}`);
  console.log(`  Blocks links: ${result.linkCount}`);
  console.log('\nNext:');
  console.log('  1. Set ECP_DATA_SOURCE=jira and the JIRA_* mapping in .env');
  console.log(`  2. Set the epic to import: JIRA_EPIC_KEY=${result.epicKey} (or map it in the UI)`);
  console.log('  3. npm run dev, then hit Sync in the Configuration tab.\n');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
