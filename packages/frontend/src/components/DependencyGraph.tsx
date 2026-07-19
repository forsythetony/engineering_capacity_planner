import { useMemo, useState } from 'react';
import type { EpicScope, Scenario } from '../lib/projection';
import { buildGraphLayout } from '../lib/graph';
import { GraphCanvas } from './GraphCanvas';
import { GraphModal } from './GraphModal';
import { JiraKeyLink } from './JiraLink';

interface DependencyGraphProps {
  scope: EpicScope;
  scenario: Scenario;
}

/** How many top blockers the inline preview shows before "Show all". */
const PREVIEW_LIMIT = 8;

/** Modal target: `null` = closed; an object = open (optionally focused). */
type ModalState = { focusKey: string | null } | null;

/**
 * Dependencies tab (project plan §6). The inline view is a compact preview of
 * just the highest-leverage blockers plus a ranked "work these next" list; the
 * full flowchart — hover to trace, focus a subtree, hide Done — lives in a
 * roomy modal opened via "Show all". Cut/done state from the timeline scenario
 * flows through so both tabs tell the same story.
 */
export function DependencyGraph({ scope, scenario }: DependencyGraphProps) {
  const [modal, setModal] = useState<ModalState>(null);

  const preview = useMemo(
    () => buildGraphLayout(scope, scenario, null, { limit: PREVIEW_LIMIT }),
    [scope, scenario],
  );
  const { analysis, totalConnected, unconnectedKeys } = preview;

  const topBlockers = analysis.leaderboard.filter((n) => n.transitiveDependents > 0).slice(0, 5);
  const titleByKey = useMemo(() => new Map(scope.workItems.map((w) => [w.key, w.title])), [scope]);

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

  const shown = preview.nodes.length;

  return (
    <>
      <div className="panel" data-testid="dependency-graph">
        <div className="section-title">
          <h2>Dependency graph</h2>
          <span className="hint">The highest-leverage blockers. Open the full graph to explore everything.</span>
        </div>

        {analysis.hasCycle && (
          <div className="graph-warning" data-testid="graph-cycle-warning">
            ⚠ Circular dependency detected ({analysis.cycle.join(' → ')} → {analysis.cycle[0]}). Open the full
            graph to inspect it.
          </div>
        )}

        {totalConnected > 0 ? (
          <>
            <div className="graph-preview-head">
              <span className="hint" data-testid="graph-preview-count">
                Showing the {shown} highest-leverage of {totalConnected} connected ticket
                {totalConnected === 1 ? '' : 's'}.
              </span>
              <button
                type="button"
                className="btn"
                data-testid="graph-open-full"
                onClick={() => setModal({ focusKey: null })}
              >
                Show all →
              </button>
            </div>

            <div className="graph-scroll graph-preview-scroll">
              <GraphCanvas
                layout={preview}
                testid="dependency-svg"
                onNodeClick={(key) => setModal({ focusKey: key })}
              />
            </div>

            {unconnectedKeys.length > 0 && (
              <p className="hint graph-preview-unconnected" data-testid="graph-preview-unconnected">
                + {unconnectedKeys.length} ticket{unconnectedKeys.length === 1 ? '' : 's'} with no
                dependencies (see the full graph).
              </p>
            )}
          </>
        ) : (
          <p className="hint" data-testid="graph-empty-canvas">
            No dependencies between this epic’s tickets — nothing to chart.
          </p>
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
                onClick={() => setModal({ focusKey: n.key })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setModal({ focusKey: n.key });
                  }
                }}
                title={`Open ${n.key} in the full graph`}
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

      {modal && (
        <GraphModal
          scope={scope}
          scenario={scenario}
          initialFocusKey={modal.focusKey}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
