import type { DomainDataset, Importer } from '@ecp/shared';
import { formatIso } from '@ecp/shared';
import type { JiraClient } from '../jira/client.js';
import { datasetFromJira } from '../jira/mapper.js';
import type { JiraMapping } from '../jira/mapping.js';
import { MappingError } from '../jira/mapping.js';
import type { JiraIssue, JiraSprint } from '../jira/types.js';

/** Anchor used only when no imported sprint carries a start date. */
const DEFAULT_FALLBACK_ANCHOR = '2026-01-06';

/** Label field ids requested for any issue layer that can feed Gantt lanes. */
function labelFields(mapping: JiraMapping): string[] {
  const fields = ['labels'];
  if (mapping.labelsField !== 'labels') fields.push(mapping.labelsField);
  return [...new Set(fields)];
}

/** Issue `fields` requested for the parent story layer. */
function storyFields(mapping: JiraMapping): string[] {
  return [...new Set(['summary', 'parent', ...labelFields(mapping)])];
}

/** Issue `fields` requested for the work-item layer. */
function workItemFields(mapping: JiraMapping): string[] {
  const fields = ['summary', 'status', 'assignee', 'parent', 'issuetype', 'issuelinks'];
  fields.push(mapping.storyPointsField, ...labelFields(mapping));
  if (mapping.sprintField) fields.push(mapping.sprintField);
  return [...new Set(fields)];
}

/**
 * Jira data source (project plan §7). Implements the same {@link Importer}
 * contract the engine, timeline, and graph already consume, so swapping the
 * synthetic source for Jira changes nothing downstream.
 *
 * It orchestrates the {@link JiraClient} (real HTTP or the in-memory fake) to
 * pull one epic's subtree + the board's sprints, then hands the raw issues to
 * the pure {@link datasetFromJira} mapper. Hierarchy is read by **parent-chain
 * depth** (epic → children = stories → their children = work items) rather than
 * by issue-type names, so it works across team- and company-managed projects.
 */
export class JiraImporter implements Importer {
  readonly name = 'jira';
  private readonly fallbackAnchorDate: string;

  constructor(
    private readonly client: JiraClient,
    private readonly mapping: JiraMapping,
    options: { fallbackAnchorDate?: string } = {},
  ) {
    this.fallbackAnchorDate = options.fallbackAnchorDate ?? DEFAULT_FALLBACK_ANCHOR;
  }

  /** Follow `nextPageToken` until the last page, collecting every issue. */
  private async searchAll(jql: string, fields: string[]): Promise<JiraIssue[]> {
    const all: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    do {
      const page = await this.client.searchJql({ jql, fields, maxResults: 100, nextPageToken });
      all.push(...page.issues);
      nextPageToken = page.isLast ? undefined : page.nextPageToken;
    } while (nextPageToken);
    return all;
  }

  private async resolveEpicKey(): Promise<string> {
    if (this.mapping.epicKey) return this.mapping.epicKey;
    // No epic pinned: take the first Epic in the project.
    const epics = await this.searchAll(
      `project = "${this.mapping.projectKey}" AND issuetype = Epic ORDER BY created ASC`,
      ['summary'],
    );
    if (epics.length === 0) {
      throw new MappingError(
        `No epic found in project "${this.mapping.projectKey}" — set an epic key in the Jira mapping.`,
      );
    }
    return epics[0]!.key;
  }

  private async fetchSprints(): Promise<JiraSprint[]> {
    let boardId = this.mapping.boardId;
    if (boardId == null) {
      const boards = await this.client.listBoards(this.mapping.projectKey);
      if (boards.length === 0) return [];
      boardId = boards[0]!.id;
    }
    return this.client.listSprints(boardId);
  }

  async fetch(): Promise<DomainDataset> {
    const epicKey = await this.resolveEpicKey();
    const epicIssue = await this.client.getIssue(epicKey, ['summary']);

    const storyIssues = await this.searchAll(`parent = "${epicKey}"`, storyFields(this.mapping));

    let workIssues: JiraIssue[] = [];
    if (storyIssues.length > 0) {
      const inList = storyIssues.map((s) => `"${s.key}"`).join(', ');
      workIssues = await this.searchAll(`parent in (${inList})`, workItemFields(this.mapping));
    }

    const sprints = await this.fetchSprints();

    return datasetFromJira({
      epicIssue,
      storyIssues,
      workIssues,
      sprints,
      mapping: this.mapping,
      fallbackAnchorDate: this.fallbackAnchorDate,
      placementDate: formatIso(new Date()),
    });
  }
}
