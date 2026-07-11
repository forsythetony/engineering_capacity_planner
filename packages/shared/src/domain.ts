/**
 * Domain model — the app's single source of truth (project plan §4).
 *
 * Nothing in the engine or UI knows where this data came from; an
 * {@link Importer} (synthetic now, Jira later) is responsible for producing a
 * {@link DomainDataset} shaped exactly like these types.
 *
 * Conventions:
 * - All dates are ISO-8601 calendar strings, `YYYY-MM-DD` (no time / timezone).
 *   Capacity math operates on whole working days, so a date is the right grain.
 * - Weekdays use the JavaScript `Date.getUTCDay()` convention:
 *   0 = Sunday, 1 = Monday, ... 6 = Saturday.
 */

/** ISO-8601 calendar date, e.g. `"2026-07-11"`. */
export type IsoDate = string;

/** Weekday index, `0` = Sunday … `6` = Saturday (matches `Date.getUTCDay()`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ---------------------------------------------------------------------------
// Teams & cadence
// ---------------------------------------------------------------------------

/**
 * A team and its sprint cadence. Every cadence field is configurable so
 * different teams can run different rhythms.
 */
export interface Team {
  id: string;
  name: string;
  /** Sprint length in calendar days. Default 14 (two-week sprints). */
  sprintLengthDays: number;
  /** Weekday a sprint begins on. Default 2 (Tuesday). */
  sprintStartWeekday: Weekday;
  /**
   * A known real sprint-start date. All past/future sprint boundaries are
   * derived from this anchor plus {@link sprintLengthDays}.
   */
  sprintAnchorDate: IsoDate;
  /** Weekdays that count as working days. Default Mon–Fri (`[1,2,3,4,5]`). */
  workingDays: Weekday[];
}

/** A person on a team, with a baseline throughput. */
export interface TeamMember {
  id: string;
  teamId: string;
  name: string;
  /** Baseline velocity in story points per person per sprint. */
  baseVelocity: number;
  active: boolean;
}

/**
 * A time-boxed adjustment to a member's velocity (ramping hire, reduced week).
 * Expressed as a multiplier against {@link TeamMember.baseVelocity}.
 */
export interface VelocityOverride {
  id: string;
  memberId: string;
  startDate: IsoDate;
  endDate: IsoDate;
  /** Multiplier applied to base velocity over the range (e.g. `0.5`). */
  multiplier: number;
}

/** A member's paid-time-off range (inclusive). */
export interface Pto {
  id: string;
  memberId: string;
  startDate: IsoDate;
  endDate: IsoDate;
}

/**
 * A member's on-call range (inclusive). The productivity impact is not encoded
 * here — it is driven by the configurable `oncall_multiplier` setting so it can
 * be tuned globally / per team without editing data.
 */
export interface Oncall {
  id: string;
  memberId: string;
  startDate: IsoDate;
  endDate: IsoDate;
}

// ---------------------------------------------------------------------------
// Work hierarchy
// ---------------------------------------------------------------------------

export interface Epic {
  key: string;
  title: string;
  teamId: string;
}

/**
 * An epic "relevant day" — a date that matters for this epic (e.g. "First QA in
 * stage pass", "Launch"). Exactly one milestone per epic is flagged
 * {@link isGating}; that one drives the red/yellow/green verdict (project plan
 * §5).
 */
export interface EpicMilestone {
  id: string;
  epicKey: string;
  name: string;
  date: IsoDate;
  isGating: boolean;
}

/** The grouping layer between an epic and its work items. */
export interface UserStory {
  key: string;
  epicKey: string;
  title: string;
}

/** Lifecycle status of a work item. */
export type WorkItemStatus = 'To Do' | 'In Progress' | 'In Review' | 'Done';

export const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = [
  'To Do',
  'In Progress',
  'In Review',
  'Done',
] as const;

/** A single unit of work with an estimate. */
export interface WorkItem {
  key: string;
  storyKey: string;
  title: string;
  /** Story-point estimate. */
  points: number;
  status: WorkItemStatus;
  /** {@link TeamMember.id} of the assignee, or `null` if unassigned. */
  assigneeId: string | null;
}

/** A "blocked by" edge: {@link blockerItemKey} must finish before {@link blockedItemKey}. */
export interface Dependency {
  id: string;
  blockerItemKey: string;
  blockedItemKey: string;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Scope a setting applies to. */
export type SettingScope = 'global' | 'team' | 'epic';

/**
 * Key/value settings entry. `value` is stored as JSON text so any shape is
 * representable; {@link scopeId} identifies the team/epic for scoped settings
 * and is `null` for global settings.
 */
export interface Setting {
  key: string;
  scope: SettingScope;
  scopeId: string | null;
  /** JSON-encoded value. */
  value: string;
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

/**
 * A complete, self-consistent snapshot of the domain, as produced by an
 * {@link Importer} and persisted to SQLite. Referential integrity is the
 * importer's responsibility (every foreign key resolves within the dataset).
 */
export interface DomainDataset {
  teams: Team[];
  members: TeamMember[];
  velocityOverrides: VelocityOverride[];
  pto: Pto[];
  oncall: Oncall[];
  epics: Epic[];
  milestones: EpicMilestone[];
  stories: UserStory[];
  workItems: WorkItem[];
  dependencies: Dependency[];
  settings: Setting[];
}
