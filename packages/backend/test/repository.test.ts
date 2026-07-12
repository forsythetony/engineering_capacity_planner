import { beforeEach, describe, expect, it } from 'vitest';
import { SETTING_KEYS } from '@ecp/shared';
import { openDatabase, type Db } from '../src/db/database.js';
import { readDataset, writeDataset } from '../src/db/persist.js';
import { generateSyntheticDataset } from '../src/importer/synthetic.js';
import { HttpError } from '../src/http-error.js';
import * as repo from '../src/db/repository.js';

let db: Db;
beforeEach(() => {
  db = openDatabase({ path: ':memory:' });
  writeDataset(db, generateSyntheticDataset());
});

/** Assert a thunk throws an HttpError with the given status. */
function expectHttp(fn: () => unknown, status: number): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(status);
    return;
  }
  throw new Error(`expected HttpError ${status}, but nothing was thrown`);
}

describe('settings', () => {
  it('upserts a known numeric knob and returns global settings', () => {
    const settings = repo.upsertGlobalSettings(db, { [SETTING_KEYS.ONCALL_MULTIPLIER]: 0.25 });
    const row = settings.find((s) => s.key === SETTING_KEYS.ONCALL_MULTIPLIER)!;
    expect(JSON.parse(row.value)).toBe(0.25);
    // Persisted (not just returned).
    const persisted = readDataset(db).settings.find((s) => s.key === SETTING_KEYS.ONCALL_MULTIPLIER)!;
    expect(JSON.parse(persisted.value)).toBe(0.25);
  });

  it('accepts nullable Jira mapping stubs', () => {
    const settings = repo.upsertGlobalSettings(db, { [SETTING_KEYS.JIRA_PROJECT_KEY]: 'CKT' });
    expect(JSON.parse(settings.find((s) => s.key === SETTING_KEYS.JIRA_PROJECT_KEY)!.value)).toBe('CKT');
  });

  it('accepts the Gantt week-yellow fraction within 0–1 and rejects out of range', () => {
    const settings = repo.upsertGlobalSettings(db, { [SETTING_KEYS.WEEK_YELLOW_LOAD_FRACTION]: 0.9 });
    expect(JSON.parse(settings.find((s) => s.key === SETTING_KEYS.WEEK_YELLOW_LOAD_FRACTION)!.value)).toBe(0.9);
    expectHttp(() => repo.upsertGlobalSettings(db, { [SETTING_KEYS.WEEK_YELLOW_LOAD_FRACTION]: 1.5 }), 400);
    expectHttp(() => repo.upsertGlobalSettings(db, { [SETTING_KEYS.WEEK_YELLOW_LOAD_FRACTION]: -0.1 }), 400);
  });

  it('rejects unknown keys and bad value types', () => {
    expectHttp(() => repo.upsertGlobalSettings(db, { not_a_setting: 1 }), 400);
    expectHttp(() => repo.upsertGlobalSettings(db, { [SETTING_KEYS.ONCALL_MULTIPLIER]: 'x' }), 400);
    expectHttp(() => repo.upsertGlobalSettings(db, { [SETTING_KEYS.GREEN_MIN_BUFFER_DAYS]: -1 }), 400);
    expectHttp(() => repo.upsertGlobalSettings(db, {}), 400);
  });
});

