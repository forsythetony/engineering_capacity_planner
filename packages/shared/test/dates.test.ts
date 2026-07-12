import { describe, expect, it } from 'vitest';
import {
  addDays,
  diffDays,
  enumerateWorkingDays,
  formatIso,
  getWeekday,
  isWorkingDay,
  nextWorkingDay,
  parseIso,
  workingDaysBetween,
} from '../src/dates.js';

const MON_FRI = [1, 2, 3, 4, 5] as const;

describe('parse/format/addDays', () => {
  it('round-trips ISO dates', () => {
    for (const d of ['2026-01-06', '2026-12-31', '2025-02-28']) {
      expect(formatIso(parseIso(d))).toBe(d);
    }
  });

  it('adds days across month/year/leap boundaries', () => {
    expect(addDays('2026-01-30', 5)).toBe('2026-02-04');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('diffDays', () => {
  it('counts whole days, signed', () => {
    expect(diffDays('2026-01-06', '2026-01-20')).toBe(14);
    expect(diffDays('2026-01-20', '2026-01-06')).toBe(-14);
    expect(diffDays('2026-01-06', '2026-01-06')).toBe(0);
  });
});

describe('getWeekday / isWorkingDay', () => {
  it('identifies weekdays (0=Sun..6=Sat)', () => {
    expect(getWeekday('2026-01-06')).toBe(2); // Tuesday
    expect(getWeekday('2026-01-10')).toBe(6); // Saturday
    expect(getWeekday('2026-01-11')).toBe(0); // Sunday
  });

  it('respects the working-day set', () => {
    expect(isWorkingDay('2026-01-06', MON_FRI)).toBe(true); // Tue
    expect(isWorkingDay('2026-01-10', MON_FRI)).toBe(false); // Sat
    expect(isWorkingDay('2026-01-11', MON_FRI)).toBe(false); // Sun
  });
});

describe('nextWorkingDay', () => {
  it('returns the same day when it is a working day', () => {
    expect(nextWorkingDay('2026-01-06', MON_FRI)).toBe('2026-01-06');
  });

  it('skips forward over a weekend', () => {
    expect(nextWorkingDay('2026-01-10', MON_FRI)).toBe('2026-01-12'); // Sat -> Mon
    expect(nextWorkingDay('2026-01-11', MON_FRI)).toBe('2026-01-12'); // Sun -> Mon
  });

  it('throws when no working days are configured', () => {
    expect(() => nextWorkingDay('2026-01-06', [])).toThrow();
  });
});

describe('enumerateWorkingDays', () => {
  it('lists the working days in an inclusive range', () => {
    // 2026-01-06 (Tue) .. 2026-01-19 (Mon) is one 14-day sprint.
    const days = enumerateWorkingDays('2026-01-06', '2026-01-19', MON_FRI);
    expect(days).toHaveLength(10);
    expect(days[0]).toBe('2026-01-06');
    expect(days.at(-1)).toBe('2026-01-19');
    expect(days).not.toContain('2026-01-10'); // Saturday excluded
  });
});

describe('workingDaysBetween', () => {
  it('is zero for equal dates', () => {
    expect(workingDaysBetween('2026-01-19', '2026-01-19', MON_FRI)).toBe(0);
  });

  it('counts working days after `from` up to and including `to`', () => {
    // Mon 2026-01-19 -> Mon 2026-01-26: Tue-Fri (4) + Mon (1) = 5.
    expect(workingDaysBetween('2026-01-19', '2026-01-26', MON_FRI)).toBe(5);
  });

  it('is negative when `to` precedes `from`', () => {
    // Working days in (2026-01-15, 2026-01-19]: Fri 16 + Mon 19 = 2 -> -2.
    expect(workingDaysBetween('2026-01-19', '2026-01-15', MON_FRI)).toBe(-2);
  });

  it('is symmetric in magnitude', () => {
    const a = workingDaysBetween('2026-01-06', '2026-02-06', MON_FRI);
    const b = workingDaysBetween('2026-02-06', '2026-01-06', MON_FRI);
    expect(a).toBe(-b);
  });
});
