import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { generateSyntheticDataset } from '../src/importer/synthetic.js';
import { FakeJiraClient } from '../src/jira/fake-client.js';
import type { JiraMapping } from '../src/jira/mapping.js';
import { pushDatasetToJira } from '../src/jira/push.js';

const MAPPING: JiraMapping = {
  projectKey: 'CKT',
  epicKey: null, // auto-discovered from the pushed Epic
  boardId: 1,
  storyPointsField: 'customfield_10016',
  sprintField: 'customfield_10020',
  labelsField: 'labels',
  blocksLinkType: 'Blocks',
  teamName: 'CKT (Jira)',
};

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Push a synthetic dataset into a fresh fake board; return the client + push result. */
async function seedJiraFromSynthetic(itemCount = 14) {
  const dataset = generateSyntheticDataset({ seed: 3, targetWorkItemCount: itemCount, storyCount: 5 });
  const jira = new FakeJiraClient();
  const push = await pushDatasetToJira(jira, dataset, MAPPING);
  jira.setSprints(1, [
    { id: 21, name: 'Sprint 1', state: 'active', startDate: '2026-01-27T00:00:00.000+00:00', endDate: '2026-02-10T00:00:00.000+00:00' },
    { id: 22, name: 'Sprint 2', state: 'future', startDate: '2026-02-10T00:00:00.000+00:00', endDate: '2026-02-24T00:00:00.000+00:00' },
  ]);
  return { dataset, jira, push };
}

async function jiraServer(jira: FakeJiraClient): Promise<FastifyInstance> {
  const server = await buildServer(
    { dbPath: ':memory:', dataSource: 'jira', seedIfEmpty: false },
    { jiraClient: jira },
  );
  await server.inject({
    method: 'PATCH',
    url: '/api/settings',
    payload: {
      jira_project_key: 'CKT',
      jira_story_points_field: 'customfield_10016',
      jira_blocks_link_type: 'Blocks',
    },
  });
  return server;
}

describe('Jira round-trip: synthetic → push → sync', () => {
  it('reconstructs the dataset faithfully through a real first-load', async () => {
    const { dataset, jira, push } = await seedJiraFromSynthetic();
    app = await jiraServer(jira);

    const sync = await app.inject({ method: 'POST', url: '/api/sync' });
    expect(sync.statusCode).toBe(200);

    const data = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();

    // Structure preserved (counts match what was pushed).
    expect(data.epics).toHaveLength(1);
    expect(data.stories.length).toBe(push.storyCount);
    expect(data.workItems.length).toBe(push.workItemCount);
    expect(data.dependencies.length).toBe(push.linkCount);
    expect(data.sprints).toHaveLength(2);

    // Facts preserved: total points and the presence of a completed item.
    const pushedPoints = dataset.workItems.reduce((s, w) => s + w.points, 0);
    const syncedPoints = data.workItems.reduce((s: number, w: any) => s + w.points, 0);
    expect(syncedPoints).toBe(pushedPoints);
    expect(data.workItems.some((w: any) => w.status === 'Done')).toBe(true);

    // Members were derived from assignees.
    expect(data.members.length).toBeGreaterThan(0);

    // Referential integrity across the reconstructed dataset.
    const storyKeys = new Set(data.stories.map((s: any) => s.key));
    for (const w of data.workItems) expect(storyKeys.has(w.storyKey)).toBe(true);
    const itemKeys = new Set(data.workItems.map((w: any) => w.key));
    for (const d of data.dependencies) {
      expect(itemKeys.has(d.blockerItemKey)).toBe(true);
      expect(itemKeys.has(d.blockedItemKey)).toBe(true);
    }
  });

  it('preserves an open placement but auto-pulls one that completes in Jira', async () => {
    const { jira, push } = await seedJiraFromSynthetic();
    app = await jiraServer(jira);
    await app.inject({ method: 'POST', url: '/api/sync' });

    const data = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    const open = data.workItems.filter((w: any) => w.status !== 'Done');
    expect(open.length).toBeGreaterThanOrEqual(2);
    const [toComplete, toKeep] = open;

    // Plan both open items into sprint 21.
    for (const item of [toComplete, toKeep]) {
      await app.inject({ method: 'PUT', url: '/api/placements', payload: { workItemKey: item.key, sprintId: '21', weekIndex: 0 } });
    }

    // One of them gets completed in Jira; its fake key is the same as its synced key.
    await jira.setStatus(toComplete.key, 'Done');

    const sync = await app.inject({ method: 'POST', url: '/api/sync' });
    expect(sync.json().summary.placementsPulledDone).toBe(1);
    expect(sync.json().summary.placementsKept).toBe(1);

    const after = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    const placedKeys = after.placements.map((p: any) => p.workItemKey);
    expect(placedKeys).toEqual([toKeep.key]);
    // Sanity: the pushed key map covers the completed item.
    expect([...push.keyByOldKey.values()]).toContain(toComplete.key);
  });
});
