import { describe, expect, it } from 'vitest';
import { JiraImporter } from '../src/importer/jira.js';
import { FakeJiraClient } from '../src/jira/fake-client.js';
import type { JiraMapping } from '../src/jira/mapping.js';

const mapping: JiraMapping = {
  projectKey: 'CKT',
  epicKey: 'CKT-1',
  boardId: 1,
  storyPointsField: 'customfield_10016',
  sprintField: 'customfield_10020',
  labelsField: 'labels',
  blocksLinkType: 'Blocks',
  teamName: 'CKT (Jira)',
};

/** Stand up a small board in the fake and return the client. */
async function seedFake(): Promise<FakeJiraClient> {
  const jira = new FakeJiraClient();
  const epic = await jira.createIssue({
    fields: { project: { key: 'CKT' }, issuetype: { name: 'Epic' }, summary: 'Checkout Revamp' },
  });
  const story = await jira.createIssue({
    fields: { project: { key: 'CKT' }, issuetype: { name: 'Story' }, summary: 'Cart service', parent: { key: epic.key } },
  });
  const a = await jira.createIssue({
    fields: {
      project: { key: 'CKT' }, issuetype: { name: 'Story' }, summary: 'Cart totals endpoint',
      parent: { key: story.key }, status: 'In Progress', labels: ['Cart'], customfield_10016: 5,
      assignee: { accountId: 'acc-ada', displayName: 'Ada' },
    },
  });
  const b = await jira.createIssue({
    fields: {
      project: { key: 'CKT' }, issuetype: { name: 'Story' }, summary: 'Tax calculation',
      parent: { key: story.key }, status: 'To Do', labels: ['Cart'], customfield_10016: 3,
      assignee: { accountId: 'acc-bjorn', displayName: 'Björn' },
    },
  });
  // a blocks b.
  await jira.createIssueLink({ type: 'Blocks', outwardKey: a.key, inwardKey: b.key });
  jira.setSprints(1, [
    { id: 21, name: 'Sprint 1', state: 'active', startDate: '2026-01-27T09:00:00.000+00:00', endDate: '2026-02-10T09:00:00.000+00:00' },
  ]);
  return jira;
}

describe('JiraImporter over the fake client', () => {
  it('imports one epic subtree into a self-consistent dataset', async () => {
    const jira = await seedFake();
    const ds = await new JiraImporter(jira, mapping).fetch();

    expect(ds.epics.map((e) => e.key)).toEqual(['CKT-1']);
    expect(ds.stories.map((s) => s.key)).toEqual(['CKT-2']);
    expect(ds.workItems.map((w) => w.key).sort()).toEqual(['CKT-3', 'CKT-4']);
    expect(ds.workItems.find((w) => w.key === 'CKT-3')).toMatchObject({ points: 5, status: 'In Progress', labels: ['Cart'] });
    expect(ds.dependencies).toEqual([
      { id: 'CKT-3__CKT-4', blockerItemKey: 'CKT-3', blockedItemKey: 'CKT-4' },
    ]);
    expect(ds.members.map((m) => m.name).sort()).toEqual(['Ada', 'Björn']);
    expect(ds.sprints).toEqual([
      { id: '21', teamId: 'team-jira-ckt', name: 'Sprint 1', startDate: '2026-01-27', endDate: '2026-02-10' },
    ]);
    // Referential integrity: every work item's story and assignee resolve.
    const storyKeys = new Set(ds.stories.map((s) => s.key));
    const memberIds = new Set(ds.members.map((m) => m.id));
    for (const w of ds.workItems) {
      expect(storyKeys.has(w.storyKey)).toBe(true);
      if (w.assigneeId) expect(memberIds.has(w.assigneeId)).toBe(true);
    }
  });

  it('auto-discovers the epic when none is pinned in the mapping', async () => {
    const jira = await seedFake();
    const ds = await new JiraImporter(jira, { ...mapping, epicKey: null }).fetch();
    expect(ds.epics.map((e) => e.key)).toEqual(['CKT-1']);
  });

  it('paginates search results via nextPageToken', async () => {
    const jira = new FakeJiraClient();
    const epic = await jira.createIssue({ fields: { project: { key: 'BIG' }, issuetype: { name: 'Epic' }, summary: 'Big' } });
    const story = await jira.createIssue({ fields: { project: { key: 'BIG' }, issuetype: { name: 'Story' }, summary: 'S', parent: { key: epic.key } } });
    for (let i = 0; i < 250; i++) {
      await jira.createIssue({
        fields: { project: { key: 'BIG' }, issuetype: { name: 'Story' }, summary: `w${i}`, parent: { key: story.key }, customfield_10016: 1 },
      });
    }
    const ds = await new JiraImporter(jira, { ...mapping, projectKey: 'BIG', epicKey: epic.key }).fetch();
    expect(ds.workItems).toHaveLength(250);
  });
});
