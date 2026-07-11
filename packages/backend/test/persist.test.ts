import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { readDataset, writeDataset } from '../src/db/persist.js';
import { generateSyntheticDataset } from '../src/importer/synthetic.js';

/** Normalise for order-insensitive comparison (SQLite row order isn't fixed). */
function sortDataset(data: ReturnType<typeof generateSyntheticDataset>) {
  const byKey = <T>(get: (t: T) => string) => (a: T, b: T) => get(a).localeCompare(get(b));
  return {
    teams: [...data.teams].sort(byKey((t) => t.id)),
    members: [...data.members].sort(byKey((m) => m.id)),
    velocityOverrides: [...data.velocityOverrides].sort(byKey((v) => v.id)),
    pto: [...data.pto].sort(byKey((p) => p.id)),
    oncall: [...data.oncall].sort(byKey((o) => o.id)),
    epics: [...data.epics].sort(byKey((e) => e.key)),
    milestones: [...data.milestones].sort(byKey((m) => m.id)),
    stories: [...data.stories].sort(byKey((s) => s.key)),
    workItems: [...data.workItems].sort(byKey((w) => w.key)),
    dependencies: [...data.dependencies].sort(byKey((d) => d.id)),
    settings: [...data.settings].sort(byKey((s) => `${s.key}:${s.scope}:${s.scopeId}`)),
  };
}

describe('writeDataset / readDataset', () => {
  it('round-trips a synthetic dataset losslessly', () => {
    const db = openDatabase();
    const original = generateSyntheticDataset({ seed: 4 });
    writeDataset(db, original);
    const readBack = readDataset(db);
    db.close();
    expect(sortDataset(readBack)).toEqual(sortDataset(original));
  });

  it('preserves boolean and null fields precisely', () => {
    const db = openDatabase();
    const original = generateSyntheticDataset({ seed: 8 });
    writeDataset(db, original);
    const readBack = readDataset(db);
    db.close();

    // Booleans survive the INTEGER 0/1 encoding.
    expect(readBack.members.some((m) => m.active === false)).toBe(true);
    expect(readBack.members.some((m) => m.active === true)).toBe(true);
    expect(readBack.milestones.filter((m) => m.isGating)).toHaveLength(1);

    // Global settings keep a null scopeId (stored as '' in the PK column).
    for (const s of readBack.settings) expect(s.scopeId).toBeNull();

    // Unassigned items round-trip to null, not undefined/empty string.
    const original2 = generateSyntheticDataset({ seed: 8 });
    const unassigned = original2.workItems.filter((w) => w.assigneeId === null).map((w) => w.key);
    for (const key of unassigned) {
      expect(readBack.workItems.find((w) => w.key === key)!.assigneeId).toBeNull();
    }
  });

  it('is idempotent: re-writing replaces rather than duplicating', () => {
    const db = openDatabase();
    writeDataset(db, generateSyntheticDataset({ seed: 1 }));
    writeDataset(db, generateSyntheticDataset({ seed: 1 }));
    const count = db.prepare('SELECT COUNT(*) AS n FROM work_item').get() as { n: number };
    db.close();
    expect(count.n).toBe(50);
  });

  it('re-seeding with a different dataset fully replaces the old one', () => {
    const db = openDatabase();
    writeDataset(db, generateSyntheticDataset({ seed: 1, targetWorkItemCount: 60 }));
    writeDataset(db, generateSyntheticDataset({ seed: 1, targetWorkItemCount: 40 }));
    const count = db.prepare('SELECT COUNT(*) AS n FROM work_item').get() as { n: number };
    db.close();
    expect(count.n).toBe(40);
  });

  it('enforces foreign keys (rejects a dangling reference)', () => {
    const db = openDatabase();
    const bad = generateSyntheticDataset({ seed: 1 });
    bad.dependencies = [
      { id: 'DBAD', blockerItemKey: 'CKT-1', blockedItemKey: 'DOES-NOT-EXIST' },
    ];
    expect(() => writeDataset(db, bad)).toThrow();
    db.close();
  });

  it('rolls back the whole write when one row is invalid', () => {
    const db = openDatabase();
    writeDataset(db, generateSyntheticDataset({ seed: 2 }));
    const bad = generateSyntheticDataset({ seed: 2 });
    bad.workItems[0]!.storyKey = 'NO-SUCH-STORY';
    expect(() => writeDataset(db, bad)).toThrow();
    // Prior contents remain intact (transaction rolled back).
    const count = db.prepare('SELECT COUNT(*) AS n FROM work_item').get() as { n: number };
    expect(count.n).toBe(50);
    db.close();
  });
});
