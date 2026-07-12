import { describe, expect, it } from 'vitest';
import { loadBundledDataset } from '../src/data/loadDataset';
import { effectiveWorkItems, runScenario, scopeEpic, type Scenario } from '../src/lib/projection';

const dataset = loadBundledDataset();
const scope = scopeEpic(dataset, 'CKT');

const baseScenario = (): Scenario => ({
  today: scope.planningToday ?? scope.team.sprintAnchorDate,
  cutItemKeys: new Set(),
  doneItemKeys: new Set(),
  greenMinBufferDays: scope.defaults.greenMinBufferDays,
  oncallMultiplier: scope.defaults.oncallMultiplier,
});

describe('scopeEpic', () => {
  it('scopes to the epic and its gating milestone', () => {
    expect(scope.epic.key).toBe('CKT');
    expect(scope.workItems).toHaveLength(50);
    expect(scope.gating).not.toBeNull();
    expect(scope.gating!.isGating).toBe(true);
    expect(scope.gating!.name).toMatch(/QA/);
    expect(scope.stories.length).toBeGreaterThan(0);
  });
});

describe('runScenario', () => {
  it('opens the default scenario in the yellow band (calibrated fixture)', () => {
    const r = runScenario(scope, baseScenario());
    expect(r.verdict).toBe('yellow');
    expect(r.gatingDate).toBe(scope.gating!.date);
  });

  it('cutting every item empties the plan and turns it green', () => {
    const scenario = { ...baseScenario(), cutItemKeys: new Set(scope.workItems.map((w) => w.key)) };
    const r = runScenario(scope, scenario);
    expect(r.remainingPoints).toBe(0);
    expect(r.projectedDevCompleteDate).toBe(scenario.today);
    expect(r.verdict).toBe('green');
  });

  it('cutting a not-done item reduces remaining points by exactly its size', () => {
    const target = scope.workItems.find((w) => w.status !== 'Done')!;
    const before = runScenario(scope, baseScenario()).remainingPoints;
    const after = runScenario(scope, {
      ...baseScenario(),
      cutItemKeys: new Set([target.key]),
    }).remainingPoints;
    expect(before - after).toBe(target.points);
  });

  it('marking an item done removes it from remaining work', () => {
    const target = scope.workItems.find((w) => w.status !== 'Done')!;
    const scenario = { ...baseScenario(), doneItemKeys: new Set([target.key]) };
    expect(effectiveWorkItems(scope, scenario).find((w) => w.key === target.key)!.status).toBe(
      'Done',
    );
    const after = runScenario(scope, scenario).remainingPoints;
    expect(after).toBe(runScenario(scope, baseScenario()).remainingPoints - target.points);
  });

  it('a stricter green threshold can only downgrade the verdict', () => {
    const relaxed = runScenario(scope, { ...baseScenario(), greenMinBufferDays: 0 });
    const strict = runScenario(scope, { ...baseScenario(), greenMinBufferDays: 999 });
    expect(relaxed.verdict).not.toBe('yellow'); // buffer ≥ 0 ⇒ green (or red if negative)
    expect(strict.verdict).not.toBe('green');
  });

  it('a lower on-call multiplier never finishes earlier', () => {
    const high = runScenario(scope, { ...baseScenario(), oncallMultiplier: 1 });
    const low = runScenario(scope, { ...baseScenario(), oncallMultiplier: 0 });
    expect(low.projectedDevCompleteDate! >= high.projectedDevCompleteDate!).toBe(true);
  });
});
