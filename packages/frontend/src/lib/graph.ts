import type { WorkItem } from '@ecp/shared';
import { analyzeGraph, type GraphAnalysis, type GraphNodeAnalysis } from '@ecp/engine';
import type { EpicScope, Scenario } from './projection';

/**
 * Frontend layout for the Dependencies tab: it runs the pure engine analysis
 * over one epic's work items + dependencies, then assigns each node an (x, y)
 * box for a left-to-right SVG flowchart and derives the connector endpoints.
 * All positioning math lives here (and is unit-tested); the component only
 * paints what this returns.
 */

/** Leverage banding used to highlight high-value blockers. */
export type LeverageTier = 'high' | 'medium' | 'none';

/** A node's live scenario state, folded in so the graph reflects cuts/done. */
export interface NodeState {
  done: boolean;
  cut: boolean;
}

export interface LayoutNode {
  key: string;
  title: string;
  points: number;
  status: WorkItem['status'];
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
  directDependents: number;
  transitiveDependents: number;
  tier: LeverageTier;
  done: boolean;
  cut: boolean;
  /** True when this is the node the graph is currently focused on. */
  focused: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  /**
   * The routed polyline from the blocker's right edge to the blocked node's left
   * edge. For an edge spanning more than one layer it bends through a waypoint in
   * each intermediate column so it routes around node boxes instead of slicing
   * across them; a single-layer edge is just the two endpoints.
   */
  points: Point[];
  /** True when the source is a high-leverage node (edges drawn emphasized). */
  fromHighLeverage: boolean;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  analysis: GraphAnalysis;
  /** The node the graph is focused on, or `null` when showing everything. */
  focusKey: string | null;
  /**
   * Total connected tickets in the (hide-Done-filtered) graph — i.e. how many
   * nodes the full view would show. When `options.limit` trims the layout to the
   * top blockers, `nodes.length` is the shown count and this is the "of N".
   */
  totalConnected: number;
  /**
   * Work items with no dependency in either direction, lifted off the canvas so
   * the flowchart only shows tickets that actually block or are blocked. The
   * component collapses these into a footer the user can expand. Empty in focus
   * mode (a focused subtree is dependency-connected by construction). Sorted by
   * key (numeric-aware).
   */
  unconnectedKeys: string[];
}

/**
 * The connected subtree of `focusKey`: the node itself, everything that
 * transitively blocks it (its upstream, "what unblocks this"), and everything
 * it transitively blocks (its downstream, "what this unblocks"). Used to filter
 * the graph to one ticket's dependency neighbourhood.
 */
export function subtreeKeys(
  dependencies: readonly { blockerItemKey: string; blockedItemKey: string }[],
  focusKey: string,
): Set<string> {
  const downstream = new Map<string, string[]>(); // blocker -> blocked[]
  const upstream = new Map<string, string[]>(); // blocked -> blocker[]
  for (const d of dependencies) {
    (downstream.get(d.blockerItemKey) ?? downstream.set(d.blockerItemKey, []).get(d.blockerItemKey)!).push(
      d.blockedItemKey,
    );
    (upstream.get(d.blockedItemKey) ?? upstream.set(d.blockedItemKey, []).get(d.blockedItemKey)!).push(
      d.blockerItemKey,
    );
  }

  const keep = new Set<string>([focusKey]);
  const walk = (adj: Map<string, string[]>, start: string): void => {
    const stack = [...(adj.get(start) ?? [])];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (keep.has(node)) continue;
      keep.add(node);
      stack.push(...(adj.get(node) ?? []));
    }
  };
  walk(downstream, focusKey);
  walk(upstream, focusKey);
  return keep;
}

/** Box + spacing geometry. Exported so tests can assert exact coordinates. */
export const GRAPH_GEOMETRY = {
  nodeWidth: 208,
  nodeHeight: 52,
  colGap: 72,
  rowGap: 18,
  padding: 20,
  /** Vertical lane a routed edge reserves when it passes through a column. */
  dummyLaneHeight: 20,
} as const;

/**
 * A node is **high** leverage when finishing it unblocks 3+ downstream items,
 * **medium** for 1–2, and **none** when it blocks nothing. The fixed thresholds
 * read naturally ("unblocks 3+ = high") and keep the banding stable as the
 * scenario changes.
 */
export function leverageTier(transitiveDependents: number): LeverageTier {
  if (transitiveDependents >= 3) return 'high';
  if (transitiveDependents >= 1) return 'medium';
  return 'none';
}

