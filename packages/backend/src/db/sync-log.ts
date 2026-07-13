/**
 * Persistence for the sync log (project plan §7). Each successful
 * `POST /api/sync` appends one {@link SyncLogEntry}; the Configuration tab reads
 * them back as clickable cards. This lives in its own table (not the domain
 * dataset), so the dataset-replacing {@link import('./persist.js').writeDataset}
 * leaves the history untouched.
 */
import { randomUUID } from 'node:crypto';
import type { SyncChange, SyncLogEntry } from '@ecp/shared';
import type { Db } from './database.js';

/** How many entries the log keeps (older rows are pruned on append). */
const MAX_ENTRIES = 50;

export interface NewSyncLogEntry {
  syncedAt: string;
  source: string;
  summary: Record<string, number>;
  changes: SyncChange[];
}

/** Append an entry and prune the log back to {@link MAX_ENTRIES} newest rows. */
export function appendSyncLog(db: Db, entry: NewSyncLogEntry): SyncLogEntry {
  const id = `sync_${randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO sync_log (id, synced_at, source, summary, changes) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, entry.syncedAt, entry.source, JSON.stringify(entry.summary), JSON.stringify(entry.changes));

  // Keep the table bounded: delete everything older than the newest N.
  db.prepare(
    `DELETE FROM sync_log WHERE id NOT IN (
       SELECT id FROM sync_log ORDER BY synced_at DESC, id DESC LIMIT ?
     )`,
  ).run(MAX_ENTRIES);

  return { id, ...entry };
}

/** Read the log back, newest first. */
export function readSyncLog(db: Db, limit = MAX_ENTRIES): SyncLogEntry[] {
  const rows = db
    .prepare(`SELECT * FROM sync_log ORDER BY synced_at DESC, id DESC LIMIT ?`)
    .all(limit) as Array<{ id: string; synced_at: string; source: string; summary: string; changes: string }>;
  return rows.map((r) => ({
    id: r.id,
    syncedAt: r.synced_at,
    source: r.source,
    summary: safeParse<Record<string, number>>(r.summary, {}),
    changes: safeParse<SyncChange[]>(r.changes, []),
  }));
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
