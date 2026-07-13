/**
 * SQLite schema for the domain model (project plan §4).
 *
 * The database file *is* the shareable unit, so the schema is the durable
 * contract. Column names are snake_case (SQL idiom); the persistence layer maps
 * them to/from the camelCase domain types in `@ecp/shared`.
 *
 * Dates are stored as ISO-8601 `YYYY-MM-DD` TEXT. Booleans are stored as
 * INTEGER `0`/`1`. Foreign keys are declared and enforced (PRAGMA set on open).
 */
export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS team (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  sprint_length_days   INTEGER NOT NULL,
  sprint_start_weekday INTEGER NOT NULL,
  sprint_anchor_date   TEXT NOT NULL,
  -- JSON array of weekday indices (0=Sun..6=Sat), e.g. "[1,2,3,4,5]".
  working_days         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_member (
  id            TEXT PRIMARY KEY,
  team_id       TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  base_velocity REAL NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  -- Jira accountId this member is linked to (NULL for a purely local member).
  -- Lets a synced assignee map back onto a hand-created person (project plan §7).
  jira_account_id TEXT,
  -- URL of the member's Jira avatar image (NULL when unlinked/unknown).
  avatar_url TEXT
);

CREATE TABLE IF NOT EXISTS velocity_override (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES team_member(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  multiplier REAL NOT NULL,
  note       TEXT
);

CREATE TABLE IF NOT EXISTS pto (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES team_member(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  note       TEXT
);

CREATE TABLE IF NOT EXISTS oncall (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES team_member(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  note       TEXT
);

CREATE TABLE IF NOT EXISTS epic (
  key     TEXT PRIMARY KEY,
  title   TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS epic_milestone (
  id        TEXT PRIMARY KEY,
  epic_key  TEXT NOT NULL REFERENCES epic(key) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  date      TEXT NOT NULL,
  is_gating INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_story (
  key      TEXT PRIMARY KEY,
  epic_key TEXT NOT NULL REFERENCES epic(key) ON DELETE CASCADE,
  title    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_item (
  key         TEXT PRIMARY KEY,
  story_key   TEXT NOT NULL REFERENCES user_story(key) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  points      REAL NOT NULL,
  status      TEXT NOT NULL,
  assignee_id TEXT REFERENCES team_member(id) ON DELETE SET NULL,
  -- JSON array of freeform labels, e.g. '["Cart","Payments"]'. Drives the
  -- Gantt Planner's horizontal lanes. Defaults to an empty array.
  labels      TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS dependency (
  id                TEXT PRIMARY KEY,
  blocker_item_key  TEXT NOT NULL REFERENCES work_item(key) ON DELETE CASCADE,
  blocked_item_key  TEXT NOT NULL REFERENCES work_item(key) ON DELETE CASCADE,
  UNIQUE (blocker_item_key, blocked_item_key)
);

-- Stored sprints (project plan §6a). Authoritative bounds for the Gantt weeks;
-- synthetic data derives them from cadence, Jira supplies them in Phase 7.
CREATE TABLE IF NOT EXISTS sprint (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL
);

-- Human-authored week placements for the Gantt Planner (project plan §6a).
-- At most one placement per work item (unplaced items live in the backlog bag).
CREATE TABLE IF NOT EXISTS planned_placement (
  id            TEXT PRIMARY KEY,
  work_item_key TEXT NOT NULL UNIQUE REFERENCES work_item(key) ON DELETE CASCADE,
  sprint_id     TEXT NOT NULL REFERENCES sprint(id) ON DELETE CASCADE,
  week_index    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key      TEXT NOT NULL,
  scope    TEXT NOT NULL DEFAULT 'global',
  scope_id TEXT,
  value    TEXT NOT NULL,
  -- One row per (key, scope, scope_id). scope_id is '' for global rows so the
  -- primary key stays well-defined (SQLite treats NULLs as distinct otherwise).
  PRIMARY KEY (key, scope, scope_id)
);

-- Sync log (project plan §7): one row per successful sync, recording what
-- reconcile changed. Deliberately *outside* INSERT_ORDER/DELETE_ORDER so the
-- dataset-replacing writeDataset() never clears it — the history accretes.
CREATE TABLE IF NOT EXISTS sync_log (
  id        TEXT PRIMARY KEY,
  synced_at TEXT NOT NULL,
  source    TEXT NOT NULL,
  -- JSON: the ReconcileSummary counts.
  summary   TEXT NOT NULL,
  -- JSON: an array of SyncChange entries (the itemized card modal).
  changes   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_member_team       ON team_member(team_id);
CREATE INDEX IF NOT EXISTS idx_story_epic         ON user_story(epic_key);
CREATE INDEX IF NOT EXISTS idx_work_item_story    ON work_item(story_key);
CREATE INDEX IF NOT EXISTS idx_work_item_assignee ON work_item(assignee_id);
CREATE INDEX IF NOT EXISTS idx_milestone_epic     ON epic_milestone(epic_key);
CREATE INDEX IF NOT EXISTS idx_dep_blocker        ON dependency(blocker_item_key);
CREATE INDEX IF NOT EXISTS idx_dep_blocked        ON dependency(blocked_item_key);
CREATE INDEX IF NOT EXISTS idx_sprint_team        ON sprint(team_id);
CREATE INDEX IF NOT EXISTS idx_placement_sprint   ON planned_placement(sprint_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_time       ON sync_log(synced_at);
`;

/** Order tables must be inserted into to satisfy foreign keys. */
export const INSERT_ORDER = [
  'team',
  'team_member',
  'velocity_override',
  'pto',
  'oncall',
  'sprint',
  'epic',
  'epic_milestone',
  'user_story',
  'work_item',
  'dependency',
  'planned_placement',
  'settings',
] as const;

/** Order tables must be cleared in to satisfy foreign keys (reverse of insert). */
export const DELETE_ORDER = [...INSERT_ORDER].reverse();
