import { useMemo, useState } from 'react';
import { Controls } from './components/Controls';
import { StatusStrip } from './components/StatusStrip';
import { Timeline } from './components/Timeline';
import { WorkItemList } from './components/WorkItemList';
import { loadDataset } from './data/loadDataset';
import { runScenario, scopeEpic, type Scenario } from './lib/projection';

const dataset = loadDataset();

export function App() {
  const epicKey = dataset.epics[0]!.key;
  const scope = useMemo(() => scopeEpic(dataset, epicKey), [epicKey]);

  const initialScenario = (): Scenario => ({
    // Anchor "today" to the team's sprint start so the demo opens mid-plan.
    today: scope.team.sprintAnchorDate,
    cutItemKeys: new Set(),
    doneItemKeys: new Set(),
    greenMinBufferDays: scope.defaults.greenMinBufferDays,
    oncallMultiplier: scope.defaults.oncallMultiplier,
  });

  const [scenario, setScenario] = useState<Scenario>(initialScenario);

  const result = useMemo(() => runScenario(scope, scenario), [scope, scenario]);

  const patch = (p: Partial<Scenario>) => setScenario((s) => ({ ...s, ...p }));

  const toggleInSet = (key: keyof Pick<Scenario, 'cutItemKeys' | 'doneItemKeys'>, itemKey: string) =>
    setScenario((s) => {
      const next = new Set(s[key]);
      next.has(itemKey) ? next.delete(itemKey) : next.add(itemKey);
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
          <span className="tab active">Timeline</span>
          <span className="tab disabled" title="Phase 4">Dependencies</span>
          <span className="tab disabled" title="Phase 5">Configuration</span>
        </nav>
      </header>

      <StatusStrip result={result} />

      <div className="panel">
        <Timeline scope={scope} result={result} today={scenario.today} />
        <p className="footnote">
          Gating relevant day: <strong>{scope.gating.name}</strong> on {scope.gating.date}. The
          projection re-runs on every change below.
        </p>
      </div>

      <div className="panel">
        <Controls scenario={scenario} onChange={patch} onReset={() => setScenario(initialScenario())} />
      </div>

      <div className="panel">
        <WorkItemList
          scope={scope}
          scenario={scenario}
          onToggleCut={(k) => toggleInSet('cutItemKeys', k)}
          onToggleDone={(k) => toggleInSet('doneItemKeys', k)}
        />
      </div>
    </div>
  );
}