/** Current cut/done state for a work item under a scenario. */
export function nodeState(item: WorkItem, scenario: Scenario): NodeState {
  return {
    cut: scenario.cutItemKeys.has(item.key),
    done: scenario.doneItemKeys.has(item.key) || item.status === 'Done',
  };
}

/**
 * Order nodes within a column: highest leverage first, then most direct
 * dependents, then numeric key — so the tickets worth doing bubble to the top
 * of each column and the eye lands on them.
 */
function withinLayerOrder(a: GraphNodeAnalysis, b: GraphNodeAnalysis): number {
  return (
    b.transitiveDependents - a.transitiveDependents ||
    b.directDependents - a.directDependents ||
    a.key.localeCompare(b.key, undefined, { numeric: true })
  );
}

/** Optional view filters applied before layout. */
export interface LayoutOptions {
  /** Drop Done tickets (and edges touching them) so the view is remaining work. */
  hideDone?: boolean;
  /**
   * Lay out only the top-N connected tickets by leverage (highest-value blockers
   * first) for a compact preview. Node metrics/tiers stay global; ignored in
   * focus mode. Omit to lay out the whole connected graph.
   */
  limit?: number;
}

/** A real node or a routing dummy occupying a slot in some column. */
interface Slot {
  id: string;
  isDummy: boolean;
  layer: number;
  /** Slot ids one layer left / right that this slot connects to. */
  prev: string[];
  next: string[];
  /** Seed order (lower = higher up); real nodes get leverage rank, dummies ∞. */
  seed: number;
}

/** An edge as an ordered slot chain: `[from, ...dummies, to]`, for routing. */
interface EdgeChain {
  id: string;
  from: string;
  to: string;
  chain: string[];
}

interface ColumnLayout {
  orderedLayers: string[][];
  slots: Map<string, Slot>;
  edgeChains: EdgeChain[];
  centerY: Map<string, number>;
  topY: Map<string, number>;
}

/**
 * Build the per-column ordering and vertical coordinates for the layered graph.
 *
 * Long edges get a dummy slot in each column they cross, then a few barycenter
 * sweeps reorder each column toward the average position of its neighbours to
 * cut crossings. The initial order is seeded by leverage (via `withinLayerOrder`)
 * and ties break back to that seed, so high-leverage tickets stay near the top
 * when it costs no extra crossings. Deterministic (no clock/random) so the
 * geometry is unit-testable.
 */
function layoutColumns(
  analysis: GraphAnalysis,
  layerOf: ReadonlyMap<string, number>,
  dummyLaneHeight: number,
  nodeHeight: number,
  rowGap: number,
  padding: number,
): ColumnLayout {
  const layerCount = analysis.layerCount;
  const slots = new Map<string, Slot>();
  const layers: string[][] = Array.from({ length: layerCount }, () => []);

  // Real-node slots, seeded high-to-low by leverage within each column.
  const seedCols: GraphNodeAnalysis[][] = Array.from({ length: layerCount }, () => []);
  for (const n of analysis.nodes) seedCols[n.layer]!.push(n);
  for (const col of seedCols) col.sort(withinLayerOrder);
  let seed = 0;
  for (const col of seedCols) {
    for (const n of col) {
      const s: Slot = { id: n.key, isDummy: false, layer: n.layer, prev: [], next: [], seed: seed++ };
      slots.set(n.key, s);
      layers[n.layer]!.push(n.key);
    }
  }

  // Insert dummies for edges spanning more than one layer; record each chain.
  const edgeChains: EdgeChain[] = [];
  let dummyId = 0;
  for (const node of analysis.nodes) {
    for (const target of node.blocks) {
      const uLayer = node.layer;
      const vLayer = layerOf.get(target)!;
      const chain: string[] = [node.key];
      let prevId = node.key;
      // Only forward, multi-layer edges get dummies; a cycle's back-edge (vLayer
      // <= uLayer) is drawn straight rather than routed.
      for (let L = uLayer + 1; L < vLayer; L++) {
        const id = `__dummy-${dummyId++}`;
        const s: Slot = { id, isDummy: true, layer: L, prev: [prevId], next: [], seed: Number.POSITIVE_INFINITY };
        slots.set(id, s);
        layers[L]!.push(id);
        slots.get(prevId)!.next.push(id);
        chain.push(id);
        prevId = id;
      }
      if (vLayer > uLayer) {
        slots.get(prevId)!.next.push(target);
        slots.get(target)!.prev.push(prevId);
      }
      chain.push(target);
      edgeChains.push({ id: `${node.key}->${target}`, from: node.key, to: target, chain });
    }
  }

  const indexIn = (layer: number): Map<string, number> => {
    const m = new Map<string, number>();
    layers[layer]!.forEach((id, i) => m.set(id, i));
    return m;
  };

  // Sort one layer by the barycenter (mean neighbour index) on a given side.
  // No-neighbour slots keep their current index; ties fall back to seed order.
  const sortLayer = (layer: number, side: 'prev' | 'next', neighborIndex: Map<string, number>) => {
    const pos = new Map(layers[layer]!.map((id, i) => [id, i] as const));
    layers[layer] = [...layers[layer]!]
      .map((id) => {
        const neigh = side === 'prev' ? slots.get(id)!.prev : slots.get(id)!.next;
        const bary =
          neigh.length === 0
            ? pos.get(id)!
            : neigh.reduce((sum, n) => sum + (neighborIndex.get(n) ?? 0), 0) / neigh.length;
        return { id, bary };
      })
      .sort((a, b) => a.bary - b.bary || slots.get(a.id)!.seed - slots.get(b.id)!.seed)
      .map((x) => x.id);
  };

  // A handful of down-then-up sweeps is plenty to settle a graph this size.
  const SWEEPS = 4;
  for (let iter = 0; iter < SWEEPS; iter++) {
    for (let L = 1; L < layerCount; L++) sortLayer(L, 'prev', indexIn(L - 1));
    for (let L = layerCount - 2; L >= 0; L--) sortLayer(L, 'next', indexIn(L + 1));
  }

  // Assign vertical coordinates column by column (real nodes are tall, dummy
  // lanes short), stacking top-to-bottom with a uniform gap.
  const centerY = new Map<string, number>();
  const topY = new Map<string, number>();
  for (let L = 0; L < layerCount; L++) {
    let cursor = padding;
    layers[L]!.forEach((id, row) => {
      const h = slots.get(id)!.isDummy ? dummyLaneHeight : nodeHeight;
      if (row > 0) cursor += rowGap;
      topY.set(id, cursor);
      centerY.set(id, cursor + h / 2);
      cursor += h;
    });
  }

  return { orderedLayers: layers, slots, edgeChains, centerY, topY };
}

