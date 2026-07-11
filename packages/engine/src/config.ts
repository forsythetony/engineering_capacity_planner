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
   * How far ahead the projection will search before declaring the work
   * uncompletable with current capacity.
   */
  maxHorizonDays: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  oncallMultiplier: ENGINE_DEFAULTS.ONCALL_MULTIPLIER,
  greenMinBufferDays: ENGINE_DEFAULTS.GREEN_MIN_BUFFER_DAYS,
  maxHorizonDays: 3650,
};
