import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { FakeJiraClient } from '../src/jira/fake-client.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Populate a fake Jira board and return the client. */
async function seedFakeBoard(): Promise<FakeJiraClient> {
  const jira = new FakeJiraClient();
  const epic = await jira.createIssue({
    fields: { project: { key: 'CKT' }, issuetype: { name: 'Epic' }, summary: 'Checkout Revamp' },
  });
  const story = await jira.createIssue({
    fields: { project: { key: 'CKT' }, issuetype: { name: 'Story' }, summary: 'Cart', parent: { key: epic.key } },
  });
  await jira.createIssue({
    fields: {
      project: { key: 'CKT' }, issuetype: { name: 'Story' }, summary: 'Totals',
      parent: { key: story.key }, status: 'To Do', customfield_10016: 5,
      assignee: { accountId: 'acc-ada', displayName: 'Ada' },
    },
  });
  jira.setSprints(1, [
    { id: 21, name: 'Sprint 1', state: 'active', startDate: '2026-01-27T09:00:00.000+00:00', endDate: '2026-02-10T09:00:00.000+00:00' },
  ]);
  return jira;
}

/** Build a jira-source server wired to the fake, with the field mapping set. */
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

describe('POST /api/sync', () => {
  it('imports Jira facts into an empty database and reports a summary', async () => {
    const jira = await seedFakeBoard();
    app = await jiraServer(jira);

    const res = await app.inject({ method: 'POST', url: '/api/sync' });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toMatchObject({ epics: 1, stories: 1, workItems: 1, sprints: 1, membersAdded: 1 });

    const data = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    expect(data.epics[0].key).toBe('CKT-1');
    expect(data.workItems).toHaveLength(1);
    expect(data.sprints[0].id).toBe('21');
  });

  it('preserves a Gantt placement across a re-sync', async () => {
    const jira = await seedFakeBoard();
    app = await jiraServer(jira);
    await app.inject({ method: 'POST', url: '/api/sync' });

    // Plan the imported work item into the imported sprint's first week.
    const placed = await app.inject({
      method: 'PUT',
      url: '/api/placements',
      payload: { workItemKey: 'CKT-3', sprintId: '21', weekIndex: 0 },
    });
    expect(placed.statusCode).toBe(200);

    // A second sync (Jira unchanged) must keep the human-authored placement.
    const res = await app.inject({ method: 'POST', url: '/api/sync' });
    expect(res.json().summary.placementsKept).toBe(1);
    const data = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    expect(data.placements).toHaveLength(1);
    expect(data.placements[0]).toMatchObject({ workItemKey: 'CKT-3', sprintId: '21' });
  });

  it('returns 400 when the field mapping is incomplete', async () => {
    const jira = await seedFakeBoard();
    // No settings patched → no story-points field mapped anywhere.
    app = await buildServer(
      { dbPath: ':memory:', dataSource: 'jira', seedIfEmpty: false },
      { jiraClient: jira },
    );
    const res = await app.inject({ method: 'POST', url: '/api/sync' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/mapping incomplete/i);
  });
});
