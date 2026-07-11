import Fastify from 'fastify';
import { openDatabase } from './db/database.js';
import { readDataset } from './db/persist.js';

/**
 * Minimal localhost API. Phase 1 exposes just enough to confirm the imported
 * data is queryable; the timeline and capacity endpoints arrive in later
 * phases. The database path is read from `ECP_DB_PATH` (defaults to a local
 * file).
 */
export function buildServer(dbPath = process.env.ECP_DB_PATH ?? './data/ecp.db') {
  const app = Fastify({ logger: true });
  const db = openDatabase({ path: dbPath });

  app.get('/health', async () => ({ status: 'ok' }));

  // Lightweight summary of what's in the database (useful for verification).
  app.get('/api/summary', async () => {
    const data = readDataset(db);
    return {
      teams: data.teams.length,
      members: data.members.length,
      epics: data.epics.map((e) => e.key),
      stories: data.stories.length,
      workItems: data.workItems.length,
      dependencies: data.dependencies.length,
      totalPoints: data.workItems.reduce((sum, w) => sum + w.points, 0),
    };
  });

  app.get('/api/dataset', async () => readDataset(db));

  app.addHook('onClose', async () => {
    db.close();
  });

  return app;
}

// Entry point: `npm start` after a build, or `npm run dev` via tsx.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = buildServer();
  const port = Number(process.env.PORT ?? 3001);
  app.listen({ port, host: '127.0.0.1' }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
