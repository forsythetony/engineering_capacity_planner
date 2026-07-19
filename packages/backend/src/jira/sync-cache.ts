/**
 * Local, gitignored cache of the raw Jira payload gathered during Sync.
 *
 * Sync always talks to Jira (or the fake); this file is a side-channel dump so
 * you can later run `npm run export:obfuscated` and produce a shareable
 * anonymized fixture without re-hitting the API. Lives under `./data/cache/`
 * (covered by the repo's `/data/` gitignore rule).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { JiraMapping } from './mapping.js';
import type { JiraIssue, JiraSprint } from './types.js';

/** Schema version for the on-disk cache file. Bump when the shape changes. */
export const JIRA_SYNC_CACHE_VERSION = 1 as const;

/** Raw Jira pieces captured at the end of a successful importer fetch. */
export interface JiraSyncCache {
  version: typeof JIRA_SYNC_CACHE_VERSION;
  /** ISO timestamp when the cache was written. */
  cachedAt: string;
  /** Mapping used for the fetch (no secrets — field ids / keys only). */
  mapping: JiraMapping;
  epicIssue: JiraIssue;
  storyIssues: JiraIssue[];
  workIssues: JiraIssue[];
  sprints: JiraSprint[];
}

/** Default path beside the SQLite DB: `<db-dir>/cache/jira-last-sync.json`. */
export function defaultSyncCachePath(dbPath: string): string | null {
  if (dbPath === ':memory:' || dbPath.startsWith('file:')) return null;
  return resolve(dirname(resolve(dbPath)), 'cache', 'jira-last-sync.json');
}

/** Persist a sync cache atomically enough for local-dev use (mkdir + write). */
export function writeSyncCache(path: string, cache: JiraSyncCache): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`);
}

/** Load a previously written sync cache, or throw if missing/invalid. */
export function readSyncCache(path: string): JiraSyncCache {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<JiraSyncCache>;
  if (raw.version !== JIRA_SYNC_CACHE_VERSION) {
    throw new Error(
      `Unsupported sync cache version ${String(raw.version)} (expected ${JIRA_SYNC_CACHE_VERSION})`,
    );
  }
  if (!raw.epicIssue || !Array.isArray(raw.storyIssues) || !Array.isArray(raw.workIssues)) {
    throw new Error(`Sync cache at ${path} is missing issue payloads`);
  }
  if (!raw.mapping || !Array.isArray(raw.sprints)) {
    throw new Error(`Sync cache at ${path} is missing mapping or sprints`);
  }
  return raw as JiraSyncCache;
}
