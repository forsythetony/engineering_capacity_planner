import { describe, expect, it } from 'vitest';
import type { Dependency, DomainDataset, WorkItem } from '@ecp/shared';
import {
  buildGraphLayout,
  GRAPH_GEOMETRY,
  leverageTier,
  nodeState,
  subtreeKeys,
  type LayoutEdge,
} from '../src/lib/graph';
import { scopeEpic, type EpicScope, type Scenario } from '../src/lib/projection';
import { loadBundledDataset } from '../src/data/loadDataset';

const dataset = loadBundledDataset();
const epicKey = dataset.epics[0]!.key;
const scope = scopeEpic(dataset, epicKey);

function emptyScenario(over: Partial<Scenario> = {}): Scenario {
  return {
    today: '2026-07-01',
    cutItemKeys: new Set(),
    doneItemKeys: new Set(),
    greenMinBufferDays: 5,
    oncallMultiplier: 0.5,
    ...over,
  };
}

/** A bare To-Do work item with the given key (story wired up by scopeWith). */
function wi(key: string): WorkItem {
  return { key, storyKey: '', title: key, points: 1, status: 'To Do', assigneeId: null };
}

function dep(blocker: string, blocked: string): Dependency {
  return { id: `${blocker}__${blocked}`, blockerItemKey: blocker, blockedItemKey: blocked };
}

/** Scope a hand-built graph onto the bundled epic's first story. */
function scopeWith(workItems: WorkItem[], dependencies: Dependency[]): EpicScope {
  const storyKey = dataset.stories.find((s) => s.epicKey === epicKey)!.key;
  const ds: DomainDataset = {
    ...dataset,
    workItems: workItems.map((w) => ({ ...w, storyKey })),
    dependencies,
  };
  return scopeEpic(ds, epicKey);
}

/** Count crossings among straight (single-layer) edges by endpoint order. */
function countCrossings(edges: readonly LayoutEdge[]): number {
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i]!;
      const b = edges[j]!;
      if (a.x1 !== b.x1 || a.x2 !== b.x2) continue; // only same-span edges
      if (Math.sign(a.y1 - b.y1) * Math.sign(a.y2 - b.y2) < 0) crossings++;
    }
  }
  return crossings;
}

describe('leverageTier', () => {
  it('bands by transitive-dependent count', () => {
    expect(leverageTier(0)).toBe('none');
    expect(leverageTier(1)).toBe('medium');
    expect(leverageTier(2)).toBe('medium');
    expect(leverageTier(3)).toBe('high');
    expect(leverageTier(14)).toBe('high');
  });
});

describe('nodeState', () => {
  const item: WorkItem = {
    key: 'CKT-1',
    storyKey: 'S1',
    title: 'x',
    points: 3,
    status: 'To Do',
    assigneeId: null,
  };

  it('marks done from the scenario or an already-Done status', () => {
    expect(nodeState(item, emptyScenario()).done).toBe(false);
    expect(nodeState(item, emptyScenario({ doneItemKeys: new Set(['CKT-1']) })).done).toBe(true);
    expect(nodeState({ ...item, status: 'Done' }, emptyScenario()).done).toBe(true);
  });

  it('marks cut from the scenario', () => {
    expect(nodeState(item, emptyScenario({ cutItemKeys: new Set(['CKT-1']) })).cut).toBe(true);
  });
});

