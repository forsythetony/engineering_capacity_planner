import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Central runtime configuration (project plan §7).
 *
 * Every environment-specific value lives here and comes from environment
 * variables so the app is portable: drop a `.env` at the repo root (see
 * `.env.example`), point it at your data source, and run. Nothing is hardcoded.
 *
 * IMPORTANT: the SQLite file is the shareable unit, so **secrets never touch the
 * database**. Jira credentials live only in the environment / `.env`, never in
 * the settings table.
 */

/** Which importer feeds the domain model. */
export type DataSource = 'synthetic' | 'jira';

export interface JiraConfig {
  /** e.g. `https://your-org.atlassian.net`. */
  baseUrl: string | null;
  email: string | null;
  /** API token (secret — env only, never persisted). */
  apiToken: string | null;
  /** Target project key, e.g. `ENG`. */
  projectKey: string | null;
  flavor: 'cloud' | 'server' | null;
  /** Custom field id holding story points, e.g. `customfield_10016`. */
  storyPointsField: string | null;
  /** Issue-link type name that represents "blocks". */
  blocksLinkType: string | null;
}

export interface AppConfig {
  host: string;
  port: number;
  dbPath: string;
  /** `Access-Control-Allow-Origin` value; `*` by default for local dev. */
  corsOrigin: string;
  dataSource: DataSource;
  /** Populate an empty database from the configured importer on startup. */
  seedIfEmpty: boolean;
  /** Deterministic seed for the synthetic importer. */
  syntheticSeed: number;
  jira: JiraConfig;
  /**
   * Demo mode: back the Jira source with an in-memory fake pre-seeded from the
   * synthetic dataset (no real credentials). Lets you exercise the field mapper
   * and Sync in the real app offline. Implies `dataSource: 'jira'`.
   */
  jiraFake: boolean;
}

type Env = Record<string, string | undefined>;

const str = (v: string | undefined, def: string | null = null): string | null =>
  v === undefined || v === '' ? def : v;

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  if (/^(1|true|yes|on)$/i.test(v)) return true;
  if (/^(0|false|no|off)$/i.test(v)) return false;
  return def;
}

function int(v: string | undefined, def: number): number {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function dataSource(v: string | undefined): DataSource {
  const s = (v ?? 'synthetic').toLowerCase();
  if (s === 'synthetic' || s === 'jira') return s;
  throw new Error(`Invalid ECP_DATA_SOURCE "${v}" (expected "synthetic" or "jira")`);
}

function flavor(v: string | undefined): JiraConfig['flavor'] {
  const s = str(v)?.toLowerCase() ?? null;
  if (s === null) return null;
  if (s === 'cloud' || s === 'server') return s;
  throw new Error(`Invalid JIRA_FLAVOR "${v}" (expected "cloud" or "server")`);
}

/** Build the config from an environment map (defaults to `process.env`). */
export function loadConfig(env: Env = process.env): AppConfig {
  return {
    host: str(env.ECP_HOST, '127.0.0.1')!,
    port: int(env.ECP_PORT ?? env.PORT, 3001),
    dbPath: str(env.ECP_DB_PATH, './data/ecp.db')!,
    corsOrigin: str(env.ECP_CORS_ORIGIN, '*')!,
    dataSource: dataSource(env.ECP_DATA_SOURCE),
    seedIfEmpty: bool(env.ECP_SEED_IF_EMPTY, true),
    syntheticSeed: int(env.ECP_SYNTHETIC_SEED, 1),
    jiraFake: bool(env.ECP_JIRA_FAKE, false),
    jira: {
      baseUrl: str(env.JIRA_BASE_URL),
      email: str(env.JIRA_EMAIL),
      apiToken: str(env.JIRA_API_TOKEN),
      projectKey: str(env.JIRA_PROJECT_KEY),
      flavor: flavor(env.JIRA_FLAVOR),
      storyPointsField: str(env.JIRA_STORY_POINTS_FIELD),
      blocksLinkType: str(env.JIRA_BLOCKS_LINK_TYPE),
    },
  };
}

/**
 * Load a `.env` file into `process.env` before reading config, if one exists.
 * Looks at `ECP_ENV_FILE`, then the repo-root `.env`, then the cwd `.env`.
 * A missing file is not an error. Uses Node's built-in parser (no dependency).
 */
export function loadDotenv(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const candidates = [
    process.env.ECP_ENV_FILE,
    resolve(repoRoot, '.env'),
    resolve(process.cwd(), '.env'),
  ].filter((p): p is string => Boolean(p));

  for (const path of candidates) {
    if (existsSync(path)) {
      process.loadEnvFile(path);
      return;
    }
  }
}
