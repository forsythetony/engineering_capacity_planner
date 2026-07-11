import { describe, expect, it } from 'vitest';
import type { Oncall, Pto, Team, TeamMember, WorkItem, WorkItemStatus } from '@ecp/shared';
import { project, remainingPoints, type ProjectionInput } from '../src/project.js';

const team: Team = {
  id: 't',
  name: 'T',
  sprintLengthDays: 14,
  sprintStartWeekday: 2,
  sprintAnchorDate: '2026-01-06', // Tuesday; sprint 0 has 10 working days
  workingDays: [1, 2, 3, 4, 5],
};

// One member, 10 pts/sprint ÷ 10 working days = exactly 1 point per working day.
const soloMember: TeamMember = { id: 'M1', teamId: 't', name: 'M1', baseVelocity: 10, active: true };

const item = (points: number, status: WorkItemStatus, key = 'W1'): WorkItem => ({
  key,
  storyKey: 'S1',
  title: 'x',
  points,
  status,
  assigneeId: null,
});

/** All-remaining backlog summing to `points`. */
const backlog = (points: number): WorkItem[] => [item(points, 'To Do')];

function run(over: Partial<ProjectionInput> = {}) {
  const base: ProjectionInput = {
    today: '2026-01-06',
    team,
    members: [soloMember],
    workItems: backlog(10),
    gatingDate: '2026-01-26',
  };
  return project({ ...base, ...over });
}

describe('remainingPoints', () => {
  it('sums only work items that are not Done', () => {
    const items = [
      item(5, 'Done', 'a'),
      item(3, 'To Do', 'b'),
      item(2, 'In Progress', 'c'),
      item(8, 'Done', 'd'),
    ];
    expect(remainingPoints(items)).toBe(5);
  });
});

describe('project — dev-complete date', () => {
  it('lands on the working day the remaining points are covered (1 pt/day)', () => {
    expect(run({ workItems: backlog(10) }).projectedDevCompleteDate).toBe('2026-01-19');
    expect(run({ workItems: backlog(5) }).projectedDevCompleteDate).toBe('2026-01-12');
  });

  it('carries across a sprint boundary', () => {
    // 15 pts = all of sprint 0 (10) + 5 working days of sprint 1.
    expect(run({ workItems: backlog(15) }).projectedDevCompleteDate).toBe('2026-01-26');
  });

  it('reports dev-complete = today when nothing remains', () => {
    const r = run({ workItems: [item(8, 'Done')] });
    expect(r.remainingPoints).toBe(0);
    expect(r.projectedDevCompleteDate).toBe('2026-01-06');
    expect(r.reason).toMatch(/All work is complete/);
  });

  it('is deterministic', () => {
    expect(run({ workItems: backlog(23) })).toEqual(run({ workItems: backlog(23) }));
  });
});

describe('project — buffer sign and verdict bands', () => {
  it('green when buffer ≥ green_min_buffer_days', () => {
    // devComplete 2026-01-19, gating 2026-01-26 → buffer 5, default green_min 5.
    const r = run({ gatingDate: '2026-01-26' });
    expect(r.bufferWorkingDays).toBe(5);
    expect(r.verdict).toBe('green');
  });

  it('yellow when 0 ≤ buffer < green_min', () => {
    // devComplete 2026-01-19, gating 2026-01-23 → buffer 4 < 5.
    const r = run({ gatingDate: '2026-01-23' });
    expect(r.bufferWorkingDays).toBe(4);
    expect(r.verdict).toBe('yellow');
  });

  it('yellow when the buffer is exactly 0 (finishes on the gating day)', () => {
    const r = run({ gatingDate: '2026-01-19' });
    expect(r.bufferWorkingDays).toBe(0);
    expect(r.verdict).toBe('yellow');
  });

  it('red when the buffer is negative (finishes after the gating day)', () => {
    // gating 2026-01-15 is before devComplete 2026-01-19.
    const r = run({ gatingDate: '2026-01-15' });
    expect(r.bufferWorkingDays).toBe(-2);
    expect(r.verdict).toBe('red');
    expect(r.reason).toMatch(/past the gating day/);
  });

  it('honours a configurable green threshold at the boundary', () => {
    // buffer is 4 for gating 2026-01-23.
    expect(run({ gatingDate: '2026-01-23', config: { greenMinBufferDays: 4 } }).verdict).toBe('green');
    expect(run({ gatingDate: '2026-01-23', config: { greenMinBufferDays: 5 } }).verdict).toBe('yellow');
  });
});

describe('project — capacity modifiers move the date', () => {
  it('PTO on a working day delays dev-complete by one working day', () => {
    const pto: Pto[] = [{ id: 'p', memberId: 'M1', startDate: '2026-01-07', endDate: '2026-01-07' }];
    expect(run({ workItems: backlog(10), pto }).projectedDevCompleteDate).toBe('2026-01-20');
  });

  it('an on-call sprint (0.5×) stretches the work across into the next sprint', () => {
    // Sprint 0 halved → 5 pts there; remaining 5 pts at full rate in sprint 1.
    const oncall: Oncall[] = [
      { id: 'o', memberId: 'M1', startDate: '2026-01-06', endDate: '2026-01-19' },
    ];
    const r = run({ workItems: backlog(10), oncall });
    expect(r.projectedDevCompleteDate).toBe('2026-01-26');
    expect(r.verdict).toBe('yellow'); // buffer 0 vs gating 2026-01-26
  });
});

describe('project — cut-ticket recalculation', () => {
  it('cutting a ticket can move the verdict from yellow to green', () => {
    const full = [item(10, 'To Do', 'keep'), item(5, 'To Do', 'cut')];
    const before = run({ workItems: full });
    expect(before.projectedDevCompleteDate).toBe('2026-01-26'); // 15 pts
    expect(before.verdict).toBe('yellow');

    const after = run({ workItems: full.filter((w) => w.key !== 'cut') });
    expect(after.projectedDevCompleteDate).toBe('2026-01-19'); // 10 pts
    expect(after.verdict).toBe('green');
  });
});

describe('project — cadence differences', () => {
  it('shorter sprints (same per-sprint velocity) finish sooner', () => {
    // Weekly sprint: 10 pts / 5 working days = 2 pts/day → 10 pts in 5 days.
    const weekly: Team = { ...team, sprintLengthDays: 7 };
    const r = run({ team: weekly, workItems: backlog(10) });
    expect(r.projectedDevCompleteDate).toBe('2026-01-12');
  });
});

describe('project — infeasible capacity', () => {
  it('returns null dev-complete and a red verdict when no capacity exists', () => {
    const inactive: TeamMember = { ...soloMember, active: false };
    const r = run({ members: [inactive], workItems: backlog(10), config: { maxHorizonDays: 60 } });
    expect(r.projectedDevCompleteDate).toBeNull();
    expect(r.bufferWorkingDays).toBeNull();
    expect(r.verdict).toBe('red');
    expect(r.reason).toMatch(/cannot be completed/);
  });
});

describe('project — sprint trace', () => {
  it('spans today’s sprint through the projected finish with full capacities', () => {
    const r = run({ workItems: backlog(15) }); // finishes in sprint 1
    expect(r.sprints.map((s) => s.index)).toEqual([0, 1]);
    expect(r.sprints.every((s) => s.capacity === 10)).toBe(true);
  });
});
