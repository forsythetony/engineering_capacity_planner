import { describe, expect, it } from 'vitest';
import type { Team } from '@ecp/shared';
import { makeSprintCache, sprintByIndex, sprintFor, sprintIndexFor } from '../src/calendar.js';

const team: Team = {
  id: 't',
  name: 'T',
  sprintLengthDays: 14,
  sprintStartWeekday: 2,
  sprintAnchorDate: '2026-01-06', // Tuesday
  workingDays: [1, 2, 3, 4, 5],
};

describe('sprint calendar', () => {
  it('sprint 0 starts on the anchor and spans the length', () => {
    const s = sprintByIndex(team, 0);
    expect(s.start).toBe('2026-01-06');
    expect(s.end).toBe('2026-01-19'); // 14 days inclusive
  });

  it('enumerates exactly the working days of a 14-day sprint', () => {
    const s = sprintByIndex(team, 0);
    expect(s.workingDays).toHaveLength(10); // two Mon–Fri weeks
    expect(s.workingDays[0]).toBe('2026-01-06');
    expect(s.workingDays.at(-1)).toBe('2026-01-19');
    expect(s.workingDays).not.toContain('2026-01-10'); // Saturday
  });

  it('tiles forward in fixed steps from the anchor', () => {
    expect(sprintByIndex(team, 1).start).toBe('2026-01-20');
    expect(sprintByIndex(team, 2).start).toBe('2026-02-03');
  });

  it('handles indices before the anchor (negative)', () => {
    expect(sprintByIndex(team, -1).start).toBe('2025-12-23');
    expect(sprintIndexFor('2025-12-23', team)).toBe(-1);
  });

  it('maps a date to the sprint that contains it', () => {
    expect(sprintIndexFor('2026-01-06', team)).toBe(0); // first day
    expect(sprintIndexFor('2026-01-19', team)).toBe(0); // last day
    expect(sprintIndexFor('2026-01-20', team)).toBe(1); // next start
    expect(sprintFor('2026-01-15', team).index).toBe(0);
  });

  it('every sprint boundary lands on the configured start weekday', () => {
    for (let i = -3; i <= 5; i++) {
      // 2026-01-06 is a Tuesday; step is a whole number of weeks.
      expect(new Date(`${sprintByIndex(team, i).start}T00:00:00Z`).getUTCDay()).toBe(2);
    }
  });

  it('memoized cache returns identical sprint objects', () => {
    const cache = makeSprintCache(team);
    expect(cache(3)).toBe(cache(3));
    expect(cache(3).start).toBe(sprintByIndex(team, 3).start);
  });

  it('supports a different cadence (weekly sprints)', () => {
    const weekly: Team = { ...team, sprintLengthDays: 7 };
    expect(sprintByIndex(weekly, 0).end).toBe('2026-01-12');
    expect(sprintByIndex(weekly, 1).start).toBe('2026-01-13');
    expect(sprintByIndex(weekly, 0).workingDays).toHaveLength(5);
  });
});