describe('buildGraphLayout — over the bundled fixture', () => {
  const layout = buildGraphLayout(scope, emptyScenario());

  it('accounts for every work item as either a laid-out node or an unconnected key', () => {
    const laidOut = new Set(layout.nodes.map((n) => n.key));
    const unconnected = new Set(layout.unconnectedKeys);
    // The two sets partition the epic: no overlap, and together they cover it.
    for (const key of laidOut) expect(unconnected.has(key)).toBe(false);
    expect(laidOut.size + unconnected.size).toBe(scope.workItems.length);
    expect(new Set([...laidOut, ...unconnected]).size).toBe(scope.workItems.length);
  });

  it('lays out exactly the tickets that participate in a dependency', () => {
    const connected = new Set<string>();
    for (const d of scope.dependencies) {
      connected.add(d.blockerItemKey);
      connected.add(d.blockedItemKey);
    }
    expect(new Set(layout.nodes.map((n) => n.key))).toEqual(connected);
    // Unconnected keys are exactly the rest, and none appear in any edge.
    for (const key of layout.unconnectedKeys) expect(connected.has(key)).toBe(false);
    expect(layout.unconnectedKeys).toEqual([...layout.unconnectedKeys].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    ));
  });

  it('emits an edge per in-epic dependency', () => {
    expect(layout.edges).toHaveLength(scope.dependencies.length);
  });

  it('surfaces the known high-leverage blockers of the fixture', () => {
    const top = layout.analysis.leaderboard[0]!;
    // CKT-2 blocks 14 items directly in the synthetic fixture.
    expect(top.transitiveDependents).toBeGreaterThanOrEqual(14);
    expect(leverageTier(top.transitiveDependents)).toBe('high');
  });

  it('positions layer-0 nodes in the first column and later layers to the right', () => {
    const { padding, nodeWidth, colGap } = GRAPH_GEOMETRY;
    const layer0 = layout.nodes.filter((n) => n.layer === 0);
    expect(layer0.length).toBeGreaterThan(0);
    for (const n of layer0) expect(n.x).toBe(padding);
    for (const n of layout.nodes) {
      expect(n.x).toBe(padding + n.layer * (nodeWidth + colGap));
    }
  });

  it('sizes the canvas to fit every column and the tallest column', () => {
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    const maxRight = Math.max(...layout.nodes.map((n) => n.x + n.width));
    expect(layout.width).toBeGreaterThanOrEqual(maxRight);
  });

  it('reflects cut state from the scenario', () => {
    const someKey = scope.workItems[0]!.key;
    const cut = buildGraphLayout(scope, emptyScenario({ cutItemKeys: new Set([someKey]) }));
    expect(cut.nodes.find((n) => n.key === someKey)!.cut).toBe(true);
  });

  it('is acyclic for the synthetic dataset', () => {
    expect(layout.analysis.hasCycle).toBe(false);
  });
});

describe('subtreeKeys', () => {
  // A → B → D, A → C, plus E (blocks nothing near B).  D also blocked by C.
  const deps = [
    { blockerItemKey: 'A', blockedItemKey: 'B' },
    { blockerItemKey: 'B', blockedItemKey: 'D' },
    { blockerItemKey: 'A', blockedItemKey: 'C' },
    { blockerItemKey: 'C', blockedItemKey: 'D' },
    { blockerItemKey: 'X', blockedItemKey: 'Y' }, // unrelated component
  ];

  it('includes the node, its transitive blockers, and its transitive dependents', () => {
    // B: blocker chain up = {A}; unblocks down = {D}. Plus B itself.
    expect(subtreeKeys(deps, 'B')).toEqual(new Set(['B', 'A', 'D']));
  });

  it('for a root, returns the whole reachable downstream', () => {
    expect(subtreeKeys(deps, 'A')).toEqual(new Set(['A', 'B', 'C', 'D']));
  });

  it('for a leaf, returns all of its upstream blockers', () => {
    expect(subtreeKeys(deps, 'D')).toEqual(new Set(['D', 'B', 'C', 'A']));
  });

  it('excludes unrelated components', () => {
    expect(subtreeKeys(deps, 'B').has('X')).toBe(false);
  });
});

describe('buildGraphLayout — focus mode', () => {
  it('restricts nodes to the focused ticket’s subtree and flags it', () => {
    const top = buildGraphLayout(scope, emptyScenario()).analysis.leaderboard[0]!;
    const focused = buildGraphLayout(scope, emptyScenario(), top.key);

    const expected = subtreeKeys(scope.dependencies, top.key);
    expect(new Set(focused.nodes.map((n) => n.key))).toEqual(expected);
    expect(focused.focusKey).toBe(top.key);
    expect(focused.nodes.find((n) => n.key === top.key)!.focused).toBe(true);
    // Every edge stays inside the subtree.
    for (const e of focused.edges) {
      expect(expected.has(e.from)).toBe(true);
      expect(expected.has(e.to)).toBe(true);
    }
  });

  it('ignores an unknown focus key and shows the whole epic', () => {
    const full = buildGraphLayout(scope, emptyScenario());
    const bogus = buildGraphLayout(scope, emptyScenario(), 'NOPE-999');
    expect(bogus.nodes).toHaveLength(full.nodes.length);
    expect(bogus.focusKey).toBeNull();
  });
});

