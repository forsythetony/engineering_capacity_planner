import type { DomainDataset } from '@ecp/shared';
import type { JiraClient } from './client.js';
import type { JiraMapping } from './mapping.js';

export interface PushOptions {
  /** Issue type for the epic. */
  epicType?: string;
  /** Issue type for the story layer. */
  storyType?: string;
  /** Issue type for the work-item layer (kept as Story for portability). */
  workItemType?: string;
  /** Set assignees on work items (needs real accountIds against live Jira). */
  includeAssignee?: boolean;
}

export interface PushResult {
  /** The created epic's Jira key. */
  epicKey: string;
  /** Original domain key → created Jira key, for every issue. */
  keyByOldKey: Map<string, string>;
  storyCount: number;
  workItemCount: number;
  linkCount: number;
}

/**
 * Push a {@link DomainDataset} into Jira through the {@link JiraClient} — the
 * "seed test data into Jira" half of the Phase 7 round-trip (project plan §7).
 * It recreates the epic → stories → work items hierarchy with the mapped
 * story-points field, labels, assignees, "blocks" links, and (via workflow
 * transitions) statuses.
 *
 * Works identically against the in-memory fake (the headless round-trip) and a
 * real Jira site. Statuses are applied with {@link JiraClient.setStatus} after
 * creation because Jira can't set status on create; assignees require real
 * accountIds on live Jira, so `includeAssignee` can be turned off there.
 */
export async function pushDatasetToJira(
  client: JiraClient,
  dataset: DomainDataset,
  mapping: JiraMapping,
  options: PushOptions = {},
): Promise<PushResult> {
  const epicType = options.epicType ?? 'Epic';
  const storyType = options.storyType ?? 'Story';
  const workItemType = options.workItemType ?? 'Story';
  const includeAssignee = options.includeAssignee ?? true;

  const memberName = new Map(dataset.members.map((m) => [m.id, m.name]));
  const keyByOldKey = new Map<string, string>();

  // The dataset is single-epic (the app's working scope).
  const epic = dataset.epics[0];
  if (!epic) throw new Error('pushDatasetToJira: dataset has no epic');
  const createdEpic = await client.createIssue({
    fields: { project: { key: mapping.projectKey }, issuetype: { name: epicType }, summary: epic.title },
  });
  keyByOldKey.set(epic.key, createdEpic.key);

  // Stories under the epic.
  const epicStories = dataset.stories.filter((s) => s.epicKey === epic.key);
  for (const story of epicStories) {
    const created = await client.createIssue({
      fields: {
        project: { key: mapping.projectKey },
        issuetype: { name: storyType },
        summary: story.title,
        parent: { key: createdEpic.key },
      },
    });
    keyByOldKey.set(story.key, created.key);
  }

  // Work items under their stories.
  const storyKeys = new Set(epicStories.map((s) => s.key));
  const epicWorkItems = dataset.workItems.filter((w) => storyKeys.has(w.storyKey));
  for (const item of epicWorkItems) {
    const parentKey = keyByOldKey.get(item.storyKey);
    const fields: Record<string, unknown> = {
      project: { key: mapping.projectKey },
      issuetype: { name: workItemType },
      summary: item.title,
      parent: { key: parentKey },
      [mapping.storyPointsField]: item.points,
    };
    if (mapping.labelsField === 'labels') fields.labels = item.labels ?? [];
    else fields[mapping.labelsField] = item.labels ?? [];
    if (includeAssignee && item.assigneeId) {
      fields.assignee = { accountId: item.assigneeId, displayName: memberName.get(item.assigneeId) };
    }
    const created = await client.createIssue({ fields });
    keyByOldKey.set(item.key, created.key);
    if (item.status !== 'To Do') await client.setStatus(created.key, item.status);
  }

  // "Blocks" links: blocker is the outward end.
  let linkCount = 0;
  for (const dep of dataset.dependencies) {
    const outwardKey = keyByOldKey.get(dep.blockerItemKey);
    const inwardKey = keyByOldKey.get(dep.blockedItemKey);
    if (!outwardKey || !inwardKey) continue;
    await client.createIssueLink({ type: mapping.blocksLinkType, outwardKey, inwardKey });
    linkCount += 1;
  }

  return {
    epicKey: createdEpic.key,
    keyByOldKey,
    storyCount: epicStories.length,
    workItemCount: epicWorkItems.length,
    linkCount,
  };
}
