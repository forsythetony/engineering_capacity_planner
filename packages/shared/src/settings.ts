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
  // --- Jira mapping stubs: designed in early, inert until Phase 7. ---
  /** Jira flavor: `"cloud"` or `"server"`. */
  JIRA_FLAVOR: 'jira_flavor',
  /** Custom field id holding story points, e.g. `"customfield_10016"`. */
  JIRA_STORY_POINTS_FIELD: 'jira_story_points_field',
  /** Target Jira project key. */
  JIRA_PROJECT_KEY: 'jira_project_key',
  /** Issue-link type that represents "blocks". */
  JIRA_BLOCKS_LINK_TYPE: 'jira_blocks_link_type',
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
  ];
}
