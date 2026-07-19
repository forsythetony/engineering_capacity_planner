/**
 * Committed, anonymized Jira sync fixtures for realistic importer / mapper
 * tests. Generate (or refresh) from a local sync cache:
 *
 *   npm run export:obfuscated
 *
 * Or bootstrap without credentials from the offline demo board:
 *
 *   npm run export:obfuscated -w @ecp/backend -- --from-demo
 *
 * The source cache at `./data/cache/jira-last-sync.json` is gitignored and
 * must never be committed — only the obfuscated output in this folder.
 *
 * Load in tests:
 *
 *   import fixture from '../testdata/obfuscated-jira.json' with { type: 'json' };
 *   import { fakeClientFromFixture, fixtureFromCache } from '../src/jira/load-fixture.js';
 *   const client = fakeClientFromFixture(fixtureFromCache(fixture));
 */
