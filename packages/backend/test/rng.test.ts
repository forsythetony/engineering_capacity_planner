import { describe, expect, it } from 'vitest';
import { Rng } from '../src/importer/rng.js';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 20 }, ((r) => () => r.next())(new Rng(1)));
    const b = Array.from({ length: 20 }, ((r) => () => r.next())(new Rng(2)));
    expect(a).not.toEqual(b);
  });

  it('next() stays within [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() stays within the inclusive range and hits both ends', () => {
    const r = new Rng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([3, 4, 5, 6, 7]));
  });

  it('weighted() never returns a zero-weight item', () => {
    const r = new Rng(11);
    const items = ['a', 'b', 'c'] as const;
    const weights = [0, 5, 0];
    for (let i = 0; i < 500; i++) {
      expect(r.weighted(items, weights)).toBe('b');
    }
  });

  it('weighted() roughly respects proportions', () => {
    const r = new Rng(123);
    const counts = { a: 0, b: 0 };
    const n = 10000;
    for (let i = 0; i < n; i++) counts[r.weighted(['a', 'b'] as const, [3, 1])]++;
    // Expect ~75% 'a'. Allow generous slack.
    expect(counts.a / n).toBeGreaterThan(0.7);
    expect(counts.a / n).toBeLessThan(0.8);
  });

  it('shuffle() is a permutation and does not mutate its input', () => {
    const r = new Rng(5);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = r.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
  });

  it('pick() throws on an empty array', () => {
    expect(() => new Rng(1).pick([])).toThrow();
  });

  it('weighted() throws when weights sum to zero', () => {
    expect(() => new Rng(1).weighted(['a', 'b'], [0, 0])).toThrow();
  });
});
