import { useEffect, useMemo, useState } from 'react';
import type { EpicScope, Scenario } from '../lib/projection';
import { buildGraphLayout } from '../lib/graph';
import { GraphCanvas, GraphLegend } from './GraphCanvas';
import { JiraKeyLink } from './JiraLink';

interface GraphModalProps {
  scope: EpicScope;
  scenario: Scenario;
  /** Ticket to open focused on, or `null` for the whole graph. */
  initialFocusKey: string | null;
  onClose: () => void;
}

/**
 * Full-screen view of the complete dependency graph. This is where the whole
 * thing lives now — hover to trace, click to focus a subtree, hide Done, and
 * scroll around with room to breathe — so the inline tab can stay a compact
 * preview of just the top blockers.
 */
export function GraphModal({ scope, scenario, initialFocusKey, onClose }: GraphModalProps) {
  const [focusKey, setFocusKey] = useState<string | null>(initialFocusKey);
  const [hideDone, setHideDone] = useState(false);
  const [showUnconnected, setShowUnconnected] = useState(false);

  const layout = useMemo(
    () => buildGraphLayout(scope, scenario, focusKey, { hideDone }),
    [scope, scenario, focusKey, hideDone],
  );
  const { nodes, analysis, unconnectedKeys } = layout;
  const titleByKey = useMemo(() => new Map(scope.workItems.map((w) => [w.key, w.title])), [scope]);

  // Close on Escape, and lock body scroll while the overlay is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const toggleFocus = (key: string) => setFocusKey((prev) => (prev === key ? null : key));

  return (
    <div className="graph-modal-backdrop" data-testid="graph-modal" onClick={onClose}>
      <div
        className="graph-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Dependency graph"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="graph-modal-head">
          <div className="section-title">
            <h2>Dependency graph</h2>
            <span className="hint">
              Hover a ticket to trace its links · click to focus its subtree.
            </span>
          </div>
          <div className="graph-modal-tools">
            <label className="graph-toggle" data-testid="graph-hide-done">
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
              Hide Done
            </label>
            <button
              type="button"
              className="btn graph-modal-close"
              data-testid="graph-modal-close"
              onClick={onClose}
            >
              Close ✕
            </button>
          </div>
        </div>

        {focusKey && (
          <div className="graph-focus-banner" data-testid="graph-focus-banner">
            <span>
              Focused on <strong>{focusKey}</strong> — {nodes.length} ticket
              {nodes.length === 1 ? '' : 's'} in its subtree (blockers + what it unblocks).
            </span>
            <button type="button" className="btn" data-testid="graph-show-all" onClick={() => setFocusKey(null)}>
              Show whole graph
            </button>
          </div>
        )}

        {analysis.hasCycle && (
          <div className="graph-warning" data-testid="graph-cycle-warning">
            ⚠ Circular dependency detected ({analysis.cycle.join(' → ')} → {analysis.cycle[0]}). Layout is
            best-effort until it's resolved.
          </div>
        )}

        <GraphLegend />

        <div className="graph-modal-body">
          {nodes.length > 0 ? (
            <GraphCanvas layout={layout} onNodeClick={toggleFocus} />
          ) : (
            <p className="hint" data-testid="graph-empty-canvas">
              No dependencies among these tickets — nothing to chart.
            </p>
          )}
        </div>

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
    </div>
  );
}
