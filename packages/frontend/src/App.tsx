import { useEffect, useMemo, useState } from 'react';
import type { DomainDataset } from '@ecp/shared';
import { Controls } from './components/Controls';
import { DependencyGraph } from './components/DependencyGraph';
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

  if (state.status === 'loading') {
    return (
      <div className="app">
        <div className="panel" data-testid="loading">
          Loading capacity plan…
        </div>
      </div>
    );
  }

  return <Planner dataset={state.dataset} source={state.source} />;
}

function Planner({ dataset, source }: { dataset: DomainDataset; source: DatasetSource }) {
  const epicKey = dataset.epics[0]!.key;
  const scope = useMemo(() => scopeEpic(dataset, epicKey), [dataset, epicKey]);

  const initialScenario = (): Scenario => ({
    // Demo data pins a reproducible "today"; real data uses the actual date.
    today: scope.planningToday ?? currentIsoDate(),
    cutItemKeys: new Set(),
    doneItemKeys: new Set(),
    greenMinBufferDays: scope.defaults.greenMinBufferDays,
    oncallMultiplier: scope.defaults.oncallMultiplier,
  });

  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [tab, setTab] = useState<'timeline' | 'dependencies'>('timeline');
  const result = useMemo(() => runScenario(scope, scenario), [scope, scenario]);

  const patch = (p: Partial<Scenario>) => setScenario((s) => ({ ...s, ...p }));

  const toggleInSet = (key: keyof Pick<Scenario, 'cutItemKeys' | 'doneItemKeys'>, itemKey: string) =>
    setScenario((s) => {
      const next = new Set(s[key]);
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return { ...s, [key]: next };
    });

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Engineering Capacity Planner</h1>
          <div className="epic-title">
            {scope.epic.key} — {scope.epic.title} · {scope.team.name}
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
          <span className="tab disabled" title="Phase 5">
            Configuration
          </span>
        </nav>
      </header>

      <div className="source-note" data-testid="data-source" data-source={source}>
        {source === 'api' ? '● Live data from backend API' : '○ Bundled sample data (backend not connected)'}
      </div>

      <StatusStrip result={result} />

      {tab === 'timeline' ? (
        <>
          <div className="panel">
            <Timeline scope={scope} result={result} today={scenario.today} />
            <p className="footnote">
              Gating relevant day: <strong>{scope.gating.name}</strong> on{' '}
              {formatDate(scope.gating.date)}. The projection re-runs on every change below.
            </p>
          </div>

          <div className="panel">
            <Controls
              scenario={scenario}
              onChange={patch}
              onReset={() => setScenario(initialScenario())}
            />
          </div>

          <div className="panel">
            <WorkItemList
              scope={scope}
              scenario={scenario}
              onToggleCut={(k) => toggleInSet('cutItemKeys', k)}
              onToggleDone={(k) => toggleInSet('doneItemKeys', k)}
            />
          </div>
        </>
      ) : (
        <DependencyGraph scope={scope} scenario={scenario} />
      )}
    </div>
  );
}
