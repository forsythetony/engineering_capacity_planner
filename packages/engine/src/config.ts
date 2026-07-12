import { ENGINE_DEFAULTS } from '@ecp/shared';

/**
 * The engine's tunable knobs (project plan §5). Every value has a default; a
 * caller (or the settings store) can override any subset.
 */
export interface EngineConfig {
  /** An on-call day yields this fraction of a member's normal output (0–1). */
  oncallMultiplier: number;
  /** Buffer (working days) at/above which the verdict is green. */
  greenMinBufferDays: number;
  /**
   * Gantt Planner: fraction of a week's capacity at/above which the week turns
   * yellow. `1.0` = yellow only when fully loaded; over 100% is always red.
   */
  weekYellowLoadFraction: number;
  /**
   * How far ahead the projection will search before declaring the work
   * uncompletable with current capacity.
   */
  maxHorizonDays: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  oncallMultiplier: ENGINE_DEFAULTS.ONCALL_MULTIPLIER,
  greenMinBufferDays: ENGINE_DEFAULTS.GREEN_MIN_BUFFER_DAYS,
  weekYellowLoadFraction: ENGINE_DEFAULTS.WEEK_YELLOW_LOAD_FRACTION,
  maxHorizonDays: 3650,
};
