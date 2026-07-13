/**
 * Local-database maintenance endpoints: snapshot the live SQLite file, and
 * import (drag-and-drop restore) an uploaded `.db` over the current data. An
 * import always snapshots the current database first, so a mistaken restore is
 * recoverable from the `*-snapshot-*.db` it leaves behind.
 */
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/database.js';
import { importDatabaseFromBuffer, snapshotDatabase, SnapshotError } from '../db/snapshot.js';
import { HttpError } from '../http-error.js';

/** Upload cap for an imported database (SQLite files stay comfortably small). */
const IMPORT_BODY_LIMIT = 64 * 1024 * 1024;

export function registerDbRoutes(app: FastifyInstance, db: Db, config: AppConfig): void {
  // Raw-bytes upload for the import: the frontend POSTs the file body directly
  // as octet-stream (no multipart dependency). Buffered up to the route limit.
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: IMPORT_BODY_LIMIT },
    (_req, body, done) => done(null, body),
  );

  // Copy the current DB file to a timestamped snapshot beside it.
  app.post('/api/db/snapshot', async () => {
    try {
      const { file } = snapshotDatabase(db, config.dbPath, new Date());
      return { file };
    } catch (err) {
      if (err instanceof SnapshotError) throw new HttpError(400, err.message);
      throw err;
    }
  });

  // Replace the live DB contents with an uploaded `.db`. Snapshots first.
  app.post('/api/db/import', { bodyLimit: IMPORT_BODY_LIMIT }, async (req) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new HttpError(400, 'Empty upload — attach a .db file (Content-Type: application/octet-stream).');
    }

    try {
      // Safety net: back up the current data before we overwrite it (file DBs only).
      const backup = config.dbPath === ':memory:' ? null : snapshotDatabase(db, config.dbPath, new Date()).file;
      const summary = importDatabaseFromBuffer(db, body);
      return { summary, backup };
    } catch (err) {
      if (err instanceof SnapshotError) throw new HttpError(400, err.message);
      throw err;
    }
  });
}
