/**
 * Dependency-graph analysis (project plan §6 "Dependencies tab", §8 "Graph
 * tests"). Pure and dataset-agnostic: it operates on opaque node keys plus a
 * list of "blocks" edges, so it can be unit-tested exhaustively and reused by
 * the UI without any React / DB coupling.
 *
 * An edge `{ blocker, blocked }` means `blocker` must finish before `blocked`
 * can start — the same direction as {@link import('@ecp/shared').Dependency}.
 * The high-value output is each node's **leverage**: how many downstream items
 * finishing it would unblock (its transitive-dependent count). That is what the
 * UI highlights so the team always picks up the ticket that frees the most work.
 */

/** A directed "blocks" edge: {@link blocker} must finish before {@link blocked}. */
export interface GraphEdge {
  blocker: string;
  blocked: string;
}

/** Per-node analysis result. */
export interface GraphNodeAnalysis {
  key: string;
  /**
   * 0-based column for a left-to-right layout: the length of the longest chain
   * of blockers ending at this node. Source nodes (no blockers) are layer 0.
   */
  layer: number;
  /** Keys this node directly blocks (its out-neighbours). */
  blocks: string[];
  /** Keys that directly block this node (its in-neighbours). */
  blockedBy: string[];
  /** Count of {@link blocks} — items unblocked the instant this one finishes. */
  directDependents: number;
  /**
   * Distinct downstream items reachable by following "blocks" edges (excluding
   * this node itself). This is the node's **leverage**: finishing it ultimately
   * unblocks this many items.
   */
  transitiveDependents: number;
}

export interface GraphAnalysis {
  /** One entry per input key, in input order. */
  nodes: GraphNodeAnalysis[];
  /** Fast lookup by key. */
  byKey: Map<string, GraphNodeAnalysis>;
  /** Number of columns in the layout (`max layer + 1`; 0 when empty). */
  layerCount: number;
  /** True when the edges contain a cycle (a real DAG has none). */
  hasCycle: boolean;
  /**
   * One set of keys forming a cycle (in traversal order), or `[]` when the
   * graph is acyclic — surfaced so the UI can warn instead of drawing nonsense.
   */
  cycle: string[];
  /**
   * Nodes ranked by leverage, highest first. Ties break by direct dependents,
   * then by key (numeric-aware). Nodes that block nothing are still included
   * (at the bottom) so the list is a complete ordering.
   */
  leaderboard: GraphNodeAnalysis[];
}

/** Numeric-aware key comparison so `CKT-2` sorts before `CKT-10`. */
const byKeyAsc = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true });

/**
 * Analyze a dependency graph: layer nodes for a left-to-right flowchart, count
 * each node's direct and transitive dependents (leverage), detect cycles, and
 * rank nodes by leverage.
 *
 * Edges that reference a key absent from {@link nodeKeys} are ignored, so the
 * caller can pass a scoped node set (e.g. one epic's work items) without first
 * filtering the edge list. Duplicate edges collapse to one.
 */
export function analyzeGraph(nodeKeys: readonly string[], edges: readonly GraphEdge[]): GraphAnalysis {
  const keys = [...new Set(nodeKeys)];
  const present = new Set(keys);

  const blocks = new Map<string, Set<string>>();
  const blockedBy = new Map<string, Set<string>>();
  for (const key of keys) {
    blocks.set(key, new Set());
    blockedBy.set(key, new Set());
  }
  for (const { blocker, blocked } of edges) {
    if (!present.has(blocker) || !present.has(blocked) || blocker === blocked) continue;
    blocks.get(blocker)!.add(blocked);
    blockedBy.get(blocked)!.add(blocker);
  }

  const layer = longestPathLayers(keys, blocks, blockedBy);
  const cycle = findCycle(keys, blocks);

  const nodes: GraphNodeAnalysis[] = keys.map((key) => {
    const outs = [...blocks.get(key)!].sort(byKeyAsc);
    const ins = [...blockedBy.get(key)!].sort(byKeyAsc);
    return {
      key,
      layer: layer.get(key) ?? 0,
      blocks: outs,
      blockedBy: ins,
      directDependents: outs.length,
      transitiveDependents: reachableCount(key, blocks),
    };
  });

  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const layerCount = nodes.reduce((max, n) => Math.max(max, n.layer + 1), 0);

  const leaderboard = [...nodes].sort(
    (a, b) =>
      b.transitiveDependents - a.transitiveDependents ||
      b.directDependents - a.directDependents ||
      byKeyAsc(a.key, b.key),
  );

  return { nodes, byKey, layerCount, hasCycle: cycle.length > 0, cycle, leaderboard };
}

/**
 * Longest-path layering via Kahn's algorithm: a node's layer is one past the
 * deepest of its blockers. Nodes trapped in a cycle never reach in-degree 0 —
 * they keep the layer implied by their non-cyclic predecessors (0 if none), so
 * the function stays total and terminating even on cyclic input.
 */
function longestPathLayers(
  keys: string[],
  blocks: Map<string, Set<string>>,
  blockedBy: Map<string, Set<string>>,
): Map<string, number> {
  const layer = new Map<string, number>(keys.map((k) => [k, 0]));
  const indegree = new Map<string, number>(keys.map((k) => [k, blockedBy.get(k)!.size]));
  const queue = keys.filter((k) => indegree.get(k) === 0);

  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]!;
    const here = layer.get(node)!;
    for (const next of blocks.get(node)!) {
      if (here + 1 > layer.get(next)!) layer.set(next, here + 1);
      const remaining = indegree.get(next)! - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return layer;
}

/** Count distinct nodes reachable from `start` via "blocks" edges (cycle-safe). */
function reachableCount(start: string, blocks: Map<string, Set<string>>): number {
  const seen = new Set<string>();
  const stack = [...blocks.get(start)!];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === start || seen.has(node)) continue;
    seen.add(node);
    for (const next of blocks.get(node)!) stack.push(next);
  }
  return seen.size;
}

/**
 * Return one cycle of keys (traversal order) if the graph has one, else `[]`.
 * Standard white/grey/black DFS: a back-edge to a grey node closes a cycle.
 */
function findCycle(keys: string[], blocks: Map<string, Set<string>>): string[] {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(keys.map((k) => [k, WHITE]));
  const stackPath: string[] = [];

  const visit = (node: string): string[] | null => {
    color.set(node, GREY);
    stackPath.push(node);
    for (const next of blocks.get(node)!) {
      if (color.get(next) === GREY) {
        // Close the loop at the earlier occurrence of `next`.
        return stackPath.slice(stackPath.indexOf(next));
      }
      if (color.get(next) === WHITE) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stackPath.pop();
    color.set(node, BLACK);
    return null;
  };

  for (const key of keys) {
    if (color.get(key) === WHITE) {
      const found = visit(key);
      if (found) return found;
    }
  }
  return [];
}
