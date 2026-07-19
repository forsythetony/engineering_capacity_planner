/**
 * End-to-end coverage over the committed, anonymized Jira sync fixture.
 *
 * The other Jira tests exercise hand-built toy boards (a handful of issues); this
 * suite drives the *whole* realistic snapshot — dozens of stories, work items,
 * sprints, and real "blocks" edges — through the full pipeline (importer →
 * dataset → graph → DB round-trip → reconcile) and asserts the invariants that
 * only show up at scale. That keeps the fixture load-bearing: if a change breaks
 * on real-world topology, a test fails instead of the app.
 */
import { describe, expect, it } from 'vitest';
import { analyzeGraph, type GraphEdge } from '@ecp/engine';
import type { DomainDataset } from '@ecp/shared';
import { openDatabase } from '../src/db/database.js';
import { readDataset, writeDataset } from '../src/db/persist.js';
import { reconcileDataset } from '../src/db/reconcile.js';
import { JiraImporter } from '../src/importer/jira.js';
import { datasetFromJira } from '../src/jira/mapper.js';
import { loadObfuscatedFixture, obfuscatedFixtureClient } from './helpers/fixture.js';

const fixture = loadObfuscatedFixture();

/** Import the committed fixture through the real importer path. */
async function importFixture(): Promise<DomainDataset> {
  const { client, mapping } = obfuscatedFixtureClient(fixture);
  return new JiraImporter(client, mapping).fetch();
}

