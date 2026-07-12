/**
 * Granular write operations for the configurable slice of the domain (project
 * plan §6 "Configuration tab"): team cadence, members, PTO, on-call, velocity
 * overrides, epic relevant-days (milestones), and the settings knobs.
 *
 * The importer's {@link import('./persist.js').writeDataset} replaces the whole
 * database at once; this module edits individual rows so the Configuration UI
 * can persist one change at a time. Every function validates its input and
 * throws {@link HttpError} (400/404/409) on bad requests, and multi-row changes
 * run in a transaction. Column ↔ domain mapping mirrors `persist.ts`.
 */
import { randomUUID } from 'node:crypto';
import type {
  EpicMilestone,
  IsoDate,
  Oncall,
  PlannedPlacement,
  Pto,
  Setting,
  Team,
  TeamMember,
  VelocityOverride,
  Weekday,
} from '@ecp/shared';
import { diffDays, SETTING_KEYS } from '@ecp/shared';
import type { Db } from './database.js';
import { badRequest, conflict, notFound } from '../http-error.js';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: unknown, field: string): IsoDate {
  if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw badRequest(`${field} must be an ISO date (YYYY-MM-DD)`);
  }
  return value;
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} must be a non-empty string`);
  }
  return value;
}

function assertNumber(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; int?: boolean } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw badRequest(`${field} must be a finite number`);
  }
  if (opts.int && !Number.isInteger(value)) throw badRequest(`${field} must be an integer`);
  if (opts.min !== undefined && value < opts.min) {
    throw badRequest(`${field} must be ≥ ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw badRequest(`${field} must be ≤ ${opts.max}`);
  }
  return value;
}

function assertWeekday(value: unknown, field: string): Weekday {
  const n = assertNumber(value, field, { int: true });
  if (n < 0 || n > 6) throw badRequest(`${field} must be a weekday index 0–6`);
  return n as Weekday;
}

function assertDateOrder(start: IsoDate, end: IsoDate): void {
  if (end < start) throw badRequest('endDate must be on or after startDate');
}

/** Optional free-text note: trimmed to a string, or null when blank/absent. */
function noteOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('note must be a string');
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Row → domain mappers (single row)
// ---------------------------------------------------------------------------

const memberRow = (r: any): TeamMember => ({
  id: r.id,
  teamId: r.team_id,
  name: r.name,
  baseVelocity: r.base_velocity,
  active: r.active === 1,
});

const teamRow = (r: any): Team => ({
  id: r.id,
  name: r.name,
  sprintLengthDays: r.sprint_length_days,
  sprintStartWeekday: r.sprint_start_weekday,
  sprintAnchorDate: r.sprint_anchor_date,
  workingDays: JSON.parse(r.working_days),
});

const ptoRow = (r: any): Pto => ({
  id: r.id,
  memberId: r.member_id,
  startDate: r.start_date,
  endDate: r.end_date,
  note: r.note ?? null,
});

const oncallRow = (r: any): Oncall => ({
  id: r.id,
  memberId: r.member_id,
  startDate: r.start_date,
  endDate: r.end_date,
  note: r.note ?? null,
});

const velocityRow = (r: any): VelocityOverride => ({
  id: r.id,
  memberId: r.member_id,
  startDate: r.start_date,
  endDate: r.end_date,
  multiplier: r.multiplier,
  note: r.note ?? null,
});

const milestoneRow = (r: any): EpicMilestone => ({
  id: r.id,
  epicKey: r.epic_key,
  name: r.name,
  date: r.date,
  isGating: r.is_gating === 1,
});

// ---------------------------------------------------------------------------
// Existence helpers
// ---------------------------------------------------------------------------

function requireTeam(db: Db, id: string): void {
  const row = db.prepare('SELECT 1 FROM team WHERE id = ?').get(id);
  if (!row) throw notFound(`Team ${id} not found`);
}

function requireMember(db: Db, id: string): void {
  const row = db.prepare('SELECT 1 FROM team_member WHERE id = ?').get(id);
  if (!row) throw notFound(`Member ${id} not found`);
}