/**
 * Build the positioned layout for the epic's dependency graph. When `focusKey`
 * names a work item, the layout is restricted to that ticket's connected
 * subtree (its blockers and everything it unblocks); otherwise the whole epic
 * is laid out. `options.hideDone` drops completed tickets from the canvas.
 */
export function buildGraphLayout(
  scope: EpicScope,
  scenario: Scenario,
  focusKey: string | null = null,
  options: LayoutOptions = {},
): GraphLayout {
  const { nodeWidth, nodeHeight, colGap, rowGap, padding, dummyLaneHeight } = GRAPH_GEOMETRY;

  const hasFocus = focusKey !== null && scope.workItems.some((w) => w.key === focusKey);
  const keep = hasFocus ? subtreeKeys(scope.dependencies, focusKey!) : null;

  const subtreeItems = keep ? scope.workItems.filter((w) => keep.has(w.key)) : scope.workItems;
  const subtreeDeps = keep
    ? scope.dependencies.filter((d) => keep.has(d.blockerItemKey) && keep.has(d.blockedItemKey))
    : scope.dependencies;

  // Optionally drop Done tickets: a finished ticket no longer blocks anything,
  // so hiding it (and its edges) leaves a clean view of the work that remains.
  const scopedItems = options.hideDone
    ? subtreeItems.filter((w) => !nodeState(w, scenario).done)
    : subtreeItems;
  const visibleKeys = new Set(scopedItems.map((w) => w.key));
  const scopedDeps = options.hideDone
    ? subtreeDeps.filter((d) => visibleKeys.has(d.blockerItemKey) && visibleKeys.has(d.blockedItemKey))
    : subtreeDeps;

  // Lift fully-unconnected tickets (no dependency in either direction) off the
  // canvas in the full view — they add boxes and rows but no structure. A
  // focused subtree is already dependency-connected, so we keep it whole there.
  const connectedKeys = new Set<string>();
  for (const d of scopedDeps) {
    connectedKeys.add(d.blockerItemKey);
    connectedKeys.add(d.blockedItemKey);
  }
  const laidOutItems = hasFocus
    ? scopedItems
    : scopedItems.filter((w) => connectedKeys.has(w.key));
  const unconnectedKeys = hasFocus
    ? []
    : scopedItems
        .filter((w) => !connectedKeys.has(w.key))
        .map((w) => w.key)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  // Leverage/cycle/leaderboard are global properties, so analyse the whole
  // connected graph first — even when we only lay out the top-N below, node
  // badges and tiers should reflect what each ticket blocks across the epic.
  const connectedKeysList = laidOutItems.map((w) => w.key);
  const connectedEdges = scopedDeps.map((d) => ({
    blocker: d.blockerItemKey,
    blocked: d.blockedItemKey,
  }));
  const analysis = analyzeGraph(connectedKeysList, connectedEdges);
  const globalByKey = new Map(analysis.nodes.map((n) => [n.key, n] as const));
  const totalConnected = laidOutItems.length;

  // Compact preview: keep only the top-N blockers by leverage (leaderboard is
  // already leverage-ranked) and re-layer just those, with edges among them.
  const trimmed = options.limit != null && !hasFocus && totalConnected > options.limit;
  const visible = trimmed
    ? new Set(analysis.leaderboard.slice(0, options.limit).map((n) => n.key))
    : null;
  const layoutItems = visible ? laidOutItems.filter((w) => visible.has(w.key)) : laidOutItems;
  const items = new Map(layoutItems.map((w) => [w.key, w]));
  const layoutAnalysis = visible
    ? analyzeGraph(
        layoutItems.map((w) => w.key),
        connectedEdges.filter((e) => visible.has(e.blocker) && visible.has(e.blocked)),
      )
    : analysis;

  // ── Sugiyama-style ordering with dummy waypoints ────────────────────────
  // The engine layered nodes by longest blocker chain. Here we (1) drop a dummy
  // slot into every column an edge crosses, (2) order each column to reduce edge
  // crossings (seeded by leverage so important tickets start high), and (3) route
  // each edge through its dummies so long edges bend around node boxes.
  const layerCount = layoutAnalysis.layerCount;
  const layerOf = new Map(layoutAnalysis.nodes.map((n) => [n.key, n.layer] as const));

  const layered = layoutColumns(layoutAnalysis, layerOf, dummyLaneHeight, nodeHeight, rowGap, padding);
  const { orderedLayers, slots, centerY, topY } = layered;

  const columnX = (layer: number) => padding + layer * (nodeWidth + colGap);

  const nodes: LayoutNode[] = [];
  const boxByKey = new Map<string, LayoutNode>();
  for (const node of layoutAnalysis.nodes) {
    const item = items.get(node.key)!;
    // Position from the (possibly trimmed) layout; leverage metrics from global.
    const g = globalByKey.get(node.key) ?? node;
    const layout: LayoutNode = {
      key: node.key,
      title: item.title,
      points: item.points,
      status: item.status,
      layer: node.layer,
      x: columnX(node.layer),
      y: topY.get(node.key)!,
      width: nodeWidth,
      height: nodeHeight,
      directDependents: g.directDependents,
      transitiveDependents: g.transitiveDependents,
      tier: leverageTier(g.transitiveDependents),
      focused: hasFocus && node.key === focusKey,
      ...nodeState(item, scenario),
    };
    nodes.push(layout);
    boxByKey.set(node.key, layout);
  }

  const edgesOut: LayoutEdge[] = layered.edgeChains.map(({ id, from, to, chain }) => {
    const fromBox = boxByKey.get(from)!;
    const toBox = boxByKey.get(to)!;
    const start: Point = { x: fromBox.x + fromBox.width, y: fromBox.y + fromBox.height / 2 };
    const end: Point = { x: toBox.x, y: toBox.y + toBox.height / 2 };
    // Interior chain entries are the dummies; route through each column's centre.
    const mid: Point[] = chain.slice(1, -1).map((dummyId) => ({
      x: columnX(slots.get(dummyId)!.layer) + nodeWidth / 2,
      y: centerY.get(dummyId)!,
    }));
    return {
      id,
      from,
      to,
      points: [start, ...mid, end],
      fromHighLeverage: fromBox.tier === 'high',
    };
  });

  const maxColumnBottom = orderedLayers.reduce((max, layer) => {
    const last = layer[layer.length - 1];
    if (last === undefined) return max;
    const s = slots.get(last)!;
    return Math.max(max, topY.get(last)! + (s.isDummy ? dummyLaneHeight : nodeHeight));
  }, 0);
  const width = layerCount === 0 ? 0 : padding * 2 + layerCount * nodeWidth + (layerCount - 1) * colGap;
  const height = layerCount === 0 ? 0 : maxColumnBottom + padding;

  return {
    nodes,
    edges: edgesOut,
    width,
    height,
    analysis,
    focusKey: hasFocus ? focusKey : null,
    totalConnected,
    unconnectedKeys,
  };
}
