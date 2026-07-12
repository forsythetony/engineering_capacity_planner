import { describe, expect, it } from 'vitest';
import type { DomainDataset, WorkItem } from '@ecp/shared';
import { buildGraphLayout, GRAPH_GEOMETRY, leverageTier, nodeState } from '../src/lib/graph';
import { scopeEpic, type Scenario } from '../src/lib/projection';
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

  it('lays out one node per work item', () => {
    expect(layout.nodes).toHaveLength(scope.workItems.length);
    const keys = new Set(layout.nodes.map((n) => n.key));
    expect(keys.size).toBe(scope.workItems.length);
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
