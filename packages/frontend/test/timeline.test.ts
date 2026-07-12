import { describe, expect, it } from 'vitest';
import { computeDomain, makeScale, monthTicks } from '../src/lib/timeline';

describe('makeScale', () => {
  it('maps the endpoints to 0 and 1 and the midpoint to 0.5', () => {
    const s = makeScale('2026-01-01', '2026-01-11'); // 10-day span
    expect(s.fractionOf('2026-01-01')).toBeCloseTo(0, 9);
    expect(s.fractionOf('2026-01-11')).toBeCloseTo(1, 9);
    expect(s.fractionOf('2026-01-06')).toBeCloseTo(0.5, 9);
  });

  it('clamps out-of-domain dates', () => {
    const s = makeScale('2026-01-01', '2026-01-11');
    expect(s.fractionOf('2025-12-01')).toBe(0);
    expect(s.fractionOf('2026-06-01')).toBe(1);
  });
});

describe('computeDomain', () => {
  it('spans all dates with padding and ignores nullish entries', () => {
    const d = computeDomain(['2026-02-10', null, '2026-01-20', undefined], 7);
    expect(d.start).toBe('2026-01-13'); // 2026-01-20 - 7
    expect(d.end).toBe('2026-02-17'); // 2026-02-10 + 7
  });

  it('throws when no dates are provided', () => {
    expect(() => computeDomain([null, undefined])).toThrow();
  });
});

describe('monthTicks', () => {
  it('lists the first of each month within range', () => {
    expect(monthTicks('2026-01-13', '2026-03-05')).toEqual(['2026-02-01', '2026-03-01']);
  });

  it('includes a range start that is itself the first of a month', () => {
    expect(monthTicks('2026-01-01', '2026-02-10')).toEqual(['2026-01-01', '2026-02-01']);
  });
});
