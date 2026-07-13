import { describe, expect, it } from 'vitest';
import { datasetFromJira, type JiraDatasetInput } from '../src/jira/mapper.js';
import type { JiraMapping } from '../src/jira/mapping.js';
import type { JiraIssue, JiraSprint } from '../src/jira/types.js';

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

function issue(key: string, fields: JiraIssue['fields']): JiraIssue {
  return { id: key, key, fields };
}

function baseInput(overrides: Partial<JiraDatasetInput> = {}): JiraDatasetInput {
  return {
    epicIssue: issue('CKT-1', { summary: 'Checkout Revamp' }),
    storyIssues: [issue('CKT-2', { summary: 'Cart service', parent: { key: 'CKT-1' } })],
    workIssues: [],
    sprints: [],
    mapping,
    fallbackAnchorDate: '2026-01-06',
    ...overrides,
  };
}

describe('datasetFromJira', () => {
  it('maps the epic, stories, and work items with points/labels', () => {
    const ds = datasetFromJira(
      baseInput({
        workIssues: [
          issue('CKT-3', {
            summary: 'Cart totals endpoint',
            parent: { key: 'CKT-2' },
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
            labels: ['Cart'],
            assignee: { accountId: 'acc-1', displayName: 'Ada' },
            customfield_10016: 5,
          }),
        ],
      }),
    );

    expect(ds.epics).toEqual([{ key: 'CKT-1', title: 'Checkout Revamp', teamId: 'team-jira-ckt' }]);
    expect(ds.stories.map((s) => s.key)).toContain('CKT-2');
    expect(ds.workItems).toHaveLength(1);
    const wi = ds.workItems[0]!;
    expect(wi).toMatchObject({
      key: 'CKT-3',
      storyKey: 'CKT-2',
      points: 5,
      status: 'In Progress',
      assigneeId: 'acc-1',
      labels: ['Cart'],
    });
    expect(ds.members).toEqual([
      { id: 'acc-1', teamId: 'team-jira-ckt', name: 'Ada', baseVelocity: 10, active: true, jiraAccountId: 'acc-1', avatarUrl: null },
    ]);
  });

  it('maps statuses by category, promoting "In Review" by name', () => {
    const cat = (key: string, name: string) => ({ status: { name, statusCategory: { key, name } } });
    const ds = datasetFromJira(
      baseInput({
        workIssues: [
          issue('CKT-3', { parent: { key: 'CKT-2' }, ...cat('new', 'Backlog') }),
          issue('CKT-4', { parent: { key: 'CKT-2' }, ...cat('done', 'Closed') }),
          issue('CKT-5', {
            parent: { key: 'CKT-2' },
            status: { name: 'Code Review', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
          }),
        ],
      }),
    );
    const byKey = Object.fromEntries(ds.workItems.map((w) => [w.key, w.status]));
    expect(byKey).toEqual({ 'CKT-3': 'To Do', 'CKT-4': 'Done', 'CKT-5': 'In Review' });
  });

  it('derives dependencies from "blocks" links (both link directions, deduped)', () => {
    const ds = datasetFromJira(
      baseInput({
        workIssues: [
          issue('CKT-3', {
            parent: { key: 'CKT-2' },
            issuelinks: [
              { type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, outwardIssue: { key: 'CKT-4' } },
            ],
          }),
          issue('CKT-4', {
            parent: { key: 'CKT-2' },
            issuelinks: [
              { type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'CKT-3' } },
              { type: { name: 'Relates', inward: 'relates to', outward: 'relates to' }, outwardIssue: { key: 'CKT-3' } },
            ],
          }),
        ],
      }),
    );
    // CKT-3 blocks CKT-4, seen from both endpoints → exactly one edge; Relates ignored.
    expect(ds.dependencies).toEqual([
      { id: 'CKT-3__CKT-4', blockerItemKey: 'CKT-3', blockedItemKey: 'CKT-4' },
    ]);
  });

  it('maps sprints and anchors the team to the earliest sprint start', () => {
    const sprints: JiraSprint[] = [
      { id: 22, name: 'Sprint 2', state: 'future', startDate: '2026-02-10T09:00:00.000+00:00', endDate: '2026-02-24T09:00:00.000+00:00' },
      { id: 21, name: 'Sprint 1', state: 'active', startDate: '2026-01-27T09:00:00.000+00:00', endDate: '2026-02-10T09:00:00.000+00:00' },
    ];
    const ds = datasetFromJira(baseInput({ sprints }));
    expect(ds.sprints.map((s) => [s.id, s.startDate, s.endDate])).toEqual([
      ['21', '2026-01-27', '2026-02-09'],
      ['22', '2026-02-10', '2026-02-23'],
    ]);
    expect(ds.teams[0]!.sprintAnchorDate).toBe('2026-01-27');
  });

  it('suggests placements from Jira sprint fields using sprint state and date', () => {
    const sprints: JiraSprint[] = [
      { id: 21, name: 'Sprint 1', state: 'active', startDate: '2026-01-27T09:00:00.000+00:00', endDate: '2026-02-10T09:00:00.000+00:00' },
      { id: 22, name: 'Sprint 2', state: 'future', startDate: '2026-02-10T09:00:00.000+00:00', endDate: '2026-02-24T09:00:00.000+00:00' },
      { id: 23, name: 'Sprint 0', state: 'closed', startDate: '2026-01-13T09:00:00.000+00:00', endDate: '2026-01-27T09:00:00.000+00:00' },
    ];
    const ds = datasetFromJira(
      baseInput({
        sprints,
        placementDate: '2026-02-04',
        workIssues: [
          issue('CKT-3', { parent: { key: 'CKT-2' }, customfield_10020: [{ id: 21, name: 'Sprint 1', state: 'active' }] }),
          issue('CKT-4', { parent: { key: 'CKT-2' }, customfield_10020: [{ id: 22, name: 'Sprint 2', state: 'future' }] }),
          issue('CKT-5', { parent: { key: 'CKT-2' }, customfield_10020: [{ id: 23, name: 'Sprint 0', state: 'closed' }] }),
          issue('CKT-6', {
            parent: { key: 'CKT-2' },
            status: { name: 'Done', statusCategory: { key: 'done', name: 'Done' } },
            customfield_10020: [{ id: 21, name: 'Sprint 1', state: 'active' }],
          }),
        ],
      }),
    );

    expect(ds.placements).toEqual([
      { id: 'jira-CKT-3-sprint', workItemKey: 'CKT-3', sprintId: '21', weekIndex: 1 },
      { id: 'jira-CKT-4-sprint', workItemKey: 'CKT-4', sprintId: '22', weekIndex: 0 },
      { id: 'jira-CKT-5-sprint', workItemKey: 'CKT-5', sprintId: '23', weekIndex: 1 },
    ]);
  });

  it('chooses the latest matching sprint when a ticket has multiple sprint values', () => {
    const sprints: JiraSprint[] = [
      { id: 21, name: 'Sprint 1', state: 'closed', startDate: '2026-01-27T09:00:00.000+00:00', endDate: '2026-02-10T09:00:00.000+00:00' },
      { id: 54, name: 'Sprint 54', state: 'active', startDate: '2026-07-08T09:00:00.000+00:00', endDate: '2026-07-22T09:00:00.000+00:00' },
    ];
    const ds = datasetFromJira(
      baseInput({
        sprints,
        placementDate: '2026-07-13',
        workIssues: [
          issue('CKT-7', {
            parent: { key: 'CKT-2' },
            customfield_10020: [
              { id: 54, name: 'Sprint 54', state: 'active' },
              { id: 21, name: 'Sprint 1', state: 'closed' },
            ],
          }),
        ],
      }),
    );

    expect(ds.placements).toEqual([
      { id: 'jira-CKT-7-sprint', workItemKey: 'CKT-7', sprintId: '54', weekIndex: 0 },
    ]);
  });

  it('falls back to the provided anchor when no sprint has dates', () => {
    const ds = datasetFromJira(baseInput({ sprints: [], fallbackAnchorDate: '2026-03-03' }));
    expect(ds.teams[0]!.sprintAnchorDate).toBe('2026-03-03');
    expect(ds.sprints).toEqual([]);
  });

  it('groups a work item under a synthetic story when its parent is not a fetched story', () => {
    const ds = datasetFromJira(
      baseInput({ workIssues: [issue('CKT-9', { parent: { key: 'CKT-1' }, customfield_10016: 3 })] }),
    );
    expect(ds.workItems[0]!.storyKey).toBe('CKT-1-UNGROUPED');
    expect(ds.stories.find((s) => s.key === 'CKT-1-UNGROUPED')).toBeTruthy();
  });

  it('leaves local-only intent layers (pto, oncall, milestones) empty', () => {
    const ds = datasetFromJira(baseInput());
    expect(ds.pto).toEqual([]);
    expect(ds.oncall).toEqual([]);
    expect(ds.velocityOverrides).toEqual([]);
    expect(ds.milestones).toEqual([]);
    expect(ds.placements).toEqual([]);
  });
});