describe('buildGraphLayout — unconnected tickets', () => {
  it('lifts a ticket with no dependencies off the canvas into unconnectedKeys', () => {
    const storyKey = scope.stories[0]!.key;
    const loner: WorkItem = {
      key: 'LONER-1',
      storyKey,
      title: 'Standalone chore',
      points: 2,
      status: 'To Do',
      assigneeId: null,
    };
    const withLoner: DomainDataset = { ...dataset, workItems: [...dataset.workItems, loner] };
    const layout = buildGraphLayout(scopeEpic(withLoner, epicKey), emptyScenario());

    expect(layout.unconnectedKeys).toContain('LONER-1');
    expect(layout.nodes.find((n) => n.key === 'LONER-1')).toBeUndefined();
  });

  it('does not collapse anything in focus mode (a subtree is already connected)', () => {
    const top = buildGraphLayout(scope, emptyScenario()).analysis.leaderboard[0]!;
    const focused = buildGraphLayout(scope, emptyScenario(), top.key);
    expect(focused.unconnectedKeys).toEqual([]);
  });
});

describe('buildGraphLayout — hideDone option', () => {
  it('drops Done tickets and any edges touching them', () => {
    const doneKey = scope.workItems.find((w) => w.status === 'Done')?.key;
    // The bundled fixture is expected to contain at least one Done ticket.
    expect(doneKey).toBeDefined();

    const shown = buildGraphLayout(scope, emptyScenario(), null, { hideDone: true });
    const shownKeys = new Set([...shown.nodes.map((n) => n.key), ...shown.unconnectedKeys]);
    expect(shownKeys.has(doneKey!)).toBe(false);
    // No surviving node is Done, and no edge references a hidden ticket.
    for (const n of shown.nodes) expect(n.done).toBe(false);
    for (const e of shown.edges) {
      expect(shownKeys.has(e.from)).toBe(true);
      expect(shownKeys.has(e.to)).toBe(true);
    }
  });

  it('also honours scenario-level done keys, not just Done status', () => {
    const target = scope.workItems.find((w) => w.status !== 'Done')!.key;
    const scenario = emptyScenario({ doneItemKeys: new Set([target]) });
    const shown = buildGraphLayout(scope, scenario, null, { hideDone: true });
    expect(shown.nodes.find((n) => n.key === target)).toBeUndefined();
    expect(shown.unconnectedKeys).not.toContain(target);
  });
});

describe('buildGraphLayout — waypoint routing (phase 3)', () => {
  it('routes a multi-layer edge through a waypoint in each crossed column', () => {
    // Chain A→B→C→D (layers 0..3) plus a long A→D spanning three layers.
    const layout = buildGraphLayout(
      scopeWith(['A', 'B', 'C', 'D'].map(wi), [
        dep('A', 'B'),
        dep('B', 'C'),
        dep('C', 'D'),
        dep('A', 'D'),
      ]),
      emptyScenario(),
    );

    const { padding, nodeWidth, colGap } = GRAPH_GEOMETRY;
    const colCenter = (layer: number) => padding + layer * (nodeWidth + colGap) + nodeWidth / 2;

    const long = layout.edges.find((e) => e.from === 'A' && e.to === 'D')!;
    expect(long.points).toHaveLength(4); // start + 2 dummy waypoints + end
    expect(long.points[1]!.x).toBeCloseTo(colCenter(1));
    expect(long.points[2]!.x).toBeCloseTo(colCenter(2));

    // A single-layer edge stays a straight two-point segment.
    const short = layout.edges.find((e) => e.from === 'A' && e.to === 'B')!;
    expect(short.points).toHaveLength(2);
  });
});

describe('buildGraphLayout — crossing reduction (phase 3)', () => {
  it('reorders a column to remove an obvious edge crossing', () => {
    // X→Q and Y→P. Seeded by key the columns are [X,Y] / [P,Q], which crosses;
    // the barycenter sweep should flip layer 1 to [Q,P] so both edges run flat.
    const layout = buildGraphLayout(
      scopeWith(['X', 'Y', 'P', 'Q'].map(wi), [dep('X', 'Q'), dep('Y', 'P')]),
      emptyScenario(),
    );
    const y = (key: string) => layout.nodes.find((n) => n.key === key)!.y;

    expect(y('Q')).toBeLessThan(y('P')); // the swap happened
    expect(countCrossings(layout.edges)).toBe(0); // and the crossing is gone
  });

  it('keeps a naturally-ordered graph crossing-free', () => {
    const layout = buildGraphLayout(
      scopeWith(['A', 'B', 'C', 'D'].map(wi), [dep('A', 'C'), dep('B', 'D')]),
      emptyScenario(),
    );
    expect(countCrossings(layout.edges)).toBe(0);
  });
});

describe('buildGraphLayout — empty epic', () => {
  it('returns an empty, zero-size layout', () => {
    const emptyDataset: DomainDataset = { ...dataset, workItems: [], dependencies: [] };
    const emptyScope = scopeEpic(emptyDataset, epicKey);
    const layout = buildGraphLayout(emptyScope, emptyScenario());
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });
});
