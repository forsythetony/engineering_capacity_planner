import { describe, expect, it } from 'vitest';
import type { DomainDataset, Setting } from '@ecp/shared';
import { defaultGlobalSettings, SETTING_KEYS } from '@ecp/shared';
import { projectEpicFromDataset, readEngineConfig } from '../src/adapter.js';

/** Minimal but complete dataset: one team, one solo member, one epic. */
function fixture(settings: Setting[] = defaultGlobalSettings()): DomainDataset {
  return {
    teams: [
      {
        id: 't',
        name: 'T',
        sprintLengthDays: 14,
        sprintStartWeekday: 2,
        sprintAnchorDate: '2026-01-06',
        workingDays: [1, 2, 3, 4, 5],
      },
    ],
    members: [{ id: 'M1', teamId: 't', name: 'M1', baseVelocity: 10, active: true }],
    velocityOverrides: [],
    pto: [],
    oncall: [],
    epics: [{ key: 'CKT', title: 'Checkout', teamId: 't' }],
    milestones: [
      { id: 'g', epicKey: 'CKT', name: 'First QA in stage pass', date: '2026-01-26', isGating: true },
      { id: 'l', epicKey: 'CKT', name: 'Launch', date: '2026-03-01', isGating: false },
    ],
    stories: [{ key: 'CKT-S1', epicKey: 'CKT', title: 'Story' }],
    workItems: [
      { key: 'CKT-1', storyKey: 'CKT-S1', title: 'x', points: 10, status: 'To Do', assigneeId: 'M1' },
    ],
    dependencies: [],
    settings,
  };
}

function withGreenMin(days: number): Setting[] {
  return defaultGlobalSettings().map((s) =>
    s.key === SETTING_KEYS.GREEN_MIN_BUFFER_DAYS ? { ...s, value: JSON.stringify(days) } : s,
  );
}

describe('projectEpicFromDataset', () => {
  it('projects using the gating milestone and default settings', () => {
    const r = projectEpicFromDataset(fixture(), 'CKT', '2026-01-06');
    expect(r.gatingDate).toBe('2026-01-26');
    expect(r.projectedDevCompleteDate).toBe('2026-01-19');
    expect(r.bufferWorkingDays).toBe(5);
    expect(r.verdict).toBe('green'); // default green_min = 5
  });

  it('respects an overridden green threshold from the settings store', () => {
    const r = projectEpicFromDataset(fixture(withGreenMin(6)), 'CKT', '2026-01-06');
    expect(r.verdict).toBe('yellow'); // buffer 5 < 6
  });

  it('only counts the epic’s own work items', () => {
    const data = fixture();
    // A work item under a different epic's story must not affect the projection.
    data.stories.push({ key: 'OTHER-S1', epicKey: 'OTHER', title: 'y' });
    data.workItems.push({
      key: 'OTHER-1',
      storyKey: 'OTHER-S1',
      title: 'y',
      points: 999,
      status: 'To Do',
      assigneeId: 'M1',
    });
    const r = projectEpicFromDataset(data, 'CKT', '2026-01-06');
    expect(r.remainingPoints).toBe(10);
  });

  it('throws when the epic is missing', () => {
    expect(() => projectEpicFromDataset(fixture(), 'NOPE', '2026-01-06')).toThrow(/not found/);
  });

  it('throws when the epic has no gating milestone', () => {
    const data = fixture();
    data.milestones = data.milestones.map((m) => ({ ...m, isGating: false }));
    expect(() => projectEpicFromDataset(data, 'CKT', '2026-01-06')).toThrow(/gating/);
  });
});

describe('readEngineConfig', () => {
  it('reads knobs from global settings', () => {
    const cfg = readEngineConfig(fixture());
    expect(cfg.oncallMultiplier).toBe(0.5);
    expect(cfg.greenMinBufferDays).toBe(5);
  });

  it('falls back to defaults when a setting is absent', () => {
    const cfg = readEngineConfig(fixture([]));
    expect(cfg.oncallMultiplier).toBe(0.5);
    expect(cfg.greenMinBufferDays).toBe(5);
  });
});
