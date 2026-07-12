import type { Setting, Weekday } from './domain.js';

/**
 * Canonical setting keys and their defaults (project plan §4 "Settings", §5).
 *
 * Kept here (in shared) so the engine, importer, and future config UI all agree
 * on the knob names and default values.
 */
export const SETTING_KEYS = {
  /** On-call day yields this fraction of a person's normal output. */
  ONCALL_MULTIPLIER: 'oncall_multiplier',
  /** Buffer (working days) at/above which the epic verdict is green. */
  GREEN_MIN_BUFFER_DAYS: 'green_min_buffer_days',
  /**
   * Gantt Planner: fraction of a week's capacity at/above which the week turns
   * yellow ("tight"). `1.0` = yellow only once fully loaded; lower widens the
   * warning band. Over 100% loaded is always red. (Project plan §6a.)
   */
  WEEK_YELLOW_LOAD_FRACTION: 'week_yellow_load_fraction',
  /**
   * The "today" the UI defaults its projection to. Set by the synthetic
   * importer so the demo scenario is reproducible; absent for real data, where
   * the UI uses the actual current date.
   */
  PLANNING_TODAY: 'planning_today',
  // --- Jira field mapping (Phase 7). Resolved from a live sample in the
  //     Configuration tab; the tool works with whatever fields a team has. ---
  /** Jira flavor: `"cloud"` or `"server"`. */
  JIRA_FLAVOR: 'jira_flavor',
  /** Custom field id holding story points, e.g. `"customfield_10016"`. */
  JIRA_STORY_POINTS_FIELD: 'jira_story_points_field',
  /** Target Jira project key. */
  JIRA_PROJECT_KEY: 'jira_project_key',
  /** Issue-link type that represents "blocks". */
  JIRA_BLOCKS_LINK_TYPE: 'jira_blocks_link_type',
  /** The specific epic key to import work from (e.g. `"CKT"`). */
  JIRA_EPIC_KEY: 'jira_epic_key',
  /** Agile board id used to read sprints; blank = auto-discover the project's board. */
  JIRA_BOARD_ID: 'jira_board_id',
  /** Human-readable name of the selected board, for display in the setup wizard. */
  JIRA_BOARD_NAME: 'jira_board_name',
  /** Custom field id carrying the sprint, e.g. `"customfield_10020"`. */
  JIRA_SPRINT_FIELD: 'jira_sprint_field',
  /** Field id carrying the labels that feed Gantt lanes (default the native `labels`). */
  JIRA_LABELS_FIELD: 'jira_labels_field',
  /**
   * ISO-8601 datetime of the last successful sync, written by the sync endpoint.
   * Drives the top-nav Sync button's freshness color; `null` until first sync.
   */
  LAST_SYNCED_AT: 'last_synced_at',
} as const;

/** Default cadence values (project plan §4, decision #1). */
export const CADENCE_DEFAULTS = {
  SPRINT_LENGTH_DAYS: 14,
  /** Tuesday (0 = Sunday … 6 = Saturday). */
  SPRINT_START_WEEKDAY: 2 as Weekday,
  /** Mon–Fri. */
  WORKING_DAYS: [1, 2, 3, 4, 5] as Weekday[],
} as const;

/** Default engine knob values (project plan §5). */
export const ENGINE_DEFAULTS = {
  /** An on-call day yields half normal output. */
  ONCALL_MULTIPLIER: 0.5,
  /** Comfortable slack before the gating day, in working days. */
  GREEN_MIN_BUFFER_DAYS: 5,
  /** A Gantt week turns yellow only once fully loaded (100% of capacity). */
  WEEK_YELLOW_LOAD_FRACTION: 1,
} as const;

/**
 * The default global settings rows, including the Jira mapping stubs (present
 * but empty so the mapping UX can be designed alongside everything else).
 */
export function defaultGlobalSettings(): Setting[] {
  const global = (key: string, value: unknown): Setting => ({
    key,
    scope: 'global',
    scopeId: null,
    value: JSON.stringify(value),
  });
  return [
    global(SETTING_KEYS.ONCALL_MULTIPLIER, ENGINE_DEFAULTS.ONCALL_MULTIPLIER),
    global(SETTING_KEYS.GREEN_MIN_BUFFER_DAYS, ENGINE_DEFAULTS.GREEN_MIN_BUFFER_DAYS),
    global(SETTING_KEYS.WEEK_YELLOW_LOAD_FRACTION, ENGINE_DEFAULTS.WEEK_YELLOW_LOAD_FRACTION),
    global(SETTING_KEYS.JIRA_FLAVOR, null),
    global(SETTING_KEYS.JIRA_STORY_POINTS_FIELD, null),
    global(SETTING_KEYS.JIRA_PROJECT_KEY, null),
    global(SETTING_KEYS.JIRA_BLOCKS_LINK_TYPE, null),
    global(SETTING_KEYS.JIRA_EPIC_KEY, null),
    global(SETTING_KEYS.JIRA_BOARD_ID, null),
    global(SETTING_KEYS.JIRA_BOARD_NAME, null),
    global(SETTING_KEYS.JIRA_SPRINT_FIELD, null),
    global(SETTING_KEYS.JIRA_LABELS_FIELD, null),
    global(SETTING_KEYS.LAST_SYNCED_AT, null),
  ];
}

/** Decode a global string setting, or `null` when absent/blank/non-string. */
export function globalStringSetting(settings: Setting[], key: string): string | null {
  const row = settings.find((s) => s.scope === 'global' && s.key === key);
  if (!row) return null;
  try {
    const v = JSON.parse(row.value) as unknown;
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  } catch {
    return null;
  }
}

/**
 * The Jira field mapping is "complete enough to sync" once the three values
 * {@link resolveMapping} requires are present: the project key, the story-points
 * field, and the "blocks" link type. This is the single signal both the backend
 * and the frontend use to decide whether Jira setup is done — e.g. to unlock the
 * top-nav Sync button. Board / epic / sprint / labels have working fallbacks, so
 * they're not part of the gate.
 */
export function isMappingComplete(settings: Setting[]): boolean {
  return (
    globalStringSetting(settings, SETTING_KEYS.JIRA_PROJECT_KEY) !== null &&
    globalStringSetting(settings, SETTING_KEYS.JIRA_STORY_POINTS_FIELD) !== null &&
    globalStringSetting(settings, SETTING_KEYS.JIRA_BLOCKS_LINK_TYPE) !== null
  );
}
