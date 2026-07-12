import { describe, expect, it } from 'vitest';
import { loadBundledDataset } from '../src/data/loadDataset';
import { scopeEpic } from '../src/lib/projection';
import { buildGanttView, ganttCell } from '../src/lib/gantt';

const dataset = loadBundledDataset();
const scope = scopeEpic(dataset, dataset.epics[0]!.key);

describe('buildGanttView', () => {
  it('selects the first sprint by default and splits it into week columns', () => {
    const view = buildGanttView(scope, null);
    expect(view.sprint).not.toBeNull();
    // A 14-day sprint → two week columns, each with a verdict.
    expect(view.weeks).toHaveLength(2);
    for (const w of view.weeks) expect(['green', 'yellow', 'red']).toContain(w.verdict);
  });

  it('honours the selected sprint', () => {
    const target = scope.sprints[1]!;
    const view = buildGanttView(scope, target.id);
    expect(view.sprint!.id).toBe(target.id);
  });

  it('derives lanes from labels, biggest subdivision first', () => {
    const view = buildGanttView(scope, scope.sprints[0]!.id);
    expect(view.lanes.length).toBeGreaterThan(0);
    for (let i = 1; i < view.lanes.length; i++) {
      expect(view.lanes[i - 1]!.totalPoints).toBeGreaterThanOrEqual(view.lanes[i]!.totalPoints);
    }
  });

  it("a week's placed load equals the sum of its cells' remaining points", () => {
    const view = buildGanttView(scope, scope.sprints[0]!.id);
    view.weeks.forEach((week) => {
      const cellSum = view.lanes.reduce(
        (sum, lane) => sum + (ganttCell(view, lane.label, week.index)?.points ?? 0),
        0,
      );
      expect(cellSum).toBe(week.placedPoints);
    });
  });

  it('exposes a per-member weekly capacity breakdown for active members', () => {
    const view = buildGanttView(scope, scope.sprints[0]!.id);
    const active = scope.members.filter((m) => m.active);
    expect(view.members).toHaveLength(active.length);
    for (const mc of view.members) {
      expect(mc.perWeek).toHaveLength(view.weeks.length);
      expect(mc.total).toBeGreaterThanOrEqual(0);
    }
  });

  it('lists only unplaced, not-done work in the bag', () => {
    const view = buildGanttView(scope, scope.sprints[0]!.id);
    const placedKeys = new Set(scope.placements.map((p) => p.workItemKey));
    for (const item of view.bag) {
      expect(placedKeys.has(item.key)).toBe(false);
      expect(item.status).not.toBe('Done');
    }
  });
});
