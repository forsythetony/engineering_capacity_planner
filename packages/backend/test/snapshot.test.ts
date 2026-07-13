import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/db/database.js';
import { readDataset, writeDataset } from '../src/db/persist.js';
import {
  importDatabaseFromBuffer,
  snapshotDatabase,
  snapshotFilename,
  SnapshotError,
} from '../src/db/snapshot.js';
import { generateSyntheticDataset } from '../src/importer/synthetic.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ecp-snap-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('snapshotFilename', () => {
  it('embeds "snapshot" and a filename-safe timestamp', () => {
    const name = snapshotFilename('/data/ecp.db', new Date('2026-07-13T01:33:00.000Z'));
    expect(name).toBe('ecp-snapshot-2026-07-13T01-33-00.000Z.db');
    expect(name).not.toContain(':');
  });
});

describe('snapshotDatabase', () => {
  it('copies the live DB file to a timestamped snapshot beside it', () => {
    const dbPath = join(dir, 'ecp.db');
    const db = openDatabase({ path: dbPath });
    writeDataset(db, generateSyntheticDataset({ seed: 3 }));

    const { file, path } = snapshotDatabase(db, dbPath, new Date('2026-07-13T01:33:00.000Z'));
    db.close();

    expect(file).toBe('ecp-snapshot-2026-07-13T01-33-00.000Z.db');
    // The snapshot is a readable ECP database with the same data.
    const snap = openDatabase({ path });
    expect(readDataset(snap).workItems.length).toBeGreaterThan(0);
    snap.close();
  });

  it('rejects an in-memory database', () => {
    const db = openDatabase();
    expect(() => snapshotDatabase(db, ':memory:', new Date())).toThrow(SnapshotError);
    db.close();
  });
});

describe('importDatabaseFromBuffer', () => {
  it('replaces the live DB contents with an uploaded database', () => {
    // Build a source DB on disk and grab its bytes.
    const srcPath = join(dir, 'source.db');
    const src = openDatabase({ path: srcPath });
    const dataset = generateSyntheticDataset({ seed: 7 });
    writeDataset(src, dataset);
    src.pragma('wal_checkpoint(TRUNCATE)');
    src.close();
    const bytes = readFileSync(srcPath);

    // Target starts empty.
    const target = openDatabase();
    expect(readDataset(target).epics).toHaveLength(0);

    const summary = importDatabaseFromBuffer(target, bytes);
    expect(summary.epics).toBe(dataset.epics.length);
    expect(summary.workItems).toBe(dataset.workItems.length);
    expect(readDataset(target).workItems).toHaveLength(dataset.workItems.length);
    target.close();
  });

  it('rejects a file that is not SQLite', () => {
    const db = openDatabase();
    expect(() => importDatabaseFromBuffer(db, Buffer.from('not a database'))).toThrow(SnapshotError);
    db.close();
  });

  it('rejects a valid SQLite file that is not an ECP database', () => {
    // A real SQLite file with only an unrelated table (built without the ECP
    // schema) must not import as "empty" and wipe the live data.
    const strayPath = join(dir, 'stray.db');
    const stray = new Database(strayPath);
    stray.exec('CREATE TABLE unrelated (x)');
    stray.close();

    const db = openDatabase();
    writeDataset(db, generateSyntheticDataset({ seed: 5 }));
    const before = readDataset(db).workItems.length;

    expect(() => importDatabaseFromBuffer(db, readFileSync(strayPath))).toThrow(SnapshotError);
    // Live data is untouched.
    expect(readDataset(db).workItems).toHaveLength(before);
    db.close();
  });

  it('leaves temp files behind cleaned up', () => {
    const srcPath = join(dir, 'src2.db');
    const src = openDatabase({ path: srcPath });
    writeDataset(src, generateSyntheticDataset({ seed: 2 }));
    src.pragma('wal_checkpoint(TRUNCATE)');
    src.close();

    const before = readdirSync(tmpdir()).filter((f) => f.startsWith('ecp-import-'));
    const db = openDatabase();
    importDatabaseFromBuffer(db, readFileSync(srcPath));
    db.close();
    const after = readdirSync(tmpdir()).filter((f) => f.startsWith('ecp-import-'));
    expect(after.length).toBeLessThanOrEqual(before.length);
  });
});
