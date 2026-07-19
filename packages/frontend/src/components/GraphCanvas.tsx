import { useMemo, useState } from 'react';
import type { GraphLayout, LayoutEdge, LayoutNode } from '../lib/graph';
import { JIRA_ICON_PATHS, jiraIssueHref } from './JiraLink';

interface GraphCanvasProps {
  layout: GraphLayout;
  /** Called when a node box is clicked (preview → open modal; modal → focus). */
  onNodeClick: (key: string) => void;
  /** Overrides the SVG's data-testid (defaults to `dependency-svg`). */
  testid?: string;
}

/**
 * The dependency flowchart itself: routed edges + node boxes in one SVG. Owns
 * only its hover-highlight state (purely visual and local), so both the compact
 * inline preview and the full-screen modal can render the same canvas from a
 * {@link GraphLayout} without sharing interaction state.
 */
export function GraphCanvas({ layout, onNodeClick, testid = 'dependency-svg' }: GraphCanvasProps) {
  const { nodes, edges, width, height } = layout;
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  // Undirected adjacency over the visible edges, so hovering a node lights up
  // everything it directly touches (its blockers and what it blocks).
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      let set = m.get(a);
      if (!set) m.set(a, (set = new Set()));
      set.add(b);
    };
    for (const e of edges) {
      link(e.from, e.to);
      link(e.to, e.from);
    }
    return m;
  }, [edges]);

  const litKeys = hoverKey ? new Set([hoverKey, ...(neighbors.get(hoverKey) ?? [])]) : null;

  return (
    <svg
      className={`dependency-svg${hoverKey ? ' has-hover' : ''}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Ticket dependency graph"
      data-testid={testid}
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="edge-arrow" />
        </marker>
      </defs>

      {edges.map((e) => (
        <EdgePath key={e.id} edge={e} lit={hoverKey ? e.from === hoverKey || e.to === hoverKey : null} />
      ))}
      {nodes.map((n) => (
        <GraphNode
          key={n.key}
          node={n}
          onClick={onNodeClick}
          onHover={setHoverKey}
          lit={litKeys ? litKeys.has(n.key) : null}
        />
      ))}
    </svg>
  );
}

export function GraphLegend() {
  return (
    <div className="graph-legend" data-testid="graph-legend">
      <span className="legend-item">
        <span className="swatch tier-high" /> High leverage (unblocks 3+)
      </span>
      <span className="legend-item">
        <span className="swatch tier-medium" /> Some leverage (1–2)
      </span>
      <span className="legend-item">
        <span className="swatch tier-none" /> Blocks nothing
      </span>
      <span className="legend-item">
        <span className="swatch is-done" /> Done
      </span>
    </div>
  );
}

/**
 * A smooth path from the blocker's right edge to the blocked node's left edge,
 * chaining a cubic segment through each routed waypoint so multi-layer edges
 * bend around node boxes.
 */
function EdgePath({ edge, lit }: { edge: LayoutEdge; lit: boolean | null }) {
  const [first, ...rest] = edge.points;
  let d = `M ${first!.x} ${first!.y}`;
  let prev = first!;
  for (const p of rest) {
    const dx = Math.max(24, (p.x - prev.x) / 2);
    d += ` C ${prev.x + dx} ${prev.y}, ${p.x - dx} ${p.y}, ${p.x} ${p.y}`;
    prev = p;
  }
  const className = [
    'dependency-edge',
    edge.fromHighLeverage ? 'high-leverage' : '',
    lit === true ? 'is-lit' : '',
    lit === false ? 'is-dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return <path d={d} className={className} markerEnd="url(#arrow)" fill="none" />;
}

function GraphNode({
  node,
  onClick,
  onHover,
  lit,
}: {
  node: LayoutNode;
  onClick: (key: string) => void;
  onHover: (key: string | null) => void;
  lit: boolean | null;
}) {
  const className = [
    'graph-node',
    `tier-${node.tier}`,
    node.done ? 'is-done' : '',
    node.cut ? 'is-cut' : '',
    node.focused ? 'is-focused' : '',
    lit === true ? 'is-lit' : '',
    lit === false ? 'is-dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const metrics =
    node.transitiveDependents > 0 ? `${node.points}p · ↳${node.transitiveDependents}` : `${node.points}p`;

  return (
    <g
      className={className}
      transform={`translate(${node.x}, ${node.y})`}
      data-testid={`graph-node-${node.key}`}
      data-tier={node.tier}
      onClick={() => onClick(node.key)}
      onMouseEnter={() => onHover(node.key)}
      onMouseLeave={() => onHover(null)}
    >
      <title>
        {node.key} — {node.title}
        {'\n'}
        {node.points} pt · {node.status}
        {'\n'}
        unblocks {node.transitiveDependents} item{node.transitiveDependents === 1 ? '' : 's'} (
        {node.directDependents} direct)
      </title>
      <rect width={node.width} height={node.height} rx={9} className="node-box" />
      <text x={10} y={21} className="node-key">
        {node.key}
        {node.done ? ' ✓' : ''}
      </text>
      <text x={10} y={39} className="node-title">
        {truncate(node.title, 24)}
      </text>
      <text x={node.width - 10} y={39} className="node-metrics" textAnchor="end">
        {metrics}
      </text>
      <NodeJiraLink jiraKey={node.key} x={Math.min(node.width - 24, 13 + node.key.length * 8)} y={8} />
    </g>
  );
}

/** The shared Jira glyph, rendered inline in an SVG node. */
function NodeJiraLink({ jiraKey, x, y }: { jiraKey: string; x: number; y: number }) {
  const scale = 14 / 24;
  return (
    <a
      className="node-jira jira-link"
      href={jiraIssueHref(jiraKey)}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${jiraKey} in Jira`}
      data-testid={`jira-link-${jiraKey}`}
      onClick={(e) => e.stopPropagation()}
    >
      <g transform={`translate(${x}, ${y}) scale(${scale})`}>
        <title>{`Open ${jiraKey} in Jira`}</title>
        {/* Invisible hit target so the whole glyph box is clickable. */}
        <rect x={-2} y={-2} width={28} height={28} fill="transparent" />
        {JIRA_ICON_PATHS.map((d) => (
          <path
            key={d}
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>
    </a>
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
