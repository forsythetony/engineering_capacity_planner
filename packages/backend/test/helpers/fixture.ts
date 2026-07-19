/**
 * Shared access to the committed, anonymized Jira sync fixture
 * (`testdata/obfuscated-jira.json`). Any test that wants realistic topology —
 * dozens of stories, work items, sprints, and real "blocks" edges — can pull it
 * here instead of hand-rolling a toy board, so coverage tracks data that looks
 * like a live sync. See `testdata/README.md` for how the file is regenerated.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FakeJiraClient } from '../../src/jira/fake-client.js';
import { fakeClientFromFixture, fixtureFromCache } from '../../src/jira/load-fixture.js';
import type { JiraMapping } from '../../src/jira/mapping.js';
import type { ObfuscatedJiraFixture } from '../../src/jira/obfuscate.js';

/** Absolute path to the committed obfuscated fixture, resolved from this file. */
export const OBFUSCATED_FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../testdata/obfuscated-jira.json',
);

/** Parse the committed obfuscated fixture off disk (fresh copy per call). */
export function loadObfuscatedFixture(): ObfuscatedJiraFixture {
  return JSON.parse(readFileSync(OBFUSCATED_FIXTURE_PATH, 'utf8')) as ObfuscatedJiraFixture;
}

/** The fixture plus a {@link FakeJiraClient} hydrated from it and its mapping. */
export interface ObfuscatedFixtureBundle {
  fixture: ObfuscatedJiraFixture;
  client: FakeJiraClient;
  mapping: JiraMapping;
}

/**
 * Hydrate a fake Jira client from the committed fixture. Pass an already-parsed
 * fixture to reuse one across cases; omit it to read a fresh copy.
 */
export function obfuscatedFixtureClient(
  fixture: ObfuscatedJiraFixture = loadObfuscatedFixture(),
): ObfuscatedFixtureBundle {
  return {
    fixture,
    client: fakeClientFromFixture(fixtureFromCache(fixture)),
    mapping: fixture.mapping,
  };
}
