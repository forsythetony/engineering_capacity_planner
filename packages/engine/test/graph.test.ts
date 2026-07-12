import { describe, expect, it } from 'vitest';
import { analyzeGraph, type GraphEdge } from '../src/graph';

/** Shorthand: build the analysis and return the node lookup. */
function analyze(keys: string[], edges: GraphEdge[]) {
  const a = analyzeGraph(keys, edges);
  return { a, n: (k: string) => a.byKey.get(k)! };
}

const edge = (blocker: string, blocked: string): GraphEdge => ({ blocker, blocked });

describe('analyzeGraph — layering (topological columns)', () => {
  it('places sources at layer 0 and pushes each node past its deepest blocker', () => {
    // A → B → C  and  A → C (the long path wins for C).
    const { n } = analyze(['A', 'B', 'C'], [edge('A', 'B'), edge('B', 'C'), edge('A', 'C')]);
    expect(n('A').layer).toBe(0);
    expect(n('B').layer).toBe(1);
    expect(n('C').layer).toBe(2); // longest path A→B→C, not the shortcut A→C
  });

  it('reports layerCount as the number of columns', () => {
    const { a } = analyze(['A', 'B', 'C'], [edge('A', 'B'), edge('B', 'C')]);
    expect(a.layerCount).toBe(3);
  });

  it('gives isolated nodes layer 0 and layerCount 1', () => {
    const { a, n } = analyze(['X', 'Y'], []);
    expect(n('X').layer).toBe(0);
    expect(n('Y').layer).toBe(0);
    expect(a.layerCount).toBe(1);
  });

  it('layers a diamond so the sink sits past both middle nodes', () => {
    // A → B → D, A → C → D
    const { n } = analyze(
      ['A', 'B', 'C', 'D'],
      [edge('A', 'B'), edge('A', 'C'), edge('B', 'D'), edge('C', 'D')],
    );
    expect(n('A').layer).toBe(0);
    expect(n('B').layer).toBe(1);
    expect(n('C').layer).toBe(1);
    expect(n('D').layer).toBe(2);
  });
});

describe('analyzeGraph — dependent counts (leverage)', () => {
  it('counts direct and transitive dependents down a chain', () => {
    // A → B → C → D
    const { n } = analyze(
      ['A', 'B', 'C', 'D'],
      [edge('A', 'B'), edge('B', 'C'), edge('C', 'D')],
    );
    expect(n('A').directDependents).toBe(1);
    expect(n('A').transitiveDependents).toBe(3); // B, C, D
    expect(n('B').transitiveDependents).toBe(2); // C, D
    expect(n('D').transitiveDependents).toBe(0); // leaf
  });

  it('does not double-count a node reachable by two paths (diamond)', () => {
    const { n } = analyze(
      ['A', 'B', 'C', 'D'],
      [edge('A', 'B'), edge('A', 'C'), edge('B', 'D'), edge('C', 'D')],
    );
    expect(n('A').directDependents).toBe(2); // B, C
    expect(n('A').transitiveDependents).toBe(3); // B, C, D — D counted once
  });

  it('credits a high-leverage blocker with every fan-out target', () => {
    // HUB blocks five independent leaves.
    const leaves = ['L1', 'L2', 'L3', 'L4', 'L5'];
    const { n } = analyze(['HUB', ...leaves], leaves.map((l) => edge('HUB', l)));
    expect(n('HUB').directDependents).toBe(5);
    expect(n('HUB').transitiveDependents).toBe(5);
  });

  it('exposes both directions of each edge on the node', () => {
    const { n } = analyze(['A', 'B', 'C'], [edge('A', 'C'), edge('B', 'C')]);
    expect(n('C').blockedBy).toEqual(['A', 'B']);
    expect(n('A').blocks).toEqual(['C']);
    expect(n('C').blocks).toEqual([]);
  });
});

describe('analyzeGraph — leaderboard (high-leverage ranking)', () => {
  it('ranks by transitive dependents, breaking ties by direct then key', () => {
    // A unblocks the most; B and C both unblock one, B directly, C via a chain.
    const { a } = analyze(
      ['A', 'B', 'C', 'D', 'E'],
      [edge('A', 'B'), edge('A', 'C'), edge('A', 'D'), edge('B', 'E'), edge('C', 'D')],
    );
    // A → {B,C,D,E} = 4 ; B → {E} = 1 ; C → {D} = 1 ; D,E → 0
    const order = a.leaderboard.map((x) => x.key);
    expect(order[0]).toBe('A');
    // B and C tie on transitive(1) and direct(1) → key order.
    expect(order.slice(1, 3)).toEqual(['B', 'C']);
    // Leaves come last, key-ordered.
    expect(order.slice(3)).toEqual(['D', 'E']);
  });

  it('includes every node exactly once', () => {
    const { a } = analyze(['A', 'B', 'C'], [edge('A', 'B')]);
    expect(a.leaderboard).toHaveLength(3);
    expect(new Set(a.leaderboard.map((x) => x.key)).size).toBe(3);
  });
});

describe('analyzeGraph — cycle detection', () => {
  it('reports no cycle for a DAG', () => {
    const { a } = analyze(['A', 'B', 'C'], [edge('A', 'B'), edge('B', 'C')]);
    expect(a.hasCycle).toBe(false);
    expect(a.cycle).toEqual([]);
  });

  it('detects a simple cycle and returns its members', () => {
    const { a } = analyze(['A', 'B', 'C'], [edge('A', 'B'), edge('B', 'C'), edge('C', 'A')]);
    expect(a.hasCycle).toBe(true);
    expect(new Set(a.cycle)).toEqual(new Set(['A', 'B', 'C']));
  });

  it('stays total on cyclic input — layering and counts still terminate', () => {
    const { a, n } = analyze(['A', 'B'], [edge('A', 'B'), edge('B', 'A')]);
    expect(a.hasCycle).toBe(true);
    // Each node reaches the other (and itself is excluded).
    expect(n('A').transitiveDependents).toBe(1);
    expect(n('B').transitiveDependents).toBe(1);
  });
});

describe('analyzeGraph — robustness', () => {
  it('ignores edges that reference unknown keys', () => {
    const { n, a } = analyze(['A', 'B'], [edge('A', 'B'), edge('A', 'GHOST'), edge('GHOST', 'B')]);
    expect(n('A').directDependents).toBe(1);
    expect(a.byKey.has('GHOST')).toBe(false);
  });

  it('collapses duplicate edges and drops self-edges', () => {
    const { n } = analyze(['A', 'B'], [edge('A', 'B'), edge('A', 'B'), edge('A', 'A')]);
    expect(n('A').directDependents).toBe(1);
    expect(n('A').transitiveDependents).toBe(1);
  });

  it('handles an empty graph', () => {
    const a = analyzeGraph([], []);
    expect(a.nodes).toEqual([]);
    expect(a.layerCount).toBe(0);
    expect(a.hasCycle).toBe(false);
    expect(a.leaderboard).toEqual([]);
  });
});
