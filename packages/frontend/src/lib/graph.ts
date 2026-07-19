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
  /** Row within the layer (0 at top). */
  row: number;
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

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  /** Blocker's right-edge midpoint. */
  x1: number;
  y1: number;
  /** Blocked's left-edge midpoint. */
  x2: number;
  y2: number;
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

/**
 * Build the positioned layout for the epic's dependency graph. When `focusKey`
 * names a work item, the layout is restricted to that ticket's connected
 * subtree (its blockers and everything it unblocks); otherwise the whole epic
 * is laid out.
 */
export function buildGraphLayout(
  scope: EpicScope,
  scenario: Scenario,
  focusKey: string | null = null,
): GraphLayout {
  const { nodeWidth, nodeHeight, colGap, rowGap, padding } = GRAPH_GEOMETRY;

  const hasFocus = focusKey !== null && scope.workItems.some((w) => w.key === focusKey);
  const keep = hasFocus ? subtreeKeys(scope.dependencies, focusKey!) : null;

  const scopedItems = keep ? scope.workItems.filter((w) => keep.has(w.key)) : scope.workItems;
  const scopedDeps = keep
    ? scope.dependencies.filter((d) => keep.has(d.blockerItemKey) && keep.has(d.blockedItemKey))
    : scope.dependencies;

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

  const items = new Map(laidOutItems.map((w) => [w.key, w]));
  const keys = laidOutItems.map((w) => w.key);
  const edges = scopedDeps.map((d) => ({
    blocker: d.blockerItemKey,
    blocked: d.blockedItemKey,
  }));
  const analysis = analyzeGraph(keys, edges);

  // Bucket analysis nodes by layer, ordered within each column.
  const columns: GraphNodeAnalysis[][] = Array.from({ length: analysis.layerCount }, () => []);
  for (const node of analysis.nodes) columns[node.layer]!.push(node);
  for (const col of columns) col.sort(withinLayerOrder);

  const nodes: LayoutNode[] = [];
  const boxByKey = new Map<string, LayoutNode>();
  columns.forEach((col, layer) => {
    col.forEach((node, row) => {
      const item = items.get(node.key)!;
      const layout: LayoutNode = {
        key: node.key,
        title: item.title,
        points: item.points,
        status: item.status,
        layer,
        row,
        x: padding + layer * (nodeWidth + colGap),
        y: padding + row * (nodeHeight + rowGap),
        width: nodeWidth,
        height: nodeHeight,
        directDependents: node.directDependents,
        transitiveDependents: node.transitiveDependents,
        tier: leverageTier(node.transitiveDependents),
        focused: hasFocus && node.key === focusKey,
        ...nodeState(item, scenario),
      };
      nodes.push(layout);
      boxByKey.set(node.key, layout);
    });
  });

  const edgesOut: LayoutEdge[] = [];
  for (const node of analysis.nodes) {
    const from = boxByKey.get(node.key)!;
    for (const target of node.blocks) {
      const to = boxByKey.get(target)!;
      edgesOut.push({
        id: `${node.key}->${target}`,
        from: node.key,
        to: target,
        x1: from.x + from.width,
        y1: from.y + from.height / 2,
        x2: to.x,
        y2: to.y + to.height / 2,
        fromHighLeverage: from.tier === 'high',
      });
    }
  }

  const rows = columns.reduce((max, col) => Math.max(max, col.length), 0);
  const width = analysis.layerCount === 0 ? 0 : padding * 2 + analysis.layerCount * nodeWidth + (analysis.layerCount - 1) * colGap;
  const height = rows === 0 ? 0 : padding * 2 + rows * nodeHeight + (rows - 1) * rowGap;

  return {
    nodes,
    edges: edgesOut,
    width,
    height,
    analysis,
    focusKey: hasFocus ? focusKey : null,
    unconnectedKeys,
  };
}