describe('obfuscated Jira fixture — realistic dataset', () => {
  it('is a non-trivial snapshot (guards against a truncated/regenerated file)', () => {
    expect(fixture.note).toMatch(/anonymized/i);
    expect(fixture.storyIssues.length).toBeGreaterThan(20);
    expect(fixture.workIssues.length).toBeGreaterThan(20);
    expect(fixture.sprints.length).toBeGreaterThan(10);
  });

  it('imports into a self-consistent dataset with full referential integrity', async () => {
    const ds = await importFixture();

    // Counts track the fixture, so a shape regression surfaces here.
    expect(ds.epics).toHaveLength(1);
    expect(ds.epics[0]?.key).toBe(fixture.mapping.epicKey);
    expect(ds.workItems).toHaveLength(fixture.workIssues.length);
    expect(ds.sprints.length).toBeGreaterThan(0);
    expect(ds.members.length).toBeGreaterThan(0);

    const storyKeys = new Set(ds.stories.map((s) => s.key));
    const workItemKeys = new Set(ds.workItems.map((w) => w.key));
    const memberIds = new Set(ds.members.map((m) => m.id));
    const sprintIds = new Set(ds.sprints.map((s) => s.id));

    // Every work item hangs off a real story and (if assigned) a real member.
    for (const w of ds.workItems) {
      expect(storyKeys.has(w.storyKey)).toBe(true);
      if (w.assigneeId) expect(memberIds.has(w.assigneeId)).toBe(true);
      expect(w.points).toBeGreaterThanOrEqual(0);
    }

    // Every dependency endpoint resolves to a known work item (no dangling edges).
    expect(ds.dependencies.length).toBeGreaterThan(0);
    for (const dep of ds.dependencies) {
      expect(workItemKeys.has(dep.blockerItemKey)).toBe(true);
      expect(workItemKeys.has(dep.blockedItemKey)).toBe(true);
      expect(dep.blockerItemKey).not.toBe(dep.blockedItemKey);
    }
    // Dependency ids are unique.
    expect(new Set(ds.dependencies.map((d) => d.id)).size).toBe(ds.dependencies.length);

    // Every suggested placement points at a real, non-Done work item and sprint.
    const doneKeys = new Set(ds.workItems.filter((w) => w.status === 'Done').map((w) => w.key));
    for (const p of ds.placements) {
      expect(workItemKeys.has(p.workItemKey)).toBe(true);
      expect(sprintIds.has(p.sprintId)).toBe(true);
      expect(doneKeys.has(p.workItemKey)).toBe(false);
      expect(p.weekIndex).toBeGreaterThanOrEqual(0);
    }
    // At most one placement per work item.
    expect(new Set(ds.placements.map((p) => p.workItemKey)).size).toBe(ds.placements.length);
  });

  it('produces an acyclic, layerable dependency graph', async () => {
    const ds = await importFixture();
    const edges: GraphEdge[] = ds.dependencies.map((d) => ({
      blocker: d.blockerItemKey,
      blocked: d.blockedItemKey,
    }));
    const analysis = analyzeGraph(
      ds.workItems.map((w) => w.key),
      edges,
    );

    // Real Jira "blocks" links should form a DAG; a cycle means the fixture (or
    // the edge derivation) is inconsistent.
    expect(analysis.hasCycle).toBe(false);
    expect(analysis.cycle).toEqual([]);
    expect(analysis.nodes).toHaveLength(ds.workItems.length);
    expect(analysis.layerCount).toBeGreaterThan(0);
    // The highest-leverage item unblocks at least one downstream item.
    expect(analysis.leaderboard[0]?.transitiveDependents).toBeGreaterThan(0);
  });

  it('survives a full DB write/read round-trip unchanged', async () => {
    const ds = await importFixture();
    const db = openDatabase({ path: ':memory:' });
    try {
      writeDataset(db, ds);
      const loaded = readDataset(db);

      expect(loaded.epics).toEqual(ds.epics);
      expect(loaded.stories.length).toBe(ds.stories.length);
      expect(loaded.workItems.length).toBe(ds.workItems.length);
      expect(loaded.dependencies.length).toBe(ds.dependencies.length);
      expect(loaded.sprints.length).toBe(ds.sprints.length);
      expect(loaded.placements.length).toBe(ds.placements.length);
      // Work items round-trip field-for-field (order-independent).
      const byKey = (arr: DomainDataset['workItems']) =>
        [...arr].sort((a, b) => a.key.localeCompare(b.key));
      expect(byKey(loaded.workItems)).toEqual(byKey(ds.workItems));
    } finally {
      db.close();
    }
  });

  it('maps directly (no client) and pins the anchor to the earliest sprint', () => {
    const ds = datasetFromJira({
      epicIssue: fixture.epicIssue,
      storyIssues: fixture.storyIssues,
      workIssues: fixture.workIssues,
      sprints: fixture.sprints,
      mapping: fixture.mapping,
      fallbackAnchorDate: '2026-01-06',
      placementDate: '2026-07-10',
    });

    expect(ds.workItems).toHaveLength(fixture.workIssues.length);
    const anchor = ds.teams[0]?.sprintAnchorDate;
    const earliest = ds.sprints.reduce<string | null>(
      (min, s) => (min === null || s.startDate < min ? s.startDate : min),
      null,
    );
    expect(anchor).toBe(earliest);
  });

  it('reconciles onto a fresh DB as an all-additive first sync (facts land, no conflicts)', async () => {
    const incoming = await importFixture();
    const db = openDatabase({ path: ':memory:' });
    try {
      const current = readDataset(db); // empty baseline
      const { merged, summary } = reconcileDataset(current, incoming);

      expect(summary.workItems).toBe(incoming.workItems.length);
      expect(summary.dependencies).toBe(incoming.dependencies.length);
      expect(summary.membersAdded).toBe(incoming.members.length);
      expect(summary.placementConflicts).toBe(0);
      expect(summary.placementsDroppedMissingItem).toBe(0);
      expect(summary.placementsDroppedMissingSprint).toBe(0);
      expect(merged.workItems).toHaveLength(incoming.workItems.length);

      // The merged result must itself persist cleanly.
      writeDataset(db, merged);
      expect(readDataset(db).workItems).toHaveLength(incoming.workItems.length);
    } finally {
      db.close();
    }
  });

  it('is idempotent: re-syncing identical Jira facts keeps everything and adds nothing', async () => {
    const first = await importFixture();
    const second = await importFixture();
    const { summary } = reconcileDataset(first, second);

    expect(summary.workItems).toBe(first.workItems.length);
    expect(summary.membersAdded).toBe(0);
    expect(summary.placementsDroppedMissingItem).toBe(0);
    expect(summary.placementsDroppedMissingSprint).toBe(0);
    expect(summary.placementConflicts).toBe(0);
  });
});
