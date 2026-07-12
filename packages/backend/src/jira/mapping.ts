import type { Setting } from '@ecp/shared';
import { SETTING_KEYS } from '@ecp/shared';
import type { JiraConfig } from '../config.js';

/**
 * The resolved, board-specific field mapping the importer needs. This is the
 * "works with whatever fields a team already has" layer (project plan §7):
 * every instance-specific field id / link-type name is data, not code.
 *
 * Resolution precedence: persisted global {@link Setting}s (edited in the
 * Configuration tab via the live field picker) win over the `.env`
 * {@link JiraConfig} bootstrap, so once a user has pointed the app at their
 * fields it remembers them per board.
 */
export interface JiraMapping {
  projectKey: string;
  /** Specific epic to import; `null` imports every epic in the project. */
  epicKey: string | null;
  /** Agile board for sprint discovery; `null` = use the project's first board. */
  boardId: number | null;
  /** Custom field id holding story points, e.g. `customfield_10016`. */
  storyPointsField: string;
  /** Custom field id carrying the sprint, or `null` to skip sprint import. */
  sprintField: string | null;
  /** Field id carrying labels; defaults to Jira's native `labels`. */
  labelsField: string;
  /** Issue-link type name representing "blocks", e.g. `Blocks`. */
  blocksLinkType: string;
  /** Display name for the synthesized ECP team. */
  teamName: string;
}

/** Thrown when a required mapping value is absent from both settings and env. */
export class MappingError extends Error {}

function fromSettings(settings: Setting[]): Map<string, unknown> {
  const globals = new Map<string, unknown>();
  for (const s of settings) {
    if (s.scope !== 'global') continue;
    try {
      globals.set(s.key, JSON.parse(s.value));
    } catch {
      globals.set(s.key, s.value);
    }
  }
  return globals;
}

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/**
 * Build a {@link JiraMapping} from persisted settings, falling back to the
 * env-provided {@link JiraConfig}. Throws {@link MappingError} listing every
 * value still missing, so the UI/CLI can tell the user exactly what to map.
 */
export function resolveMapping(settings: Setting[], config: JiraConfig): JiraMapping {
  const g = fromSettings(settings);
  const pick = (key: string, fallback: string | null): string | null =>
    asString(g.get(key)) ?? fallback;

  const projectKey = pick(SETTING_KEYS.JIRA_PROJECT_KEY, config.projectKey);
  const storyPointsField = pick(SETTING_KEYS.JIRA_STORY_POINTS_FIELD, config.storyPointsField);
  const blocksLinkType = pick(SETTING_KEYS.JIRA_BLOCKS_LINK_TYPE, config.blocksLinkType);

  const missing: string[] = [];
  if (!projectKey) missing.push(SETTING_KEYS.JIRA_PROJECT_KEY);
  if (!storyPointsField) missing.push(SETTING_KEYS.JIRA_STORY_POINTS_FIELD);
  if (!blocksLinkType) missing.push(SETTING_KEYS.JIRA_BLOCKS_LINK_TYPE);
  if (missing.length > 0) {
    throw new MappingError(
      `Jira field mapping incomplete — set: ${missing.join(', ')} ` +
        '(Configuration → Jira mapping, or the JIRA_* env vars).',
    );
  }

  const boardIdRaw = pick(SETTING_KEYS.JIRA_BOARD_ID, null);
  const boardId = boardIdRaw != null && /^\d+$/.test(boardIdRaw) ? Number(boardIdRaw) : null;

  return {
    projectKey: projectKey!,
    epicKey: pick(SETTING_KEYS.JIRA_EPIC_KEY, null),
    boardId,
    storyPointsField: storyPointsField!,
    sprintField: pick(SETTING_KEYS.JIRA_SPRINT_FIELD, null),
    labelsField: pick(SETTING_KEYS.JIRA_LABELS_FIELD, null) ?? 'labels',
    blocksLinkType: blocksLinkType!,
    teamName: `${projectKey} (Jira)`,
  };
}