function requireEpic(db: Db, key: string): void {
  const row = db.prepare('SELECT 1 FROM epic WHERE key = ?').get(key);
  if (!row) throw notFound(`Epic ${key} not found`);
}

// ---------------------------------------------------------------------------
// Settings knobs
// ---------------------------------------------------------------------------

/** Global settings the Configuration UI may edit, with their value validators. */
const EDITABLE_SETTINGS: Record<string, (value: unknown, key: string) => unknown> = {
  [SETTING_KEYS.ONCALL_MULTIPLIER]: (v, k) => assertNumber(v, k, { min: 0 }),
  [SETTING_KEYS.GREEN_MIN_BUFFER_DAYS]: (v, k) => assertNumber(v, k, { min: 0, int: true }),
  [SETTING_KEYS.WEEK_YELLOW_LOAD_FRACTION]: (v, k) => assertNumber(v, k, { min: 0, max: 1 }),
  [SETTING_KEYS.PLANNING_TODAY]: (v, k) => (v === null ? null : assertIsoDate(v, k)),
  [SETTING_KEYS.JIRA_FLAVOR]: nullableString,
  [SETTING_KEYS.JIRA_STORY_POINTS_FIELD]: nullableString,
  [SETTING_KEYS.JIRA_PROJECT_KEY]: nullableString,
  [SETTING_KEYS.JIRA_BLOCKS_LINK_TYPE]: nullableString,
};

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string or null`);
  return value;
}

/**
 * Upsert one or more global settings from a `{ key: value }` map, where `value`
 * is the raw (decoded) value. Unknown keys are rejected. Returns the full list
 * of global settings after the change.
 */
export function upsertGlobalSettings(db: Db, patch: Record<string, unknown>): Setting[] {
  const entries = Object.entries(patch);
  if (entries.length === 0) throw badRequest('No settings provided');

  const validated = entries.map(([key, value]) => {
    const validate = EDITABLE_SETTINGS[key];
    if (!validate) throw badRequest(`Unknown or read-only setting "${key}"`);
    return { key, value: JSON.stringify(validate(value, key)) };
  });

  const stmt = db.prepare(
    `INSERT INTO settings (key, scope, scope_id, value) VALUES (@key, 'global', '', @value)
     ON CONFLICT(key, scope, scope_id) DO UPDATE SET value = excluded.value`,
  );
  const run = db.transaction((rows: { key: string; value: string }[]) => {
    for (const row of rows) stmt.run(row);
  });
  run(validated);

  return db
    .prepare("SELECT * FROM settings WHERE scope = 'global'")
    .all()
    .map(
      (r: any): Setting => ({
        key: r.key,
        scope: r.scope,
        scopeId: r.scope_id === '' ? null : r.scope_id,
        value: r.value,
      }),
    );
}

// ---------------------------------------------------------------------------
// Team cadence
// ---------------------------------------------------------------------------

export interface TeamPatch {
  name?: unknown;
  sprintLengthDays?: unknown;
  sprintStartWeekday?: unknown;
  sprintAnchorDate?: unknown;
  workingDays?: unknown;
}

/** Update a team's cadence fields (any subset). Returns the updated team. */
export function updateTeam(db: Db, id: string, patch: TeamPatch): Team {
  requireTeam(db, id);
  const current = teamRow(db.prepare('SELECT * FROM team WHERE id = ?').get(id));

  const next: Team = { ...current };
  if (patch.name !== undefined) next.name = assertNonEmptyString(patch.name, 'name');
  if (patch.sprintLengthDays !== undefined) {
    next.sprintLengthDays = assertNumber(patch.sprintLengthDays, 'sprintLengthDays', { min: 1, int: true });
  }
  if (patch.sprintStartWeekday !== undefined) {
    next.sprintStartWeekday = assertWeekday(patch.sprintStartWeekday, 'sprintStartWeekday');
  }
  if (patch.sprintAnchorDate !== undefined) {
    next.sprintAnchorDate = assertIsoDate(patch.sprintAnchorDate, 'sprintAnchorDate');
  }
  if (patch.workingDays !== undefined) next.workingDays = assertWorkingDays(patch.workingDays);

  db.prepare(
    `UPDATE team SET name = @name, sprint_length_days = @sprintLengthDays,
       sprint_start_weekday = @sprintStartWeekday, sprint_anchor_date = @sprintAnchorDate,
       working_days = @workingDays WHERE id = @id`,
  ).run({ ...next, workingDays: JSON.stringify(next.workingDays) });

  return next;
}

function assertWorkingDays(value: unknown): Weekday[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest('workingDays must be a non-empty array of weekday indices');
  }
  const days = value.map((d) => assertWeekday(d, 'workingDays[]'));
  // Duplicates are harmless — normalise to a sorted, unique set.
  return [...new Set(days)].sort((a, b) => a - b) as Weekday[];
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export function createMember(db: Db, input: { teamId: unknown; name: unknown; baseVelocity: unknown; active?: unknown }): TeamMember {
  const teamId = assertNonEmptyString(input.teamId, 'teamId');
  requireTeam(db, teamId);
  const member: TeamMember = {
    id: newId('mem'),
    teamId,
    name: assertNonEmptyString(input.name, 'name'),
    baseVelocity: assertNumber(input.baseVelocity, 'baseVelocity', { min: 0 }),
    active: input.active === undefined ? true : Boolean(input.active),
  };
  db.prepare(
    `INSERT INTO team_member (id, team_id, name, base_velocity, active)
     VALUES (@id, @teamId, @name, @baseVelocity, @active)`,
  ).run({ ...member, active: member.active ? 1 : 0 });
  return member;
}

export function updateMember(
  db: Db,
  id: string,
  patch: { name?: unknown; baseVelocity?: unknown; active?: unknown },
): TeamMember {
  requireMember(db, id);
  const current = memberRow(db.prepare('SELECT * FROM team_member WHERE id = ?').get(id));
  const next: TeamMember = { ...current };
  if (patch.name !== undefined) next.name = assertNonEmptyString(patch.name, 'name');
  if (patch.baseVelocity !== undefined) {
    next.baseVelocity = assertNumber(patch.baseVelocity, 'baseVelocity', { min: 0 });
  }
  if (patch.active !== undefined) next.active = Boolean(patch.active);
  db.prepare(
    `UPDATE team_member SET name = @name, base_velocity = @baseVelocity, active = @active WHERE id = @id`,
  ).run({ ...next, active: next.active ? 1 : 0 });
  return next;
}

/** Delete a member. Cascades remove their PTO/on-call/velocity overrides; work
 * items they were assigned to become unassigned (FK ON DELETE SET NULL). */
export function deleteMember(db: Db, id: string): void {
  requireMember(db, id);
  db.prepare('DELETE FROM team_member WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Member date-range modifiers: PTO, on-call, velocity overrides
// ---------------------------------------------------------------------------

export function createPto(
  db: Db,
  input: { memberId: unknown; startDate: unknown; endDate: unknown; note?: unknown },
): Pto {
  const memberId = assertNonEmptyString(input.memberId, 'memberId');
  requireMember(db, memberId);
  const startDate = assertIsoDate(input.startDate, 'startDate');
  const endDate = assertIsoDate(input.endDate, 'endDate');
  assertDateOrder(startDate, endDate);
  const pto: Pto = { id: newId('pto'), memberId, startDate, endDate, note: noteOf(input.note) };
  db.prepare(
    `INSERT INTO pto (id, member_id, start_date, end_date, note)
     VALUES (@id, @memberId, @startDate, @endDate, @note)`,
  ).run(pto);
  return pto;
}

export function deletePto(db: Db, id: string): void {
  if (db.prepare('DELETE FROM pto WHERE id = ?').run(id).changes === 0) {
    throw notFound(`PTO ${id} not found`);
  }
}

export function createOncall(
  db: Db,
  input: { memberId: unknown; startDate: unknown; endDate: unknown; note?: unknown },
): Oncall {
  const memberId = assertNonEmptyString(input.memberId, 'memberId');
  requireMember(db, memberId);
  const startDate = assertIsoDate(input.startDate, 'startDate');
  const endDate = assertIsoDate(input.endDate, 'endDate');
  assertDateOrder(startDate, endDate);
  const oncall: Oncall = { id: newId('oc'), memberId, startDate, endDate, note: noteOf(input.note) };
  db.prepare(
    `INSERT INTO oncall (id, member_id, start_date, end_date, note)
     VALUES (@id, @memberId, @startDate, @endDate, @note)`,
  ).run(oncall);
  return oncall;
}

export function deleteOncall(db: Db, id: string): void {
  if (db.prepare('DELETE FROM oncall WHERE id = ?').run(id).changes === 0) {
    throw notFound(`On-call ${id} not found`);
  }
}

export function createVelocityOverride(
  db: Db,
  input: { memberId: unknown; startDate: unknown; endDate: unknown; multiplier: unknown; note?: unknown },
): VelocityOverride {
  const memberId = assertNonEmptyString(input.memberId, 'memberId');
  requireMember(db, memberId);
  const startDate = assertIsoDate(input.startDate, 'startDate');
  const endDate = assertIsoDate(input.endDate, 'endDate');
  assertDateOrder(startDate, endDate);
  const vo: VelocityOverride = {
    id: newId('vo'),
    memberId,
    startDate,
    endDate,
    multiplier: assertNumber(input.multiplier, 'multiplier', { min: 0 }),
    note: noteOf(input.note),
  };
  db.prepare(
    `INSERT INTO velocity_override (id, member_id, start_date, end_date, multiplier, note)
     VALUES (@id, @memberId, @startDate, @endDate, @multiplier, @note)`,
  ).run(vo);
  return vo;
}

export function deleteVelocityOverride(db: Db, id: string): void {
  if (db.prepare('DELETE FROM velocity_override WHERE id = ?').run(id).changes === 0) {
    throw notFound(`Velocity override ${id} not found`);
  }
}

// ---------------------------------------------------------------------------
// Epic milestones ("relevant days") — exactly one gating per epic
// ---------------------------------------------------------------------------

function clearGating(db: Db, epicKey: string, exceptId?: string): void {
  db.prepare(
    `UPDATE epic_milestone SET is_gating = 0 WHERE epic_key = ? AND id != ?`,
  ).run(epicKey, exceptId ?? '');
}

export function createMilestone(
  db: Db,
  epicKey: string,
  input: { name: unknown; date: unknown; isGating?: unknown },
): EpicMilestone {
  requireEpic(db, epicKey);
  const milestone: EpicMilestone = {
    id: newId('ms'),
    epicKey,
    name: assertNonEmptyString(input.name, 'name'),
    date: assertIsoDate(input.date, 'date'),
    isGating: Boolean(input.isGating),
  };
  const run = db.transaction(() => {
    if (milestone.isGating) clearGating(db, epicKey, milestone.id);
    db.prepare(
      `INSERT INTO epic_milestone (id, epic_key, name, date, is_gating)
       VALUES (@id, @epicKey, @name, @date, @isGating)`,
    ).run({ ...milestone, isGating: milestone.isGating ? 1 : 0 });
  });
  run();
  return milestone;
}

export function updateMilestone(
  db: Db,
  id: string,
  patch: { name?: unknown; date?: unknown; isGating?: unknown },
): EpicMilestone {
  const row = db.prepare('SELECT * FROM epic_milestone WHERE id = ?').get(id);
  if (!row) throw notFound(`Milestone ${id} not found`);
  const current = milestoneRow(row);
  const next: EpicMilestone = { ...current };
  if (patch.name !== undefined) next.name = assertNonEmptyString(patch.name, 'name');
  if (patch.date !== undefined) next.date = assertIsoDate(patch.date, 'date');
  if (patch.isGating !== undefined) {
    const wanted = Boolean(patch.isGating);
    // An epic must always keep exactly one gating day; demote via promotion.
    if (current.isGating && !wanted) {
      throw conflict('An epic must have a gating milestone; mark another as gating instead');
    }
    next.isGating = wanted;
  }
  const run = db.transaction(() => {
    if (next.isGating) clearGating(db, next.epicKey, id);
    db.prepare(
      `UPDATE epic_milestone SET name = @name, date = @date, is_gating = @isGating WHERE id = @id`,
    ).run({ ...next, isGating: next.isGating ? 1 : 0 });
  });
  run();
  return next;
}

export function deleteMilestone(db: Db, id: string): void {
  const row = db.prepare('SELECT * FROM epic_milestone WHERE id = ?').get(id);
  if (!row) throw notFound(`Milestone ${id} not found`);
  if (milestoneRow(row).isGating) {
    throw conflict('Cannot delete the gating milestone; mark another as gating first');
  }
  db.prepare('DELETE FROM epic_milestone WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Gantt Planner: week placements (project plan §6a)
// ---------------------------------------------------------------------------

const placementRow = (r: any): PlannedPlacement => ({
  id: r.id,
  workItemKey: r.work_item_key,
  sprintId: r.sprint_id,
  weekIndex: r.week_index,
});

/** Number of 7-day weeks a sprint spans (the last may be short). */
function weekCount(startDate: IsoDate, endDate: IsoDate): number {
  return Math.max(1, Math.ceil((diffDays(startDate, endDate) + 1) / 7));
}

/**
 * Place a work item into a sprint week (or move it there). Idempotent per work
 * item: the unique `work_item_key` means re-placing replaces the prior slot.
 * Validates that the item and sprint exist and the week is within the sprint.
 */
export function upsertPlacement(
  db: Db,
  input: { workItemKey?: unknown; sprintId?: unknown; weekIndex?: unknown },
): PlannedPlacement {
  const workItemKey = assertNonEmptyString(input.workItemKey, 'workItemKey');
  const sprintId = assertNonEmptyString(input.sprintId, 'sprintId');
  const weekIndex = assertNumber(input.weekIndex, 'weekIndex', { int: true, min: 0 });

  const item = db.prepare('SELECT key FROM work_item WHERE key = ?').get(workItemKey);
  if (!item) throw notFound(`Work item ${workItemKey} not found`);
  const sprint = db.prepare('SELECT * FROM sprint WHERE id = ?').get(sprintId) as
    | { start_date: string; end_date: string }
    | undefined;
  if (!sprint) throw notFound(`Sprint ${sprintId} not found`);

  const weeks = weekCount(sprint.start_date, sprint.end_date);
  if (weekIndex >= weeks) {
    throw badRequest(`weekIndex ${weekIndex} is out of range (sprint has ${weeks} week(s))`);
  }

  const existing = db
    .prepare('SELECT id FROM planned_placement WHERE work_item_key = ?')
    .get(workItemKey) as { id: string } | undefined;
  const id = existing?.id ?? newId('pp');
  db.prepare(
    `INSERT INTO planned_placement (id, work_item_key, sprint_id, week_index)
     VALUES (@id, @workItemKey, @sprintId, @weekIndex)
     ON CONFLICT(work_item_key) DO UPDATE SET sprint_id = @sprintId, week_index = @weekIndex`,
  ).run({ id, workItemKey, sprintId, weekIndex });

  return placementRow(
    db.prepare('SELECT * FROM planned_placement WHERE work_item_key = ?').get(workItemKey),
  );
}

/** Remove a work item's placement (send it back to the backlog bag). */
export function deletePlacement(db: Db, workItemKey: string): void {
  const info = db.prepare('DELETE FROM planned_placement WHERE work_item_key = ?').run(workItemKey);
  if (info.changes === 0) throw notFound(`No placement for work item ${workItemKey}`);
}
