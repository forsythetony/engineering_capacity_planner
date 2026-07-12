import Fastify from 'fastify';
import { openDatabase } from './db/database.js';
import { readDataset, writeDataset } from './db/persist.js';
import { generateSyntheticDataset } from './importer/synthetic.js';

export interface BuildServerOptions {
  dbPath?: string;
  /** Seed the database with synthetic data if it has no epics. Default true. */
  seedIfEmpty?: boolean;
}

/**
 * Minimal localhost API serving the domain data to the frontend.
 *
 * The database is the source of truth; if it's empty on startup we seed it with
 * the synthetic importer so `npm run dev` works with zero setup. A permissive
 * CORS header lets the Vite dev server (a different origin) fetch directly.
 */
export function buildServer(options: BuildServerOptions = {}) {
  const dbPath = options.dbPath ?? process.env.ECP_DB_PATH ?? './data/ecp.db';
  const seedIfEmpty = options.seedIfEmpty ?? true;

  const app = Fastify({ logger: true });
  const db = openDatabase({ path: dbPath });

  if (seedIfEmpty) {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM epic').get() as { n: number };
    if (n === 0) {
      writeDataset(db, generateSyntheticDataset());
      app.log.info('Seeded empty database with synthetic dataset');
    }
  }

  // Permissive CORS — this is a single-user localhost tool, and read-only today.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') reply.send();
  });

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
