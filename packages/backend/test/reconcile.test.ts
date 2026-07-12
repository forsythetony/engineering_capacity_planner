import type { DomainDataset } from '@ecp/shared';
import { describe, expect, it } from 'vitest';
import { reconcileDataset } from '../src/db/reconcile.js';

/** An empty dataset with the fields tests fill in. */
function empty(): DomainDataset {
  return {
    teams: [],
    members: [],
    velocityOverrides: [],
    pto: [],
    oncall: [],
    epics: [],
    milestones: [],
    stories: [],
    workItems: [],
    dependencies: [],
    sprints: [],
    placements: [],
    settings: [],
  };
}

const team = (id: string, anchor: string) => ({
  id,
  name: 'Team',
  sprintLengthDays: 14,
  sprintStartWeekday: 2 as const,
  sprintAnchorDate: anchor,
  workingDays: [1, 2, 3, 4, 5] as const,
});

const member = (id: string, name: string, baseVelocity: number, active = true) => ({
  id,
  teamId: 'T',
  name,
  baseVelocity,
  active,
});

const workItem = (key: string, status: DomainDataset['workItems'][number]['status']) => ({
  key,
  storyKey: 'S1',
  title: key,
  points: 3,
  status,
  assigneeId: null,
  labels: [],
});

const sprint = (id: string) => ({ id, teamId: 'T', name: id, startDate: '2026-01-27', endDate: '2026-02-10' });
const placement = (id: string, workItemKey: string, sprintId: string) => ({
  id,
  workItemKey,
  sprintId,
  weekIndex: 0,
});

