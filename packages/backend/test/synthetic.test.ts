import { describe, expect, it } from 'vitest';
import { SETTING_KEYS, type DomainDataset } from '@ecp/shared';
import { generateSyntheticDataset, SyntheticImporter } from '../src/importer/synthetic.js';

const gen = (overrides = {}): DomainDataset => generateSyntheticDataset(overrides);

/** Detect a cycle in the dependency graph via DFS colouring. */
function hasCycle(data: DomainDataset): boolean {
  const adj = new Map<string, string[]>();
  for (const d of data.dependencies) {
    (adj.get(d.blockerItemKey) ?? adj.set(d.blockerItemKey, []).get(d.blockerItemKey)!).push(
      d.blockedItemKey,
    );
  }
  const state = new Map<string, 0 | 1 | 2>(); // 0=unseen implicit, 1=visiting, 2=done
  const visit = (node: string): boolean => {
    state.set(node, 1);
    for (const next of adj.get(node) ?? []) {
      const s = state.get(next);
      if (s === 1) return true;
      if (s !== 2 && visit(next)) return true;
    }
    state.set(node, 2);
    return false;
  };
  for (const item of data.workItems) {
    if (state.get(item.key) !== 2 && visit(item.key)) return true;
  }
  return false;
}

/** Count transitive dependents (leverage) for each work item. */
function transitiveDependents(data: DomainDataset): Map<string, number> {
  const blockedBy = new Map<string, string[]>();
  for (const d of data.dependencies) {
    (blockedBy.get(d.blockerItemKey) ?? blockedBy.set(d.blockerItemKey, []).get(d.blockerItemKey)!).push(
      d.blockedItemKey,
    );
  }
  const counts = new Map<string, number>();
  for (const item of data.workItems) {
    const seen = new Set<string>();
    const stack = [...(blockedBy.get(item.key) ?? [])];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...(blockedBy.get(n) ?? []));
    }
    counts.set(item.key, seen.size);
  }
  return counts;
}

describe('generateSyntheticDataset', () => {
  it('generates the requested number of work items (~50 by default)', () => {
    expect(gen().workItems).toHaveLength(50);
    expect(gen({ targetWorkItemCount: 75 }).workItems).toHaveLength(75);
  });

  it('is deterministic for a given seed', () => {
    expect(gen({ seed: 3 })).toEqual(gen({ seed: 3 }));
  });

  it('produces different data for different seeds', () => {
    expect(gen({ seed: 1 })).not.toEqual(gen({ seed: 2 }));
  });

  it('groups every work item under a real story of the epic', () => {
    const data = gen();
    const storyKeys = new Set(data.stories.map((s) => s.key));
    for (const item of data.workItems) {
      expect(storyKeys.has(item.storyKey)).toBe(true);
    }
    for (const story of data.stories) {
      expect(story.epicKey).toBe(data.epics[0]!.key);
    }
  });

  it('is referentially self-consistent (no dangling foreign keys)', () => {
    const data = gen();
    const memberIds = new Set(data.members.map((m) => m.id));
    const itemKeys = new Set(data.workItems.map((w) => w.key));

    for (const item of data.workItems) {
      if (item.assigneeId !== null) expect(memberIds.has(item.assigneeId)).toBe(true);
    }
    for (const dep of data.dependencies) {
      expect(itemKeys.has(dep.blockerItemKey)).toBe(true);
      expect(itemKeys.has(dep.blockedItemKey)).toBe(true);
    }
    for (const rec of [...data.pto, ...data.oncall, ...data.velocityOverrides]) {
      expect(memberIds.has(rec.memberId)).toBe(true);
    }
  });

  it('only assigns work to active members', () => {
    const data = gen();
    const activeIds = new Set(data.members.filter((m) => m.active).map((m) => m.id));
    for (const item of data.workItems) {
      if (item.assigneeId !== null) expect(activeIds.has(item.assigneeId)).toBe(true);
    }
  });

  it('varies point sizes across the allowed set', () => {
    const points = new Set(gen().workItems.map((w) => w.points));
    expect(points.size).toBeGreaterThanOrEqual(3);
    for (const p of points) expect([1, 2, 3, 5, 8]).toContain(p);
  });

  it('varies statuses across the allowed set', () => {
    const statuses = new Set(gen().workItems.map((w) => w.status));
    expect(statuses.size).toBeGreaterThanOrEqual(3);
    for (const s of statuses) {
      expect(['To Do', 'In Progress', 'In Review', 'Done']).toContain(s);
    }
  });

  it('builds a dependency web that is acyclic (a DAG)', () => {
    for (const seed of [1, 2, 3, 42, 99]) {
      expect(hasCycle(gen({ seed }))).toBe(false);
    }
  });

  it('has no self-edges or duplicate dependency edges', () => {
    const data = gen();
    const edges = new Set<string>();
    for (const d of data.dependencies) {
      expect(d.blockerItemKey).not.toBe(d.blockedItemKey);
      const e = `${d.blockerItemKey}->${d.blockedItemKey}`;
      expect(edges.has(e)).toBe(false);
      edges.add(e);
    }
  });

  it('includes a few high-leverage blockers', () => {
    const leverage = transitiveDependents(gen());
    const highLeverage = [...leverage.values()].filter((n) => n >= 5);
    expect(highLeverage.length).toBeGreaterThanOrEqual(1);
  });

  it('has exactly one gating milestone on the epic', () => {
    const data = gen();
    const gating = data.milestones.filter((m) => m.isGating);
    expect(gating).toHaveLength(1);
    expect(gating[0]!.name).toMatch(/QA/);
    for (const m of data.milestones) expect(m.epicKey).toBe(data.epics[0]!.key);
  });

  it('uses the default Tuesday / Mon–Fri cadence', () => {
    const team = gen().teams[0]!;
    expect(team.sprintLengthDays).toBe(14);
    expect(team.sprintStartWeekday).toBe(2); // Tuesday
    expect(team.workingDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('seeds the default global settings including inert Jira mapping stubs', () => {
    const settings = gen().settings;
    const byKey = new Map(settings.map((s) => [s.key, s]));
    expect(JSON.parse(byKey.get(SETTING_KEYS.ONCALL_MULTIPLIER)!.value)).toBe(0.5);
    expect(JSON.parse(byKey.get(SETTING_KEYS.GREEN_MIN_BUFFER_DAYS)!.value)).toBe(5);
    // Jira stubs exist but are inert (null).
    expect(JSON.parse(byKey.get(SETTING_KEYS.JIRA_PROJECT_KEY)!.value)).toBeNull();
    expect(byKey.get(SETTING_KEYS.JIRA_FLAVOR)).toBeDefined();
    for (const s of settings) expect(s.scope).toBe('global');
  });

  it('places the gating milestone after the reference/anchor date', () => {
    const data = gen();
    const anchor = data.teams[0]!.sprintAnchorDate;
    const gating = data.milestones.find((m) => m.isGating)!;
    expect(gating.date > anchor).toBe(true);
  });
});

describe('SyntheticImporter', () => {
  it('implements the importer interface and returns a dataset', async () => {
    const importer = new SyntheticImporter({ seed: 7 });
    expect(importer.name).toBe('synthetic');
    const data = await importer.fetch();
    expect(data.workItems).toHaveLength(50);
    expect(data).toEqual(generateSyntheticDataset({ seed: 7 }));
  });
});
