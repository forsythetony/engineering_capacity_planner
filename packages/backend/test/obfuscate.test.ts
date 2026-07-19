import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { JiraImporter } from '../src/importer/jira.js';
import { FakeJiraClient } from '../src/jira/fake-client.js';
import { fakeClientFromFixture, fixtureFromCache } from '../src/jira/load-fixture.js';
import { datasetFromJira } from '../src/jira/mapper.js';
import type { JiraMapping } from '../src/jira/mapping.js';
import { obfuscateSyncCache, type ObfuscatedJiraFixture } from '../src/jira/obfuscate.js';
import { readSyncCache, writeSyncCache, type JiraSyncCache } from '../src/jira/sync-cache.js';

const mapping: JiraMapping = {
  projectKey: 'ACME',
  epicKey: 'ACME-100',
  boardId: 42,
  storyPointsField: 'customfield_10016',
  sprintField: 'customfield_10020',
  labelsField: 'labels',
  blocksLinkType: 'Blocks',
  teamName: 'Payments Platform',
};

function sampleCache(): JiraSyncCache {
  return {
    version: 1,
    cachedAt: '2026-07-18T12:00:00.000Z',
    mapping,
    epicIssue: {
      id: '10001',
      key: 'ACME-100',
      fields: { summary: 'Secret Platform Migration' },
    },
    storyIssues: [
      {
        id: '10002',
        key: 'ACME-101',
        fields: {
          summary: 'Internal auth rewrite',
          parent: { key: 'ACME-100' },
          labels: ['Auth', 'Platform'],
        },
      },
    ],
    workIssues: [
      {
        id: '10003',
        key: 'ACME-102',
        fields: {
          summary: 'Wire Okta to checkout',
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
          labels: ['Auth'],
          assignee: {
            accountId: 'real-account-ada',
            displayName: 'Ada Lovelace',
            emailAddress: 'ada@acme.example',
            avatarUrls: { '48x48': 'https://acme.example/ada.png' },
            active: true,
          },
          parent: { key: 'ACME-101' },
          issuetype: { name: 'Story' },
          customfield_10016: 5,
          customfield_10020: [{ id: 9001, name: 'Q3 Confidential Sprint', state: 'active', goal: 'ship secrets' }],
          issuelinks: [
            {
              type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
              outwardIssue: { key: 'ACME-103' },
            },
          ],
        },
      },
      {
        id: '10004',
        key: 'ACME-103',
        fields: {
          summary: 'Remove legacy SSO',
          status: { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } },
          labels: ['Auth'],
          assignee: {
            accountId: 'real-account-bjorn',
            displayName: 'Björn Ström',
            emailAddress: 'bjorn@acme.example',
            active: true,
          },
          parent: { key: 'ACME-101' },
          issuetype: { name: 'Story' },
          customfield_10016: 3,
          issuelinks: [
            {
              type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
              inwardIssue: { key: 'ACME-102' },
            },
          ],
        },
      },
    ],
    sprints: [
      {
        id: 9001,
        name: 'Q3 Confidential Sprint',
        state: 'active',
        startDate: '2026-07-07T00:00:00.000Z',
        endDate: '2026-07-21T00:00:00.000Z',
        goal: 'Do not leak this',
        originBoardId: 42,
      },
    ],
  };
}