describe('reconcileDataset', () => {
  it('takes Jira facts wholesale for an initial (empty) database', () => {
    const incoming: DomainDataset = {
      ...empty(),
      teams: [team('T', '2026-01-27')],
      members: [member('u1', 'Ada', 10)],
      epics: [{ key: 'CKT', title: 'Checkout', teamId: 'T' }],
      stories: [{ key: 'S1', epicKey: 'CKT', title: 'Story' }],
      workItems: [workItem('CKT-1', 'To Do')],
      sprints: [sprint('21')],
    };
    const { merged, summary } = reconcileDataset(empty(), incoming);
    expect(merged.epics).toEqual(incoming.epics);
    expect(merged.workItems).toEqual(incoming.workItems);
    expect(summary.membersAdded).toBe(1);
    expect(summary.workItems).toBe(1);
  });

  it('preserves local intent: PTO, velocity edits, milestones, and settings', () => {
    const current: DomainDataset = {
      ...empty(),
      teams: [team('T', '2026-01-01')],
      members: [member('u1', 'Ada (local name)', 13)], // locally-tuned velocity
      pto: [{ id: 'p1', memberId: 'u1', startDate: '2026-02-02', endDate: '2026-02-06', note: null }],
      milestones: [{ id: 'm1', epicKey: 'CKT', name: 'QA', date: '2026-03-01', isGating: true }],
      epics: [{ key: 'CKT', title: 'Old', teamId: 'T' }],
      settings: [{ key: 'green_min_buffer_days', scope: 'global', scopeId: null, value: '9' }],
    };
    const incoming: DomainDataset = {
      ...empty(),
      teams: [team('T', '2026-01-27')], // anchor refreshed from synced sprints
      members: [member('u1', 'Ada Lovelace', 10)], // Jira name refresh, default velocity
      epics: [{ key: 'CKT', title: 'Checkout Revamp', teamId: 'T' }],
      stories: [{ key: 'S1', epicKey: 'CKT', title: 'Story' }],
      workItems: [workItem('CKT-1', 'To Do')],
      settings: [
        { key: 'green_min_buffer_days', scope: 'global', scopeId: null, value: '5' }, // default; local wins
        { key: 'week_yellow_load_fraction', scope: 'global', scopeId: null, value: '1' }, // new default added
      ],
    };
    const { merged } = reconcileDataset(current, incoming);

    // Member velocity kept local; name refreshed from Jira.
    expect(merged.members[0]).toMatchObject({ id: 'u1', name: 'Ada Lovelace', baseVelocity: 13 });
    // Intent preserved.
    expect(merged.pto).toHaveLength(1);
    expect(merged.milestones).toHaveLength(1);
    // Facts refreshed.
    expect(merged.epics[0]!.title).toBe('Checkout Revamp');
    expect(merged.teams[0]!.sprintAnchorDate).toBe('2026-01-27');
    // Settings: local edit wins, new default added.
    const green = merged.settings.find((s) => s.key === 'green_min_buffer_days');
    expect(green!.value).toBe('9');
    expect(merged.settings.find((s) => s.key === 'week_yellow_load_fraction')).toBeTruthy();
  });

  it('prunes placements: pulls Done items, drops missing item/sprint, keeps the rest', () => {
    const current: DomainDataset = {
      ...empty(),
      teams: [team('T', '2026-01-27')],
      sprints: [sprint('21')],
      workItems: [workItem('CKT-1', 'To Do'), workItem('CKT-2', 'Done'), workItem('CKT-3', 'In Progress'), workItem('CKT-4', 'To Do')],
      placements: [
        placement('pl1', 'CKT-1', '21'), // kept
        placement('pl2', 'CKT-2', '21'), // pulled: now Done
        placement('pl3', 'CKT-3', '99'), // dropped: sprint gone
        placement('pl4', 'CKT-9', '21'), // dropped: item gone
      ],
    };
    const incoming: DomainDataset = {
      ...empty(),
      teams: [team('T', '2026-01-27')],
      sprints: [sprint('21')], // sprint 99 no longer exists
      epics: [{ key: 'CKT', title: 'Checkout', teamId: 'T' }],
      stories: [{ key: 'S1', epicKey: 'CKT', title: 'Story' }],
      workItems: [workItem('CKT-1', 'To Do'), workItem('CKT-2', 'Done'), workItem('CKT-3', 'In Progress')],
    };
    const { merged, summary } = reconcileDataset(current, incoming);

    expect(merged.placements.map((p) => p.id)).toEqual(['pl1']);
    expect(summary).toMatchObject({
      placementsKept: 1,
      placementsPulledDone: 1,
      placementsDroppedMissingSprint: 1,
      placementsDroppedMissingItem: 1,
    });
  });

  it('links a synced assignee onto a hand-created member and remaps assignments', () => {
    const current: DomainDataset = {
      ...empty(),
      teams: [team('T', '2026-01-27')],
      // A member the user set up by hand (own id + velocity) and linked to a
      // Jira account via the setup wizard.
      members: [{ ...member('mem_local', 'Ada (me)', 15), jiraAccountId: 'acc-ada' }],
    };
    const incoming: DomainDataset = {
      ...empty(),
      teams: [team('T', '2026-01-27')],
      // Jira reports the same person, keyed by accountId, with the import default.
      members: [{ ...member('acc-ada', 'Ada Lovelace', 10), jiraAccountId: 'acc-ada' }],
      epics: [{ key: 'CKT', title: 'Checkout', teamId: 'T' }],
      stories: [{ key: 'S1', epicKey: 'CKT', title: 'Story' }],
      workItems: [{ ...workItem('CKT-1', 'To Do'), assigneeId: 'acc-ada' }],
    };
    const { merged, summary } = reconcileDataset(current, incoming);

    // No duplicate: the account folds into the existing local member.
    expect(summary.membersAdded).toBe(0);
    expect(merged.members).toHaveLength(1);
    expect(merged.members[0]).toMatchObject({
      id: 'mem_local',
      name: 'Ada Lovelace', // name refreshed from Jira
      baseVelocity: 15, // local velocity preserved
      jiraAccountId: 'acc-ada',
    });
    // The work item's assignee is rewritten from the accountId to the local id.
    expect(merged.workItems[0]!.assigneeId).toBe('mem_local');
  });

  it('backfills the link on a legacy member whose id is the accountId', () => {
    const current: DomainDataset = {
      ...empty(),
      teams: [team('T', '2026-01-27')],
      // Imported before jiraAccountId existed: id === accountId, link unset.
      members: [member('acc-ada', 'Ada', 12)],
    };
    const incoming: DomainDataset = {
      ...empty(),
      teams: [team('T', '2026-01-27')],
      members: [{ ...member('acc-ada', 'Ada Lovelace', 10), jiraAccountId: 'acc-ada' }],
      epics: [{ key: 'CKT', title: 'Checkout', teamId: 'T' }],
    };
    const { merged, summary } = reconcileDataset(current, incoming);
    expect(summary.membersAdded).toBe(0);
    expect(merged.members[0]).toMatchObject({ id: 'acc-ada', baseVelocity: 12, jiraAccountId: 'acc-ada' });
  });

  it('keeps a local member who has no current Jira assignments', () => {
    const current: DomainDataset = {
      ...empty(),
      teams: [team('T', '2026-01-27')],
      members: [member('u1', 'Ada', 12), member('u2', 'Departed-but-configured', 10)],
    };
    const incoming: DomainDataset = {
      ...empty(),
      teams: [team('T', '2026-01-27')],
      members: [member('u1', 'Ada', 10)], // only u1 has assignments this sync
      epics: [{ key: 'CKT', title: 'Checkout', teamId: 'T' }],
    };
    const { merged, summary } = reconcileDataset(current, incoming);
    expect(merged.members.map((m) => m.id).sort()).toEqual(['u1', 'u2']);
    expect(summary.membersAdded).toBe(0);
  });
});
