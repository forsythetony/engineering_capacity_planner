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
  active        INTEGER NOT NULL DEFAULT 1
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
  assignee_id TEXT REFERENCES team_member(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS dependency (
  id                TEXT PRIMARY KEY,
  blocker_item_key  TEXT NOT NULL REFERENCES work_item(key) ON DELETE CASCADE,
  blocked_item_key  TEXT NOT NULL REFERENCES work_item(key) ON DELETE CASCADE,
  UNIQUE (blocker_item_key, blocked_item_key)
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

CREATE INDEX IF NOT EXISTS idx_member_team       ON team_member(team_id);
CREATE INDEX IF NOT EXISTS idx_story_epic         ON user_story(epic_key);
CREATE INDEX IF NOT EXISTS idx_work_item_story    ON work_item(story_key);
CREATE INDEX IF NOT EXISTS idx_work_item_assignee ON work_item(assignee_id);
CREATE INDEX IF NOT EXISTS idx_milestone_epic     ON epic_milestone(epic_key);
CREATE INDEX IF NOT EXISTS idx_dep_blocker        ON dependency(blocker_item_key);
CREATE INDEX IF NOT EXISTS idx_dep_blocked        ON dependency(blocked_item_key);
`;

/** Order tables must be inserted into to satisfy foreign keys. */
export const INSERT_ORDER = [
  'team',
  'team_member',
  'velocity_override',
  'pto',
  'oncall',
  'epic',
  'epic_milestone',
  'user_story',
  'work_item',
  'dependency',
  'settings',
] as const;

/** Order tables must be cleared in to satisfy foreign keys (reverse of insert). */
export const DELETE_ORDER = [...INSERT_ORDER].reverse();
