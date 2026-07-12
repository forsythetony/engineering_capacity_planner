import type { DomainDataset, PlannedPlacement, Team, TeamMember } from '@ecp/shared';

/**
 * What a sync did, for the API response / logs.
 */
export interface ReconcileSummary {
  epics: number;
  stories: number;
  workItems: number;
  dependencies: number;
  sprints: number;
  /** Members newly discovered from Jira assignees this sync. */
  membersAdded: number;
  membersTotal: number;
  placementsKept: number;
  /** Completed work pulled from its slot, freeing that week's capacity. */
  placementsPulledDone: number;
  /** Placements dropped because their work item no longer exists in Jira. */
  placementsDroppedMissingItem: number;
  /** Placements dropped because their sprint no longer exists in Jira. */
  placementsDroppedMissingSprint: number;
}

export interface ReconcileResult {
  merged: DomainDataset;
  summary: ReconcileSummary;
}

/**
 * Merge freshly-imported Jira **facts** (`incoming`) onto the local database
 * (`current`), preserving locally-owned **intent** (project plan §7):
 *
 * - **Facts (Jira owns → replaced):** epics, stories, work items, dependencies,
 *   sprints.
 * - **Intent (local owns → preserved):** PTO, on-call, velocity overrides,
 *   milestones ("relevant days"), settings/knobs, team cadence, per-member
 *   base velocity, and — the artifact the whole tool exists for — Gantt
 *   `planned_placement`s.
 *
 * Placement upkeep on sync: a placement is dropped if its work item vanished
 * from Jira or its sprint no longer exists, and a work item that comes back
 * `Done` is auto-pulled from its slot (a finished ticket needs no capacity
 * reservation). Members accrete — a Jira assignee seeds a member, but a member
 * with no current assignments is kept (they carry PTO / velocity config).
 *
 * Pure and deterministic (no DB, no clock): the caller persists `merged` with
 * the usual transactional {@link import('./persist.js').writeDataset}.
 */
export function reconcileDataset(current: DomainDataset, incoming: DomainDataset): ReconcileResult {
  // --- Team: keep local cadence/name; refresh the anchor from synced sprints.
  const currentTeamsById = new Map(current.teams.map((t) => [t.id, t]));
  const mergedTeams: Team[] = [...current.teams];
  for (const inc of incoming.teams) {
    const existing = currentTeamsById.get(inc.id);
    if (existing) {
      existing.sprintAnchorDate = inc.sprintAnchorDate;
    } else {
      mergedTeams.push(inc);
    }
  }

  // --- Members: accrete. Existing members keep local capacity attributes
  //     (base velocity, active); Jira refreshes the display name. New Jira
  //     assignees are added with their imported defaults.
  const mergedMembersById = new Map<string, TeamMember>(current.members.map((m) => [m.id, { ...m }]));
  let membersAdded = 0;
  for (const inc of incoming.members) {
    const existing = mergedMembersById.get(inc.id);
    if (existing) {
      existing.name = inc.name;
    } else {
      mergedMembersById.set(inc.id, inc);
      membersAdded += 1;
    }
  }
  const mergedMembers = [...mergedMembersById.values()];
  const memberIds = new Set(mergedMembers.map((m) => m.id));

  // --- Placements: preserve intent, pruning stale / completed slots.
  const incomingItems = new Map(incoming.workItems.map((w) => [w.key, w]));
  const incomingSprintIds = new Set(incoming.sprints.map((s) => s.id));
  const keptPlacements: PlannedPlacement[] = [];
  let placementsPulledDone = 0;
  let placementsDroppedMissingItem = 0;
  let placementsDroppedMissingSprint = 0;
  for (const p of current.placements) {
    const item = incomingItems.get(p.workItemKey);
    if (!item) {
      placementsDroppedMissingItem += 1;
    } else if (item.status === 'Done') {
      placementsPulledDone += 1;
    } else if (!incomingSprintIds.has(p.sprintId)) {
      placementsDroppedMissingSprint += 1;
    } else {
      keptPlacements.push(p);
    }
  }

  // --- Local intent kept as-is (with FK safety filters).
  const epicKeys = new Set(incoming.epics.map((e) => e.key));
  const milestones = current.milestones.filter((m) => epicKeys.has(m.epicKey));
  const pto = current.pto.filter((p) => memberIds.has(p.memberId));
  const oncall = current.oncall.filter((o) => memberIds.has(o.memberId));
  const velocityOverrides = current.velocityOverrides.filter((v) => memberIds.has(v.memberId));

  // --- Settings: union by identity, local edits win; add any new defaults.
  const settingKey = (s: { key: string; scope: string; scopeId: string | null }) =>
    `${s.scope}::${s.scopeId ?? ''}::${s.key}`;
  const mergedSettings = [...current.settings];
  const haveSetting = new Set(current.settings.map(settingKey));
  for (const s of incoming.settings) {
    if (!haveSetting.has(settingKey(s))) mergedSettings.push(s);
  }

  const merged: DomainDataset = {
    teams: mergedTeams,
    members: mergedMembers,
    velocityOverrides,
    pto,
    oncall,
    epics: incoming.epics,
    milestones,
    stories: incoming.stories,
    workItems: incoming.workItems,
    dependencies: incoming.dependencies,
    sprints: incoming.sprints,
    placements: keptPlacements,
    settings: mergedSettings,
  };

  return {
    merged,
    summary: {
      epics: incoming.epics.length,
      stories: incoming.stories.length,
      workItems: incoming.workItems.length,
      dependencies: incoming.dependencies.length,
      sprints: incoming.sprints.length,
      membersAdded,
      membersTotal: mergedMembers.length,
      placementsKept: keptPlacements.length,
      placementsPulledDone,
      placementsDroppedMissingItem,
      placementsDroppedMissingSprint,
    },
  };
}
