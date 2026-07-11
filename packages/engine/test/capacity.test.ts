import { describe, expect, it } from 'vitest';
import type { Oncall, Pto, Team, TeamMember, VelocityOverride } from '@ecp/shared';
import { sprintByIndex } from '../src/calendar.js';
import {
  buildCapacityContext,
  dayCapacity,
  memberDayFactor,
  sprintCapacity,
  type CapacityInputs,
} from '../src/capacity.js';

const team: Team = {
  id: 't',
  name: 'T',
  sprintLengthDays: 14,
  sprintStartWeekday: 2,
  sprintAnchorDate: '2026-01-06',
  workingDays: [1, 2, 3, 4, 5],
};
const sprint = sprintByIndex(team, 0); // 10 working days
const WORKDAY = '2026-01-07'; // a Wednesday inside sprint 0

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  id: 'M1',
  teamId: 't',
  name: 'M1',
  baseVelocity: 10,
  active: true,
  ...over,
});

const ctxOf = (over: Partial<CapacityInputs>) =>
  buildCapacityContext({
    members: [member()],
    pto: [],
    oncall: [],
    velocityOverrides: [],
    oncallMultiplier: 0.5,
    ...over,
  });

describe('memberDayFactor', () => {
  it('is 1 with no modifiers', () => {
    expect(memberDayFactor(member(), WORKDAY, ctxOf({}))).toBe(1);
  });

  it('is 0 during PTO', () => {
    const pto: Pto[] = [{ id: 'p', memberId: 'M1', startDate: '2026-01-05', endDate: '2026-01-09' }];
    expect(memberDayFactor(member(), WORKDAY, ctxOf({ pto }))).toBe(0);
  });

  it('applies the on-call multiplier', () => {
    const oncall: Oncall[] = [{ id: 'o', memberId: 'M1', startDate: WORKDAY, endDate: WORKDAY }];
    expect(memberDayFactor(member(), WORKDAY, ctxOf({ oncall }))).toBe(0.5);
  });

  it('applies a velocity override multiplier', () => {
    const velocityOverrides: VelocityOverride[] = [
      { id: 'v', memberId: 'M1', startDate: '2026-01-01', endDate: '2026-01-31', multiplier: 0.5 },
    ];
    expect(memberDayFactor(member(), WORKDAY, ctxOf({ velocityOverrides }))).toBe(0.5);
  });

  it('composes on-call and override multiplicatively', () => {
    const oncall: Oncall[] = [{ id: 'o', memberId: 'M1', startDate: WORKDAY, endDate: WORKDAY }];
    const velocityOverrides: VelocityOverride[] = [
      { id: 'v', memberId: 'M1', startDate: WORKDAY, endDate: WORKDAY, multiplier: 0.5 },
    ];
    expect(memberDayFactor(member(), WORKDAY, ctxOf({ oncall, velocityOverrides }))).toBe(0.25);
  });

  it('PTO dominates other modifiers (still 0)', () => {
    const pto: Pto[] = [{ id: 'p', memberId: 'M1', startDate: WORKDAY, endDate: WORKDAY }];
    const oncall: Oncall[] = [{ id: 'o', memberId: 'M1', startDate: WORKDAY, endDate: WORKDAY }];
    expect(memberDayFactor(member(), WORKDAY, ctxOf({ pto, oncall }))).toBe(0);
  });

  it('does not apply modifiers outside their date range', () => {
    const oncall: Oncall[] = [{ id: 'o', memberId: 'M1', startDate: '2026-02-01', endDate: '2026-02-05' }];
    expect(memberDayFactor(member(), WORKDAY, ctxOf({ oncall }))).toBe(1);
  });
});

describe('dayCapacity', () => {
  it('spreads velocity evenly across the sprint working days', () => {
    // one member, 10 pts / 10 working days = 1.0 per day.
    expect(dayCapacity(WORKDAY, sprint, ctxOf({}))).toBeCloseTo(1.0, 9);
  });

  it('sums across active members', () => {
    const ctx = buildCapacityContext({
      members: [member({ id: 'a', baseVelocity: 10 }), member({ id: 'b', baseVelocity: 20 })],
      pto: [],
      oncall: [],
      velocityOverrides: [],
      oncallMultiplier: 0.5,
    });
    expect(dayCapacity(WORKDAY, sprint, ctx)).toBeCloseTo(3.0, 9); // (10+20)/10
  });

  it('excludes inactive members', () => {
    const ctx = buildCapacityContext({
      members: [member({ id: 'a' }), member({ id: 'b', active: false })],
      pto: [],
      oncall: [],
      velocityOverrides: [],
      oncallMultiplier: 0.5,
    });
    expect(dayCapacity(WORKDAY, sprint, ctx)).toBeCloseTo(1.0, 9);
  });
});

describe('sprintCapacity', () => {
  it('equals the sum of active base velocities when fully available', () => {
    const ctx = buildCapacityContext({
      members: [member({ id: 'a', baseVelocity: 10 }), member({ id: 'b', baseVelocity: 13 })],
      pto: [],
      oncall: [],
      velocityOverrides: [],
      oncallMultiplier: 0.5,
    });
    expect(sprintCapacity(sprint, ctx)).toBeCloseTo(23, 9);
  });

  it('drops by exactly one member-day per PTO working day', () => {
    // Full capacity 10; one PTO working day removes 10/10 = 1 point.
    const pto: Pto[] = [{ id: 'p', memberId: 'M1', startDate: WORKDAY, endDate: WORKDAY }];
    expect(sprintCapacity(sprint, ctxOf({ pto }))).toBeCloseTo(9, 9);
  });

  it('halves an on-call member for the days they are on call', () => {
    // On call for the whole sprint at 0.5 → capacity halves.
    const oncall: Oncall[] = [
      { id: 'o', memberId: 'M1', startDate: sprint.start, endDate: sprint.end },
    ];
    expect(sprintCapacity(sprint, ctxOf({ oncall }))).toBeCloseTo(5, 9);
  });
});
