import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { FakeJiraClient } from '../src/jira/fake-client.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

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
      parent: { key: story.key }, customfield_10016: 5, labels: ['Cart'],
    },
  });
  return jira;
}

async function jiraServer(jira: FakeJiraClient): Promise<FastifyInstance> {
  const server = await buildServer(
    { dbPath: ':memory:', dataSource: 'jira', seedIfEmpty: false },
    { jiraClient: jira },
  );
  await server.inject({
    method: 'PATCH',
    url: '/api/settings',
    payload: { jira_project_key: 'CKT', jira_epic_key: 'CKT-1' },
  });
  return server;
}

describe('GET /api/jira/sample', () => {
  it('returns the field catalog, link types, and a sample work item', async () => {
    app = await jiraServer(await seedFakeBoard());
    const res = await app.inject({ method: 'GET', url: '/api/jira/sample' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Catalog resolves the story-points custom field name.
    const sp = body.catalog.find((c: any) => c.id === 'customfield_10016');
    expect(sp).toMatchObject({ name: 'Story Points', custom: true });

    // The sample is a work item (grandchild of the epic) carrying the value.
    expect(body.sampleKey).toBe('CKT-3');
    expect(body.fields.customfield_10016).toBe(5);
    expect(body.fields.labels).toEqual(['Cart']);

    // Link types include Blocks, for the "blocks" mapping.
    expect(body.linkTypes.some((t: any) => t.name === 'Blocks')).toBe(true);
  });

  it('accepts a project/epic query override', async () => {
    app = await jiraServer(await seedFakeBoard());
    const res = await app.inject({ method: 'GET', url: '/api/jira/sample?project=CKT&epic=CKT-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().sampleKey).toBe('CKT-3');
  });

  it('400s when no project key is available', async () => {
    // Jira source + fake client, but no project setting and no query.
    app = await buildServer(
      { dbPath: ':memory:', dataSource: 'jira', seedIfEmpty: false },
      { jiraClient: await seedFakeBoard() },
    );
    const res = await app.inject({ method: 'GET', url: '/api/jira/sample' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/project key/i);
  });
});

describe('Jira setup wizard endpoints', () => {
  it('GET /api/jira/connection reports the authenticated user', async () => {
    app = await jiraServer(await seedFakeBoard());
    const res = await app.inject({ method: 'GET', url: '/api/jira/connection' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ connected: true, displayName: 'Demo User' });
  });

  it('GET /api/jira/boards lists boards and filters by name', async () => {
    app = await jiraServer(await seedFakeBoard());
    const all = await app.inject({ method: 'GET', url: '/api/jira/boards' });
    expect(all.statusCode).toBe(200);
    expect(all.json().boards).toEqual([
      { id: 1, name: 'Board', type: 'scrum', projectKey: 'CKT' },
    ]);
    // A non-matching filter yields nothing.
    const none = await app.inject({ method: 'GET', url: '/api/jira/boards?q=zzz' });
    expect(none.json().boards).toEqual([]);
  });

  it('GET /api/jira/epics returns epics under the project, filtered by text', async () => {
    app = await jiraServer(await seedFakeBoard());
    const res = await app.inject({ method: 'GET', url: '/api/jira/epics?project=CKT' });
    expect(res.statusCode).toBe(200);
    expect(res.json().epics).toEqual([{ key: 'CKT-1', summary: 'Checkout Revamp' }]);
    // Filter by summary text.
    const hit = await app.inject({ method: 'GET', url: '/api/jira/epics?project=CKT&q=checkout' });
    expect(hit.json().epics).toHaveLength(1);
    const miss = await app.inject({ method: 'GET', url: '/api/jira/epics?project=CKT&q=nope' });
    expect(miss.json().epics).toEqual([]);
  });

  it('GET /api/jira/users searches the people picker', async () => {
    // A board whose issue carries an assignee, plus an extra directory user.
    const jira = new FakeJiraClient({
      users: [{ accountId: 'acc-grace', displayName: 'Grace Hopper', emailAddress: 'grace@example.com' }],
    });
    await jira.createIssue({
      fields: {
        project: { key: 'CKT' }, issuetype: { name: 'Story' }, summary: 'Task',
        assignee: { accountId: 'acc-ada', displayName: 'Ada Lovelace' },
      },
    });
    app = await jiraServer(jira);

    const all = await app.inject({ method: 'GET', url: '/api/jira/users' });
    expect(all.statusCode).toBe(200);
    const names = all.json().users.map((u: any) => u.displayName).sort();
    expect(names).toEqual(['Ada Lovelace', 'Grace Hopper']);

    const filtered = await app.inject({ method: 'GET', url: '/api/jira/users?q=grace' });
    expect(filtered.json().users).toEqual([
      { accountId: 'acc-grace', displayName: 'Grace Hopper', email: 'grace@example.com' },
    ]);
  });
});
