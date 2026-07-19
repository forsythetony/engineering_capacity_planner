/**
 * Turn the local (gitignored) Jira sync cache into a shareable obfuscated
 * fixture that other developers can load into FakeJiraClient / the mapper.
 *
 * Workflow:
 *   1. Sync against a real Jira board (`POST /api/sync`) → writes
 *      `<db-dir>/cache/jira-last-sync.json` (not committed).
 *   2. Run this script → writes an anonymized snapshot under
 *      `packages/backend/testdata/` (safe to commit; labels kept, people/titles scrubbed).
 *
 * Usage:
 *   npm run export:obfuscated
 *   npm run export:obfuscated -w @ecp/backend -- --in ../../data/cache/jira-last-sync.json
 *   npm run export:obfuscated -w @ecp/backend -- --from-demo
 *   npm run export:obfuscated -w @ecp/backend -- --out testdata/obfuscated-jira.json
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JiraImporter } from '../importer/jira.js';
import { createDemoJiraClient, DEMO_MAPPING } from '../jira/demo.js';
import { obfuscateSyncCache } from '../jira/obfuscate.js';
import { defaultSyncCachePath, readSyncCache, type JiraSyncCache } from '../jira/sync-cache.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Candidate locations for the last sync cache. The backend's `ECP_DB_PATH`
 * default is `./data/ecp.db`, which resolves relative to the process cwd — when
 * started via `npm run dev -w @ecp/backend` that is `packages/backend/`, so the
 * cache lands next to that DB, not under the repo-root `data/`.
 */
function defaultCacheCandidates(): string[] {
  const fromEnv = process.env.ECP_DB_PATH
    ? defaultSyncCachePath(resolve(backendRoot, process.env.ECP_DB_PATH))
    : null;
  return [
    fromEnv,
    resolve(backendRoot, 'data/cache/jira-last-sync.json'),
    resolve(repoRoot, 'data/cache/jira-last-sync.json'),
  ].filter((p): p is string => Boolean(p));
}

function resolveInputCache(explicit: string | null): string | null {
  if (explicit) return explicit;
  for (const candidate of defaultCacheCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return defaultCacheCandidates()[0] ?? null;
}

function parseArgs(argv: string[]) {
  const args = {
    in: null as string | null,
    out: resolve(backendRoot, 'testdata/obfuscated-jira.json'),
    fromDemo: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') args.in = resolve(process.cwd(), argv[++i]!);
    else if (a === '--out') args.out = resolve(process.cwd(), argv[++i]!);
    else if (a === '--from-demo') args.fromDemo = true;
  }
  return args;
}

/** Build a cache by syncing the offline demo board (no credentials). */
async function cacheFromDemo(): Promise<JiraSyncCache> {
  const client = await createDemoJiraClient();
  const mapping = { ...DEMO_MAPPING, epicKey: null as string | null };
  const epics = await client.searchJql({
    jql: `project = "${mapping.projectKey}" AND issuetype = Epic ORDER BY created ASC`,
    fields: ['summary'],
    maxResults: 1,
  });
  const epicKey = epics.issues[0]?.key;
  if (!epicKey) throw new Error('Demo board has no epic');
  mapping.epicKey = epicKey;

  const dir = mkdtempSync(join(tmpdir(), 'ecp-demo-cache-'));
  const cachePath = join(dir, 'jira-last-sync.json');
  try {
    await new JiraImporter(client, mapping, { cachePath }).fetch();
    return readSyncCache(cachePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));

let cache: JiraSyncCache;
if (args.fromDemo) {
  cache = await cacheFromDemo();
} else {
  const input = resolveInputCache(args.in);
  if (!input || !existsSync(input)) {
    console.error(
      `No sync cache found.\n` +
        `Looked in:\n${defaultCacheCandidates().map((p) => `  - ${p}`).join('\n')}\n` +
        `Run a Jira sync first, or pass --from-demo / --in <path>.`,
    );
    process.exit(1);
  }
  cache = readSyncCache(input);
  console.log(`Reading sync cache ← ${input}`);
}

const fixture = obfuscateSyncCache(cache);

mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(
  `Wrote obfuscated fixture ` +
    `(${fixture.storyIssues.length} stories, ${fixture.workIssues.length} work items, ` +
    `${fixture.sprints.length} sprints) → ${args.out}`,
);