describe('obfuscateSyncCache', () => {
  it('scrubs identifying fields while keeping labels, points, status, and topology', () => {
    const fixture = obfuscateSyncCache(sampleCache());

    expect(fixture.mapping.projectKey).toBe('DEMO');
    expect(fixture.mapping.teamName).toBe('Demo Team');
    expect(fixture.mapping.epicKey).toBe('DEMO-1');
    expect(fixture.epicIssue.fields.summary).toBe('Epic 1');
    expect(fixture.storyIssues[0]?.fields.summary).toBe('Story 1');
    expect(fixture.storyIssues[0]?.fields.labels).toEqual(['Auth', 'Platform']);
    expect(fixture.workIssues.map((w) => w.fields.summary)).toEqual(['Work item 1', 'Work item 2']);
    expect(fixture.workIssues[0]?.fields.labels).toEqual(['Auth']);
    expect(fixture.workIssues[0]?.fields.customfield_10016).toBe(5);
    expect(fixture.workIssues[0]?.fields.status?.name).toBe('In Progress');

    const assignee = fixture.workIssues[0]?.fields.assignee;
    expect(assignee).toMatchObject({ accountId: 'acc-1', displayName: 'Person 1' });
    expect(assignee).not.toHaveProperty('emailAddress');
    expect(assignee).not.toHaveProperty('avatarUrls');

    expect(fixture.sprints[0]).toMatchObject({
      id: 1,
      name: 'Sprint 1',
      state: 'active',
      startDate: '2026-07-07T00:00:00.000Z',
    });
    expect(fixture.sprints[0]).not.toHaveProperty('goal');

    // Dependency edges remapped consistently (epic=1, story=2, work=3/4).
    expect(fixture.workIssues[0]?.key).toBe('DEMO-3');
    expect(fixture.workIssues[1]?.key).toBe('DEMO-4');
    expect(fixture.workIssues[0]?.fields.issuelinks?.[0]?.outwardIssue?.key).toBe('DEMO-4');
    expect(fixture.workIssues[1]?.fields.issuelinks?.[0]?.inwardIssue?.key).toBe('DEMO-3');
  });

  it('round-trips through FakeJiraClient + JiraImporter', async () => {
    const fixture = obfuscateSyncCache(sampleCache());
    const client = fakeClientFromFixture(fixtureFromCache(fixture));
    const ds = await new JiraImporter(client, fixture.mapping).fetch();

    expect(ds.epics[0]?.key).toBe('DEMO-1');
    expect(ds.stories[0]?.labels).toEqual(['Auth', 'Platform']);
    expect(ds.workItems).toHaveLength(2);
    expect(ds.workItems.find((w) => w.key === 'DEMO-3')).toMatchObject({
      points: 5,
      status: 'In Progress',
      labels: ['Auth'],
    });
    expect(ds.dependencies).toEqual([
      { id: 'DEMO-3__DEMO-4', blockerItemKey: 'DEMO-3', blockedItemKey: 'DEMO-4' },
    ]);
    expect(ds.members.map((m) => m.name).sort()).toEqual(['Person 1', 'Person 2']);
  });

  it('maps directly via datasetFromJira without a client', () => {
    const fixture = obfuscateSyncCache(sampleCache());
    const ds = datasetFromJira({
      ...fixtureFromCache(fixture),
      fallbackAnchorDate: '2026-01-06',
      placementDate: '2026-07-10',
    });
    expect(ds.workItems).toHaveLength(2);
    expect(ds.sprints[0]?.name).toBe('Sprint 1');
  });
});

describe('sync cache write/read', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('persists and reloads a cache file', () => {
    dir = mkdtempSync(join(tmpdir(), 'ecp-cache-'));
    const path = join(dir, 'jira-last-sync.json');
    writeSyncCache(path, sampleCache());
    const loaded = readSyncCache(path);
    expect(loaded.epicIssue.key).toBe('ACME-100');
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(1);
  });

  it('writes a cache when JiraImporter is given a cachePath', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ecp-cache-'));
    const path = join(dir, 'jira-last-sync.json');

    const jira = new FakeJiraClient();
    const epic = await jira.createIssue({
      fields: { project: { key: 'CKT' }, issuetype: { name: 'Epic' }, summary: 'Epic' },
    });
    const story = await jira.createIssue({
      fields: {
        project: { key: 'CKT' },
        issuetype: { name: 'Story' },
        summary: 'Story',
        parent: { key: epic.key },
        labels: ['Lane'],
      },
    });
    await jira.createIssue({
      fields: {
        project: { key: 'CKT' },
        issuetype: { name: 'Story' },
        summary: 'Item',
        parent: { key: story.key },
        status: 'To Do',
        labels: ['Lane'],
        customfield_10016: 2,
      },
    });

    const importerMapping: JiraMapping = {
      projectKey: 'CKT',
      epicKey: epic.key,
      boardId: 1,
      storyPointsField: 'customfield_10016',
      sprintField: 'customfield_10020',
      labelsField: 'labels',
      blocksLinkType: 'Blocks',
      teamName: 'CKT',
    };
    await new JiraImporter(jira, importerMapping, { cachePath: path }).fetch();

    const cache = readSyncCache(path);
    expect(cache.storyIssues).toHaveLength(1);
    expect(cache.workIssues).toHaveLength(1);
    expect(cache.workIssues[0]?.fields.labels).toEqual(['Lane']);
  });
});

describe('committed obfuscated-jira.json fixture', () => {
  it('loads through FakeJiraClient and yields a consistent dataset', async () => {
    const fixturePath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../testdata/obfuscated-jira.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as ObfuscatedJiraFixture;
    expect(fixture.note).toMatch(/Safe to commit/);
    expect(fixture.workIssues.length).toBeGreaterThan(0);

    const client = fakeClientFromFixture(fixtureFromCache(fixture));
    const ds = await new JiraImporter(client, fixture.mapping).fetch();
    expect(ds.epics).toHaveLength(1);
    expect(ds.stories.length).toBe(fixture.storyIssues.length);
    expect(ds.workItems.length).toBe(fixture.workIssues.length);
    // At least one real lane label survived anonymization.
    expect(ds.workItems.some((w) => (w.labels?.length ?? 0) > 0)).toBe(true);
  });
});
