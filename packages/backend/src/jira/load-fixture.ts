/**
 * Load an obfuscated (or raw) Jira sync snapshot into a {@link FakeJiraClient}
 * so tests and offline demos can exercise the real importer path against
 * realistic topology without talking to Atlassian.
 */
import { FakeJiraClient } from './fake-client.js';
import type { JiraMapping } from './mapping.js';
import type { JiraSyncCache } from './sync-cache.js';
import type { JiraIssue } from './types.js';

/** Pieces needed to run {@link datasetFromJira} or seed a fake client. */
export interface LoadedJiraFixture {
  mapping: JiraMapping;
  epicIssue: JiraIssue;
  storyIssues: JiraIssue[];
  workIssues: JiraIssue[];
  sprints: JiraSyncCache['sprints'];
}

/** Normalize either a cache file or an obfuscated fixture into loadable pieces. */
export function fixtureFromCache(cache: JiraSyncCache): LoadedJiraFixture {
  return {
    mapping: cache.mapping,
    epicIssue: cache.epicIssue,
    storyIssues: cache.storyIssues,
    workIssues: cache.workIssues,
    sprints: cache.sprints,
  };
}

/**
 * Hydrate a {@link FakeJiraClient} from a sync snapshot. Issues are inserted
 * with their existing keys/ids (not re-created), so parent links and JQL
 * continue to work for the importer.
 */
export function fakeClientFromFixture(fixture: LoadedJiraFixture): FakeJiraClient {
  const boardId = fixture.mapping.boardId ?? 1;
  const client = new FakeJiraClient({
    boards: [
      {
        id: boardId,
        name: 'Board',
        type: 'scrum',
        location: { projectKey: fixture.mapping.projectKey },
      },
    ],
  });

  const all: JiraIssue[] = [fixture.epicIssue, ...fixture.storyIssues, ...fixture.workIssues];
  for (const issue of all) client.seedIssue(issue);
  client.setSprints(boardId, fixture.sprints);
  return client;
}
