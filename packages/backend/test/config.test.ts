import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createImporter } from '../src/importer/factory.js';

/** Full Jira connection env (secrets); mapping is settings-driven, not env. */
const JIRA_CONNECTION_ENV = {
  ECP_DATA_SOURCE: 'jira',
  JIRA_BASE_URL: 'https://acme.atlassian.net',
  JIRA_EMAIL: 'me@acme.com',
  JIRA_API_TOKEN: 'secret',
  JIRA_PROJECT_KEY: 'ENG',
  JIRA_STORY_POINTS_FIELD: 'customfield_10016',
  JIRA_BLOCKS_LINK_TYPE: 'Blocks',
} as const;

describe('loadConfig', () => {
  it('uses safe defaults for an empty environment', () => {
    const c = loadConfig({});
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(3001);
    expect(c.dbPath).toBe('./data/ecp.db');
    expect(c.corsOrigin).toBe('*');
    expect(c.dataSource).toBe('synthetic');
    expect(c.seedIfEmpty).toBe(true);
    expect(c.syntheticSeed).toBe(1);
    expect(c.jira.baseUrl).toBeNull();
  });

  it('reads and coerces overrides from the environment', () => {
    const c = loadConfig({
      ECP_HOST: '0.0.0.0',
      ECP_PORT: '8080',
      ECP_DB_PATH: '/data/work.db',
      ECP_CORS_ORIGIN: 'https://planner.internal',
      ECP_DATA_SOURCE: 'jira',
      ECP_SEED_IF_EMPTY: 'false',
      ECP_SYNTHETIC_SEED: '7',
      JIRA_BASE_URL: 'https://acme.atlassian.net',
      JIRA_EMAIL: 'me@acme.com',
      JIRA_API_TOKEN: 'secret',
      JIRA_PROJECT_KEY: 'ENG',
      JIRA_FLAVOR: 'cloud',
      JIRA_STORY_POINTS_FIELD: 'customfield_10016',
      JIRA_BLOCKS_LINK_TYPE: 'Blocks',
    });
    expect(c.host).toBe('0.0.0.0');
    expect(c.port).toBe(8080);
    expect(c.dbPath).toBe('/data/work.db');
    expect(c.corsOrigin).toBe('https://planner.internal');
    expect(c.dataSource).toBe('jira');
    expect(c.seedIfEmpty).toBe(false);
    expect(c.syntheticSeed).toBe(7);
    expect(c.jira).toEqual({
      baseUrl: 'https://acme.atlassian.net',
      email: 'me@acme.com',
      apiToken: 'secret',
      projectKey: 'ENG',
      flavor: 'cloud',
      storyPointsField: 'customfield_10016',
      blocksLinkType: 'Blocks',
    });
  });

  it('honours PORT as a fallback for ECP_PORT', () => {
    expect(loadConfig({ PORT: '9000' }).port).toBe(9000);
    expect(loadConfig({ ECP_PORT: '9001', PORT: '9000' }).port).toBe(9001);
  });

  it('rejects an invalid data source and Jira flavor', () => {
    expect(() => loadConfig({ ECP_DATA_SOURCE: 'nope' })).toThrow(/ECP_DATA_SOURCE/);
    expect(() => loadConfig({ JIRA_FLAVOR: 'weird' })).toThrow(/JIRA_FLAVOR/);
  });

  it('parses booleans leniently and falls back on garbage', () => {
    expect(loadConfig({ ECP_SEED_IF_EMPTY: 'yes' }).seedIfEmpty).toBe(true);
    expect(loadConfig({ ECP_SEED_IF_EMPTY: 'off' }).seedIfEmpty).toBe(false);
    expect(loadConfig({ ECP_SEED_IF_EMPTY: 'maybe' }).seedIfEmpty).toBe(true); // default
    expect(loadConfig({ ECP_PORT: 'abc' }).port).toBe(3001); // default
  });
});

describe('createImporter', () => {
  it('returns the synthetic importer by default', () => {
    expect(createImporter(loadConfig({})).name).toBe('synthetic');
  });

  it('builds the Jira importer when the connection is configured', () => {
    const importer = createImporter(loadConfig(JIRA_CONNECTION_ENV));
    expect(importer.name).toBe('jira');
  });

  it('fails fast listing the missing connection secrets', () => {
    // Jira selected but no base URL / email / token in the environment.
    expect(() => createImporter(loadConfig({ ECP_DATA_SOURCE: 'jira' }))).toThrow(
      /Jira connection incomplete.*JIRA_BASE_URL/,
    );
  });

  it('requires the field mapping (from settings or env) before importing', () => {
    // Connection present, but no story-points field mapped anywhere.
    expect(() =>
      createImporter(
        loadConfig({
          ECP_DATA_SOURCE: 'jira',
          JIRA_BASE_URL: 'https://acme.atlassian.net',
          JIRA_EMAIL: 'me@acme.com',
          JIRA_API_TOKEN: 'secret',
        }),
      ),
    ).toThrow(/Jira field mapping incomplete/);
  });
});
