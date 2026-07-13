/**
 * Sync endpoint (project plan §7). `POST /api/sync` re-imports from the
 * configured data source and reconciles the result onto local state, preserving
 * the Gantt placements and capacity config (see {@link reconcileDataset}). This
 * is what the frontend's "Sync" button triggers.
 */
import { SETTING_KEYS } from '@ecp/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/database.js';
import { readDataset, writeDataset } from '../db/persist.js';
import { reconcileDataset } from '../db/reconcile.js';
import { appendSyncLog, readSyncLog } from '../db/sync-log.js';
import { createImporter } from '../importer/factory.js';
import { HttpError } from '../http-error.js';
import type { JiraClient } from '../jira/client.js';
import { MappingError } from '../jira/mapping.js';

/** Stamp the last-successful-sync time (ISO), powering the nav Sync button. */
function recordSyncTime(db: Db, iso: string): void {
  db.prepare(
    `INSERT INTO settings (key, scope, scope_id, value) VALUES (?, 'global', '', ?)
     ON CONFLICT(key, scope, scope_id) DO UPDATE SET value = excluded.value`,
  ).run(SETTING_KEYS.LAST_SYNCED_AT, JSON.stringify(iso));
}

export function registerSyncRoutes(
  app: FastifyInstance,
  db: Db,
  config: AppConfig,
  jiraClient?: JiraClient,
): void {
  app.post('/api/sync', async () => {
    const current = readDataset(db);

    // Field mapping resolves from persisted settings; a misconfiguration is the
    // user's to fix, so surface it as a 400 rather than a 500.
    let incoming;
    try {
      const importer = createImporter(config, current.settings, jiraClient);
      incoming = await importer.fetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof MappingError || /incomplete/i.test(message)) {
        throw new HttpError(400, message);
      }
      // Reached Jira but the fetch failed (auth, network, API error).
      throw new HttpError(502, `Sync failed: ${message}`);
    }

    const { merged, summary, changes } = reconcileDataset(current, incoming);
    writeDataset(db, merged);
    const syncedAt = new Date().toISOString();
    recordSyncTime(db, syncedAt);
    // Record what changed so the sync-log cards can replay it later. writeDataset
    // ran first and never touches sync_log, so this row persists.
    appendSyncLog(db, {
      syncedAt,
      source: config.dataSource,
      summary: summary as unknown as Record<string, number>,
      changes,
    });
    return { source: config.dataSource, summary, changes, syncedAt };
  });

  // The sync-log history, newest first (powers the Configuration tab's cards).
  app.get('/api/sync/log', async () => ({ entries: readSyncLog(db) }));
}
