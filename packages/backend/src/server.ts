import Fastify from 'fastify';
import { type AppConfig, loadConfig, loadDotenv } from './config.js';
import { openDatabase } from './db/database.js';
import { readDataset, writeDataset } from './db/persist.js';
import { createImporter } from './importer/factory.js';

/**
 * Minimal localhost API serving the domain data to the frontend.
 *
 * All environment-specific behavior comes from {@link AppConfig}; pass a partial
 * override for tests. The database is the source of truth — if it's empty on
 * startup and `seedIfEmpty` is set, it's populated from the configured importer
 * (synthetic today, Jira in Phase 7), so `npm run dev` works with zero setup.
 */
export async function buildServer(overrides: Partial<AppConfig> = {}) {
  const config: AppConfig = { ...loadConfig(), ...overrides };

  const app = Fastify({ logger: true });
  const db = openDatabase({ path: config.dbPath });

  if (config.seedIfEmpty) {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM epic').get() as { n: number };
    if (n === 0) {
      const importer = createImporter(config);
      app.log.info(`Empty database — importing from "${importer.name}" source`);
      writeDataset(db, await importer.fetch());
    }
  }

  // CORS origin is configurable; `*` by default for local dev (read-only API).
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', config.corsOrigin);
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') reply.send();
  });

  app.get('/health', async () => ({ status: 'ok', dataSource: config.dataSource }));

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
  loadDotenv();
  const config = loadConfig();
  buildServer()
    .then((app) => app.listen({ port: config.port, host: config.host }))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
