import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DomainDataset } from '@ecp/shared';
import { Configuration } from './components/Configuration';
import { DependencyGraph } from './components/DependencyGraph';
import { JiraLink } from './components/JiraLink';
import { StatusStrip } from './components/StatusStrip';
import { Timeline } from './components/Timeline';
import { WorkItemList } from './components/WorkItemList';
import { loadDataset, type DatasetSource } from './data/loadDataset';
import { formatDate } from './lib/format';
import { runScenario, scopeEpic, type Scenario } from './lib/projection';

/** Today's date as an ISO `YYYY-MM-DD` string (UTC). */
function currentIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function App() {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; dataset: DomainDataset; source: DatasetSource }
  >({ status: 'loading' });

  useEffect(() => {
    let active = true;
    loadDataset().then(({ dataset, source }) => {
      if (active) setState({ status: 'ready', dataset, source });
    });
    return () => {
      active = false;
    };
  }, []);

  // Silent re-fetch after a config write: swaps the dataset in place without
  // flipping to the loading state, so the current tab/scenario is preserved.
  const reload = useCallback(async () => {
    const { dataset, source } = await loadDataset();
    setState({ status: 'ready', dataset, source });
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="app">
        <div className="panel" data-testid="loading">
          Loading capacity plan…
        </div>
      </div>
    );
  }

  return <Planner dataset={state.dataset} source={state.source} onReload={reload} />;
}

function Planner({
  dataset,
  source,
  onReload,
}: {
  dataset: DomainDataset;
  source: DatasetSource;
  onReload: () => Promise<void>;
}) {
  const epicKey = dataset.epics[0]!.key;
  const scope = useMemo(() => scopeEpic(dataset, epicKey), [dataset, epicKey]);

  // The planning knobs (today / green-buffer / on-call) live on the
  // Configuration tab and are read straight from the persisted defaults below,
  // so the timeline always reflects the current configuration. Cut / mark-done
  // are temporarily removed, so no scenario edits happen on the timeline for now.
  const [selection] = useState<{
    cutItemKeys: Set<string>;
    doneItemKeys: Set<string>;
  }>(() => ({ cutItemKeys: new Set(), doneItemKeys: new Set() }));

  const scenario = useMemo<Scenario>(
    () => ({
      // Demo data pins a reproducible "today"; real data uses the actual date.
      today: scope.planningToday ?? currentIsoDate(),
      cutItemKeys: selection.cutItemKeys,
      doneItemKeys: selection.doneItemKeys,
      greenMinBufferDays: scope.defaults.greenMinBufferDays,
      oncallMultiplier: scope.defaults.oncallMultiplier,
    }),
    [scope, selection],
  );

  const [tab, setTab] = useState<'timeline' | 'dependencies' | 'configuration'>('timeline');
  const result = useMemo(() => runScenario(scope, scenario), [scope, scenario]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Engineering Capacity Planner</h1>
          <div className="epic-title">
            {scope.epic.key} — {scope.epic.title}
            <JiraLink jiraKey={scope.epic.key} />
            {' · '}
            {scope.team.name}
          </div>
        </div>
        <nav className="tabs">
          <button
            type="button"
            className={`tab${tab === 'timeline' ? ' active' : ''}`}
            data-testid="tab-timeline"
            onClick={() => setTab('timeline')}
          >
            Timeline
          </button>
          <button
            type="button"
            className={`tab${tab === 'dependencies' ? ' active' : ''}`}
            data-testid="tab-dependencies"
            onClick={() => setTab('dependencies')}
          >
            Dependencies
          </button>
          <button
            type="button"
            className={`tab${tab === 'configuration' ? ' active' : ''}`}
            data-testid="tab-configuration"
            onClick={() => setTab('configuration')}
          >
            Configuration
          </button>
        </nav>
      </header>

      <div className="source-note" data-testid="data-source" data-source={source}>
        {source === 'api' ? '● Live data from backend API' : '○ Bundled sample data (backend not connected)'}
      </div>

      {tab !== 'configuration' && <StatusStrip result={result} />}

      {tab === 'timeline' && (
        <>
          <div className="panel">
            <Timeline scope={scope} result={result} today={scenario.today} />
            <p className="footnote">
              Gating relevant day: <strong>{scope.gating.name}</strong> on{' '}
              {formatDate(scope.gating.date)}. The projection re-runs on every change below.
            </p>
          </div>

          <div className="panel">
            <WorkItemList scope={scope} scenario={scenario} />
          </div>
        </>
      )}

      {tab === 'dependencies' && <DependencyGraph scope={scope} scenario={scenario} />}

      {tab === 'configuration' && (
        <Configuration
          dataset={dataset}
          teamId={scope.team.id}
          epicKey={epicKey}
          editable={source === 'api'}
          onReload={onReload}
        />
      )}
    </div>
  );
}
