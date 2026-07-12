import { describe, expect, it } from 'vitest';
import type { Pto, TeamMember } from '@ecp/shared';
import { buildCapacityContext } from '../src/capacity.js';
import { sprintWeeks, weeklyPlan, weekVerdict } from '../src/week.js';

const WORKING_DAYS = [1, 2, 3, 4, 5];
// Sprint 0 for a Tuesday anchor: Jan 6 (Tue) … Jan 19 (Mon), 10 working days.
const SPRINT_START = '2026-01-06';
const SPRINT_END = '2026-01-19';

// One member, 10 pts/sprint ÷ 10 working days = 1 point per working day, so
// each of the sprint's two 5-working-day weeks has capacity 5.
const soloMember: TeamMember = { id: 'M1', teamId: 't', name: 'M1', baseVelocity: 10, active: true };

function ctx(pto: Pto[] = []) {
  return buildCapacityContext({
    members: [soloMember],
    pto,
    oncall: [],
    velocityOverrides: [],
    oncallMultiplier: 0.5,
  });
}

describe('sprintWeeks', () => {
  it('slices a 14-day sprint into two 7-day weeks', () => {
    const weeks = sprintWeeks(SPRINT_START, SPRINT_END, WORKING_DAYS);
    expect(weeks.map((w) => [w.index, w.start, w.end])).toEqual([
      [0, '2026-01-06', '2026-01-12'],
      [1, '2026-01-13', '2026-01-19'],
    ]);
    // Mon–Fri only: 5 working days per week.
    expect(weeks[0]!.workingDays).toHaveLength(5);
    expect(weeks[1]!.workingDays).toHaveLength(5);
  });

  it('clips the final short week to the sprint end', () => {
    const weeks = sprintWeeks('2026-01-06', '2026-01-15', WORKING_DAYS); // 10 days
    expect(weeks).toHaveLength(2);
    expect(weeks[1]!.end).toBe('2026-01-15');
  });
});

describe('weekVerdict (default 100% yellow threshold)', () => {
  it('is green below capacity, yellow when fully loaded, red when over', () => {
    expect(weekVerdict(4, 5, 1.0)).toBe('green');
    expect(weekVerdict(5, 5, 1.0)).toBe('yellow');
    expect(weekVerdict(6, 5, 1.0)).toBe('red');
  });

  it('widens the yellow band as the fraction drops', () => {
    expect(weekVerdict(4.5, 5, 0.9)).toBe('yellow');
    expect(weekVerdict(4, 5, 0.9)).toBe('green');
  });

  it('treats a zero-capacity week as red only when something is placed', () => {
    expect(weekVerdict(0, 0, 1.0)).toBe('green');
    expect(weekVerdict(1, 0, 1.0)).toBe('red');
  });
});

describe('weeklyPlan', () => {
  it('partitions sprint capacity evenly across empty weeks', () => {
    const weeks = weeklyPlan({
      startDate: SPRINT_START,
      endDate: SPRINT_END,
      workingDays: WORKING_DAYS,
      capacityCtx: ctx(),
      placedPointsByWeek: new Map(),
    });
    expect(weeks.map((w) => w.capacity)).toEqual([5, 5]);
    expect(weeks.every((w) => w.verdict === 'green')).toBe(true);
  });

  it('drops only the affected week when PTO lands inside it', () => {
    // PTO across all of week 0 zeroes its capacity; week 1 is untouched.
    const weeks = weeklyPlan({
      startDate: SPRINT_START,
      endDate: SPRINT_END,
      workingDays: WORKING_DAYS,
      capacityCtx: ctx([
        { id: 'P1', memberId: 'M1', startDate: '2026-01-06', endDate: '2026-01-12', note: null },
      ]),
      placedPointsByWeek: new Map(),
    });
    expect(weeks[0]!.capacity).toBe(0);
    expect(weeks[1]!.capacity).toBe(5);
  });

  it('classifies each week by its placed load', () => {
    const weeks = weeklyPlan({
      startDate: SPRINT_START,
      endDate: SPRINT_END,
      workingDays: WORKING_DAYS,
      capacityCtx: ctx(),
      placedPointsByWeek: new Map([
        [0, 6], // over capacity 5 → red
        [1, 4], // under capacity 5 → green
      ]),
    });
    expect(weeks[0]!.verdict).toBe('red');
    expect(weeks[0]!.placedPoints).toBe(6);
    expect(weeks[1]!.verdict).toBe('green');
  });
});
