import { describe, expect, it } from 'vitest';
import { addDays, formatIso, parseIso } from '../src/util/dates.js';

describe('date utilities', () => {
  it('round-trips ISO dates through parse/format', () => {
    for (const d of ['2026-01-06', '2026-12-31', '2025-02-28']) {
      expect(formatIso(parseIso(d))).toBe(d);
    }
  });

  it('adds days across a month boundary', () => {
    expect(addDays('2026-01-30', 5)).toBe('2026-02-04');
  });

  it('adds days across a year boundary', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('handles leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('subtracts with negative offsets', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
