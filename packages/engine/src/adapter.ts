import type { DomainDataset, IsoDate } from '@ecp/shared';
import { SETTING_KEYS } from '@ecp/shared';
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from './config.js';
import { project, type ProjectionResult } from './project.js';

/**
 * Convenience bridge from a whole {@link DomainDataset} to a projection for one
 * epic. It pulls the epic's team, gating milestone, work items, and capacity
 * inputs out of the dataset, reads engine knobs from the settings store, and
 * calls the pure {@link project} core.
 *
 * This is the only place the engine touches the full domain shape; the core
 * itself stays free of it.
 */
export function projectEpicFromDataset(
  dataset: DomainDataset,
  epicKey: string,
  today: IsoDate,
): ProjectionResult {
  const epic = dataset.epics.find((e) => e.key === epicKey);
  if (!epic) throw new Error(`Epic ${epicKey} not found in dataset`);

  const team = dataset.teams.find((t) => t.id === epic.teamId);
  if (!team) throw new Error(`Team ${epic.teamId} for epic ${epicKey} not found in dataset`);

  const gating = dataset.milestones.find((m) => m.epicKey === epicKey && m.isGating);
  if (!gating) throw new Error(`Epic ${epicKey} has no gating milestone`);

  const storyKeys = new Set(
    dataset.stories.filter((s) => s.epicKey === epicKey).map((s) => s.key),
  );
  const workItems = dataset.workItems.filter((w) => storyKeys.has(w.storyKey));

  const memberIds = new Set(
    dataset.members.filter((m) => m.teamId === team.id).map((m) => m.id),
  );
  const members = dataset.members.filter((m) => m.teamId === team.id);
  const pto = dataset.pto.filter((p) => memberIds.has(p.memberId));
  const oncall = dataset.oncall.filter((o) => memberIds.has(o.memberId));
  const velocityOverrides = dataset.velocityOverrides.filter((v) => memberIds.has(v.memberId));

  return project({
    today,
    team,
    members,
    pto,
    oncall,
    velocityOverrides,
    workItems,
    gatingDate: gating.date,
    config: readEngineConfig(dataset),
  });
}

/** Read the engine knobs from the dataset's global settings, with defaults. */
export function readEngineConfig(dataset: DomainDataset): Partial<EngineConfig> {
  const globals = new Map(
    dataset.settings.filter((s) => s.scope === 'global').map((s) => [s.key, s.value]),
  );
  const num = (key: string, fallback: number): number => {
    const raw = globals.get(key);
    if (raw === undefined) return fallback;
    const parsed = JSON.parse(raw);
    return typeof parsed === 'number' ? parsed : fallback;
  };
  return {
    oncallMultiplier: num(SETTING_KEYS.ONCALL_MULTIPLIER, DEFAULT_ENGINE_CONFIG.oncallMultiplier),
    greenMinBufferDays: num(
      SETTING_KEYS.GREEN_MIN_BUFFER_DAYS,
      DEFAULT_ENGINE_CONFIG.greenMinBufferDays,
    ),
  };
}
