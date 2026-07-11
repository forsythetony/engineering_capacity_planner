/**
 * Tiny deterministic PRNG (mulberry32) plus sampling helpers.
 *
 * The synthetic generator must be reproducible so tests can assert on exact
 * output for a given seed; `Math.random()` would make that impossible.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Force to uint32; a 0 seed is fine for mulberry32.
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniformly pick one element (throws on empty input). */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)]!;
  }

  /**
   * Pick one element by weight. `weights[i]` is the relative weight of
   * `items[i]`; they need not sum to 1. Throws if lengths differ or all weights
   * are zero.
   */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length !== weights.length || items.length === 0) {
      throw new Error('Rng.weighted: mismatched or empty inputs');
    }
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) throw new Error('Rng.weighted: weights sum to zero');
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i]!;
      if (roll < 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Fisher–Yates shuffle, returning a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
}