describe('team cadence', () => {
  it('updates a subset of fields', () => {
    const team = repo.updateTeam(db, 'team-platform', { sprintLengthDays: 7, name: 'Platform' });
    expect(team.sprintLengthDays).toBe(7);
    expect(team.name).toBe('Platform');
    // Untouched fields survive.
    expect(team.workingDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('normalises working days (dedupes + sorts) and validates them', () => {
    const team = repo.updateTeam(db, 'team-platform', { workingDays: [5, 1, 3, 1] });
    expect(team.workingDays).toEqual([1, 3, 5]);
    expectHttp(() => repo.updateTeam(db, 'team-platform', { workingDays: [] }), 400);
    expectHttp(() => repo.updateTeam(db, 'team-platform', { sprintStartWeekday: 9 }), 400);
    expectHttp(() => repo.updateTeam(db, 'team-platform', { sprintLengthDays: 0 }), 400);
  });

  it('404s an unknown team', () => {
    expectHttp(() => repo.updateTeam(db, 'nope', { name: 'x' }), 404);
  });
});

describe('members', () => {
  it('creates, updates, and deletes a member', () => {
    const created = repo.createMember(db, { teamId: 'team-platform', name: 'Zoe', baseVelocity: 10 });
    expect(created.id).toMatch(/^mem_/);
    expect(created.active).toBe(true);

    const updated = repo.updateMember(db, created.id, { active: false, baseVelocity: 6 });
    expect(updated.active).toBe(false);
    expect(updated.baseVelocity).toBe(6);

    repo.deleteMember(db, created.id);
    expect(readDataset(db).members.find((m) => m.id === created.id)).toBeUndefined();
  });

  it('cascades member deletion to PTO/on-call and unassigns work items', () => {
    const pto = repo.createPto(db, { memberId: 'M1', startDate: '2026-07-20', endDate: '2026-07-24' });
    const before = readDataset(db);
    const assigned = before.workItems.find((w) => w.assigneeId === 'M1');

    repo.deleteMember(db, 'M1');
    const after = readDataset(db);
    expect(after.pto.find((p) => p.id === pto.id)).toBeUndefined();
    if (assigned) {
      expect(after.workItems.find((w) => w.key === assigned.key)!.assigneeId).toBeNull();
    }
  });

  it('validates input', () => {
    expectHttp(() => repo.createMember(db, { teamId: 'nope', name: 'x', baseVelocity: 1 }), 404);
    expectHttp(() => repo.createMember(db, { teamId: 'team-platform', name: '', baseVelocity: 1 }), 400);
    expectHttp(() => repo.createMember(db, { teamId: 'team-platform', name: 'x', baseVelocity: -1 }), 400);
    expectHttp(() => repo.updateMember(db, 'nope', { name: 'x' }), 404);
  });
});

describe('date-range modifiers', () => {
  it('creates and deletes PTO with date-order validation', () => {
    const pto = repo.createPto(db, { memberId: 'M2', startDate: '2026-08-01', endDate: '2026-08-05' });
    expect(pto.id).toMatch(/^pto_/);
    repo.deletePto(db, pto.id);
    expectHttp(() => repo.deletePto(db, pto.id), 404); // gone
    expectHttp(() => repo.createPto(db, { memberId: 'M2', startDate: '2026-08-05', endDate: '2026-08-01' }), 400);
    expectHttp(() => repo.createPto(db, { memberId: 'ghost', startDate: '2026-08-01', endDate: '2026-08-05' }), 404);
  });

  it('stores an optional note and normalises blank notes to null', () => {
    const withNote = repo.createPto(db, {
      memberId: 'M2',
      startDate: '2026-08-01',
      endDate: '2026-08-05',
      note: '  parental leave  ',
    });
    expect(withNote.note).toBe('parental leave'); // trimmed
    const blank = repo.createOncall(db, { memberId: 'M2', startDate: '2026-08-01', endDate: '2026-08-05', note: '   ' });
    expect(blank.note).toBeNull();
    const absent = repo.createVelocityOverride(db, {
      memberId: 'M2',
      startDate: '2026-08-01',
      endDate: '2026-08-05',
      multiplier: 0.5,
    });
    expect(absent.note).toBeNull();
    // Persisted round-trip.
    expect(readDataset(db).pto.find((p) => p.id === withNote.id)!.note).toBe('parental leave');
  });

  it('creates on-call and velocity overrides', () => {
    const oc = repo.createOncall(db, { memberId: 'M3', startDate: '2026-08-01', endDate: '2026-08-14' });
    expect(oc.id).toMatch(/^oc_/);
    const vo = repo.createVelocityOverride(db, {
      memberId: 'M3',
      startDate: '2026-08-01',
      endDate: '2026-08-14',
      multiplier: 0.5,
    });
    expect(vo.multiplier).toBe(0.5);
    expectHttp(
      () => repo.createVelocityOverride(db, { memberId: 'M3', startDate: '2026-08-01', endDate: '2026-08-14', multiplier: -1 }),
      400,
    );
  });
});

describe('epic milestones (gating invariant)', () => {
  const gating = () => readDataset(db).milestones.filter((m) => m.isGating);

  it('creating a gating milestone demotes the previous one', () => {
    expect(gating()).toHaveLength(1);
    const created = repo.createMilestone(db, 'CKT', { name: 'Code freeze', date: '2026-08-20', isGating: true });
    const after = gating();
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(created.id);
  });

  it('adds a non-gating relevant day without touching the gate', () => {
    const before = gating()[0]!.id;
    repo.createMilestone(db, 'CKT', { name: 'Beta', date: '2026-08-10' });
    expect(gating()).toHaveLength(1);
    expect(gating()[0]!.id).toBe(before);
  });

  it('refuses to demote or delete the sole gating milestone', () => {
    const gate = gating()[0]!;
    expectHttp(() => repo.updateMilestone(db, gate.id, { isGating: false }), 409);
    expectHttp(() => repo.deleteMilestone(db, gate.id), 409);
  });

  it('deletes a non-gating milestone', () => {
    const nonGating = readDataset(db).milestones.find((m) => !m.isGating)!;
    repo.deleteMilestone(db, nonGating.id);
    expect(readDataset(db).milestones.find((m) => m.id === nonGating.id)).toBeUndefined();
  });

  it('404s unknown milestones', () => {
    expectHttp(() => repo.updateMilestone(db, 'nope', { name: 'x' }), 404);
    expectHttp(() => repo.deleteMilestone(db, 'nope'), 404);
  });
});

describe('placements (Gantt Planner)', () => {
  // Start from an empty board so assertions don't depend on the seeded plan.
  beforeEach(() => {
    db.prepare('DELETE FROM planned_placement').run();
  });

  it('places a work item into a sprint week and persists it', () => {
    const p = repo.upsertPlacement(db, { workItemKey: 'CKT-1', sprintId: 'SP1', weekIndex: 0 });
    expect(p).toMatchObject({ workItemKey: 'CKT-1', sprintId: 'SP1', weekIndex: 0 });
    const persisted = readDataset(db).placements.find((x) => x.workItemKey === 'CKT-1')!;
    expect(persisted.sprintId).toBe('SP1');
  });

  it('moves a work item rather than duplicating it (one placement per item)', () => {
    repo.upsertPlacement(db, { workItemKey: 'CKT-1', sprintId: 'SP1', weekIndex: 0 });
    repo.upsertPlacement(db, { workItemKey: 'CKT-1', sprintId: 'SP2', weekIndex: 1 });
    const placements = readDataset(db).placements.filter((x) => x.workItemKey === 'CKT-1');
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ sprintId: 'SP2', weekIndex: 1 });
  });

  it('removes a placement (back to the backlog bag)', () => {
    repo.upsertPlacement(db, { workItemKey: 'CKT-1', sprintId: 'SP1', weekIndex: 0 });
    repo.deletePlacement(db, 'CKT-1');
    expect(readDataset(db).placements.find((x) => x.workItemKey === 'CKT-1')).toBeUndefined();
  });

  it('validates the input, the references, and the week range', () => {
    expectHttp(() => repo.upsertPlacement(db, { workItemKey: 'CKT-1', sprintId: 'SP1', weekIndex: 9 }), 400);
    expectHttp(() => repo.upsertPlacement(db, { workItemKey: 'NOPE', sprintId: 'SP1', weekIndex: 0 }), 404);
    expectHttp(() => repo.upsertPlacement(db, { workItemKey: 'CKT-1', sprintId: 'NOPE', weekIndex: 0 }), 404);
    expectHttp(() => repo.deletePlacement(db, 'CKT-1'), 404); // nothing placed yet
  });
});
