import { useMemo, useState } from 'react';
import type { EpicScope, Scenario } from '../lib/projection';
import { buildGraphLayout, type LayoutEdge, type LayoutNode } from '../lib/graph';
import { JIRA_ICON_PATHS, JiraKeyLink, jiraIssueHref } from './JiraLink';

interface DependencyGraphProps {
  scope: EpicScope;
  scenario: Scenario;
}

/**
 * Dependencies tab (project plan §6): a left-to-right flowchart of the epic's
 * tickets with "blocked by" edges, high-leverage blockers highlighted, and a
 * ranked list of the tickets that unblock the most downstream work. Clicking a
 * node focuses the graph on that ticket's connected subtree — what unblocks it
 * and what it unblocks. Cut/done state from the timeline scenario is reflected
 * here so both tabs tell the same story.
 */
export function DependencyGraph({ scope, scenario }: DependencyGraphProps) {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [showUnconnected, setShowUnconnected] = useState(false);
  const layout = useMemo(
    () => buildGraphLayout(scope, scenario, focusKey),
    [scope, scenario, focusKey],
  );
  const { nodes, edges, width, height, analysis, unconnectedKeys } = layout;

  const toggleFocus = (key: string) => setFocusKey((prev) => (prev === key ? null : key));

  // The leaderboard is always ranked over the whole epic, not the focused view.
  const fullLeaderboard = useMemo(
    () => buildGraphLayout(scope, scenario, null).analysis.leaderboard,
    [scope, scenario],
  );
  const topBlockers = fullLeaderboard.filter((n) => n.transitiveDependents > 0).slice(0, 5);
  const titleByKey = useMemo(
    () => new Map(scope.workItems.map((w) => [w.key, w.title])),
    [scope],
  );

  if (scope.workItems.length === 0) {
    return (
      <div className="panel" data-testid="dependency-graph">
        <div className="section-title">
          <h2>Dependencies</h2>
        </div>
        <p className="hint">This epic has no work items to graph.</p>
      </div>
    );
  }

  return (
    <>
      <div className="panel" data-testid="dependency-graph">
        <div className="section-title">
          <h2>Dependency graph</h2>
          <span className="hint">
            {focusKey
              ? 'Showing one ticket’s dependency neighbourhood. Click another node to jump, or “Show all”.'
              : 'Arrows point from a blocker to the work it unblocks. Click a ticket to focus on its subtree.'}
          </span>
        </div>

        {focusKey && (
          <div className="graph-focus-banner" data-testid="graph-focus-banner">
            <span>
              Focused on <strong>{focusKey}</strong> — {nodes.length} ticket
              {nodes.length === 1 ? '' : 's'} in its subtree (blockers + what it unblocks).
            </span>
            <button
              type="button"
              className="btn"
              data-testid="graph-show-all"
              onClick={() => setFocusKey(null)}
            >
              Show all
            </button>
          </div>
        )}

        {analysis.hasCycle && (
          <div className="graph-warning" data-testid="graph-cycle-warning">
            ⚠ Circular dependency detected ({analysis.cycle.join(' → ')} → {analysis.cycle[0]}).
            Layout is best-effort until it's resolved.
          </div>
        )}

        <GraphLegend />

        {nodes.length > 0 ? (
          <div className="graph-scroll">
            <svg
              className="dependency-svg"
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label="Ticket dependency graph"
              data-testid="dependency-svg"
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
                <EdgePath key={e.id} edge={e} />
              ))}
              {nodes.map((n) => (
                <GraphNode key={n.key} node={n} onFocus={toggleFocus} />
              ))}
            </svg>
          </div>
        ) : (
          <p className="hint" data-testid="graph-empty-canvas">
            No dependencies between this epic’s tickets — nothing to chart. Every ticket is listed
            below.
          </p>
        )}

        {unconnectedKeys.length > 0 && (
          <div className="graph-unconnected" data-testid="graph-unconnected">
            <button
              type="button"
              className="graph-unconnected-toggle"
              aria-expanded={showUnconnected}
              data-testid="graph-unconnected-toggle"
              onClick={() => setShowUnconnected((prev) => !prev)}
            >
              {showUnconnected ? '▾' : '▸'} {unconnectedKeys.length} unconnected ticket
              {unconnectedKeys.length === 1 ? '' : 's'}
              <span className="hint"> — no blockers, block nothing</span>
            </button>
            {showUnconnected && (
              <ul className="graph-unconnected-grid" data-testid="graph-unconnected-grid">
                {unconnectedKeys.map((key) => (
                  <li key={key} className="graph-unconnected-item">
                    <JiraKeyLink jiraKey={key} />
                    <span className="graph-unconnected-title">{titleByKey.get(key)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="section-title">
          <h2>Work these next</h2>
          <span className="hint">Highest-leverage blockers — finishing them unblocks the most.</span>
        </div>
        <ol className="leverage-list" data-testid="leverage-list">
          {topBlockers.map((n) => (
            <li key={n.key} data-testid={`leverage-${n.key}`}>
              <div
                role="button"
                tabIndex={0}
                className="leverage-row"
                onClick={() => setFocusKey(n.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setFocusKey(n.key);
                  }
                }}
                title={`Focus the graph on ${n.key}`}
              >
                <span className="badge high-leverage">unblocks {n.transitiveDependents}</span>
                <JiraKeyLink jiraKey={n.key} />
                <span className="leverage-title">{titleByKey.get(n.key)}</span>
                <span className="hint">
                  {n.directDependents} direct · {n.transitiveDependents} total
                </span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

function GraphLegend() {
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

/** A cubic Bézier from the blocker's right edge to the blocked node's left edge. */
function EdgePath({ edge }: { edge: LayoutEdge }) {
  const dx = Math.max(28, (edge.x2 - edge.x1) / 2);
  const d = `M ${edge.x1} ${edge.y1} C ${edge.x1 + dx} ${edge.y1}, ${edge.x2 - dx} ${edge.y2}, ${edge.x2} ${edge.y2}`;
  return (
    <path
      d={d}
      className={`dependency-edge${edge.fromHighLeverage ? ' high-leverage' : ''}`}
      markerEnd="url(#arrow)"
      fill="none"
    />
  );
}

function GraphNode({ node, onFocus }: { node: LayoutNode; onFocus: (key: string) => void }) {
  const className = [
    'graph-node',
    `tier-${node.tier}`,
    node.done ? 'is-done' : '',
    node.cut ? 'is-cut' : '',
    node.focused ? 'is-focused' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const metrics = node.transitiveDependents > 0 ? `${node.points}p · ↳${node.transitiveDependents}` : `${node.points}p`;

  return (
    <g
      className={className}
      transform={`translate(${node.x}, ${node.y})`}
      data-testid={`graph-node-${node.key}`}
      data-tier={node.tier}
      onClick={() => onFocus(node.key)}
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
