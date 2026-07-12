import type { DomainDataset, Setting } from '@ecp/shared';
import type { Db } from './database.js';
import { DELETE_ORDER } from './schema.js';

const bool = (v: boolean): number => (v ? 1 : 0);
/** Global settings use `null` scopeId in the domain but `''` in the DB PK. */
const scopeIdToDb = (scopeId: string | null): string => scopeId ?? '';
const scopeIdFromDb = (scopeId: string): string | null => (scopeId === '' ? null : scopeId);

/**
 * Replace the entire contents of the database with `dataset`, in a single
 * transaction. Existing rows are cleared first (child tables before parents) so
 * re-seeding is idempotent. Foreign keys are enforced, so a dataset with a
 * dangling reference will throw and roll back.
 */
export function writeDataset(db: Db, dataset: DomainDataset): void {
  const insertTeam = db.prepare(
    `INSERT INTO team (id, name, sprint_length_days, sprint_start_weekday, sprint_anchor_date, working_days)
     VALUES (@id, @name, @sprintLengthDays, @sprintStartWeekday, @sprintAnchorDate, @workingDays)`,
  );
  const insertMember = db.prepare(
    `INSERT INTO team_member (id, team_id, name, base_velocity, active)
     VALUES (@id, @teamId, @name, @baseVelocity, @active)`,
  );
  const insertVelocity = db.prepare(
    `INSERT INTO velocity_override (id, member_id, start_date, end_date, multiplier, note)
     VALUES (@id, @memberId, @startDate, @endDate, @multiplier, @note)`,
  );
  const insertPto = db.prepare(
    `INSERT INTO pto (id, member_id, start_date, end_date, note)
     VALUES (@id, @memberId, @startDate, @endDate, @note)`,
  );
  const insertOncall = db.prepare(
    `INSERT INTO oncall (id, member_id, start_date, end_date, note)
     VALUES (@id, @memberId, @startDate, @endDate, @note)`,
  );
  const insertEpic = db.prepare(
    `INSERT INTO epic (key, title, team_id) VALUES (@key, @title, @teamId)`,
  );
  const insertMilestone = db.prepare(
    `INSERT INTO epic_milestone (id, epic_key, name, date, is_gating)
     VALUES (@id, @epicKey, @name, @date, @isGating)`,
  );
  const insertStory = db.prepare(
    `INSERT INTO user_story (key, epic_key, title) VALUES (@key, @epicKey, @title)`,
  );
  const insertSprint = db.prepare(
    `INSERT INTO sprint (id, team_id, name, start_date, end_date)
     VALUES (@id, @teamId, @name, @startDate, @endDate)`,
  );
  const insertWorkItem = db.prepare(
    `INSERT INTO work_item (key, story_key, title, points, status, assignee_id, labels)
     VALUES (@key, @storyKey, @title, @points, @status, @assigneeId, @labels)`,
  );
  const insertDependency = db.prepare(
    `INSERT INTO dependency (id, blocker_item_key, blocked_item_key)
     VALUES (@id, @blockerItemKey, @blockedItemKey)`,
  );
  const insertPlacement = db.prepare(
    `INSERT INTO planned_placement (id, work_item_key, sprint_id, week_index)
     VALUES (@id, @workItemKey, @sprintId, @weekIndex)`,
  );
  const insertSetting = db.prepare(
    `INSERT INTO settings (key, scope, scope_id, value)
     VALUES (@key, @scope, @scopeId, @value)`,
  );

  const run = db.transaction((data: DomainDataset) => {
    for (const table of DELETE_ORDER) db.prepare(`DELETE FROM ${table}`).run();

    for (const t of data.teams) {
      insertTeam.run({ ...t, workingDays: JSON.stringify(t.workingDays) });
    }
    for (const m of data.members) insertMember.run({ ...m, active: bool(m.active) });
    for (const v of data.velocityOverrides) insertVelocity.run({ ...v, note: v.note ?? null });
    for (const p of data.pto) insertPto.run({ ...p, note: p.note ?? null });
    for (const o of data.oncall) insertOncall.run({ ...o, note: o.note ?? null });
    for (const sp of data.sprints) insertSprint.run(sp);
    for (const e of data.epics) insertEpic.run(e);
    for (const ms of data.milestones) insertMilestone.run({ ...ms, isGating: bool(ms.isGating) });
    for (const s of data.stories) insertStory.run(s);
    for (const w of data.workItems) {
      insertWorkItem.run({ ...w, labels: JSON.stringify(w.labels ?? []) });
    }
    for (const d of data.dependencies) insertDependency.run(d);
    for (const p of data.placements) insertPlacement.run(p);
    for (const s of data.settings) {
      insertSetting.run({ ...s, scopeId: scopeIdToDb(s.scopeId) });
    }
  });

  run(dataset);
}

/** Read the full dataset back out of the database (used for verification). */
export function readDataset(db: Db): DomainDataset {
  return {
    teams: db
      .prepare('SELECT * FROM team')
      .all()
      .map((r: any) => ({
        id: r.id,
        name: r.name,
        sprintLengthDays: r.sprint_length_days,
        sprintStartWeekday: r.sprint_start_weekday,
        sprintAnchorDate: r.sprint_anchor_date,
        workingDays: JSON.parse(r.working_days),
      })),
    members: db
      .prepare('SELECT * FROM team_member')
      .all()
      .map((r: any) => ({
        id: r.id,
        teamId: r.team_id,
        name: r.name,
        baseVelocity: r.base_velocity,
        active: r.active === 1,
      })),
    velocityOverrides: db
      .prepare('SELECT * FROM velocity_override')
      .all()
      .map((r: any) => ({
        id: r.id,
        memberId: r.member_id,
        startDate: r.start_date,
        endDate: r.end_date,
        multiplier: r.multiplier,
        note: r.note ?? null,
      })),
    pto: db
      .prepare('SELECT * FROM pto')
      .all()
      .map((r: any) => ({
        id: r.id,
        memberId: r.member_id,
        startDate: r.start_date,
        endDate: r.end_date,
        note: r.note ?? null,
      })),
    oncall: db
      .prepare('SELECT * FROM oncall')
      .all()
      .map((r: any) => ({
        id: r.id,
        memberId: r.member_id,
        startDate: r.start_date,
        endDate: r.end_date,
        note: r.note ?? null,
      })),
    epics: db
      .prepare('SELECT * FROM epic')
      .all()
      .map((r: any) => ({ key: r.key, title: r.title, teamId: r.team_id })),
    milestones: db
      .prepare('SELECT * FROM epic_milestone')
      .all()
      .map((r: any) => ({
        id: r.id,
        epicKey: r.epic_key,
        name: r.name,
        date: r.date,
        isGating: r.is_gating === 1,
      })),
    stories: db
      .prepare('SELECT * FROM user_story')
      .all()
      .map((r: any) => ({ key: r.key, epicKey: r.epic_key, title: r.title })),
    workItems: db
      .prepare('SELECT * FROM work_item')
      .all()
      .map((r: any) => ({
        key: r.key,
        storyKey: r.story_key,
        title: r.title,
        points: r.points,
        status: r.status,
        assigneeId: r.assignee_id,
        labels: r.labels ? JSON.parse(r.labels) : [],
      })),
    dependencies: db
      .prepare('SELECT * FROM dependency')
      .all()
      .map((r: any) => ({
        id: r.id,
        blockerItemKey: r.blocker_item_key,
        blockedItemKey: r.blocked_item_key,
      })),
    sprints: db
      .prepare('SELECT * FROM sprint')
      .all()
      .map((r: any) => ({
        id: r.id,
        teamId: r.team_id,
        name: r.name,
        startDate: r.start_date,
        endDate: r.end_date,
      })),
    placements: db
      .prepare('SELECT * FROM planned_placement')
      .all()
      .map((r: any) => ({
        id: r.id,
        workItemKey: r.work_item_key,
        sprintId: r.sprint_id,
        weekIndex: r.week_index,
      })),
    settings: db
      .prepare('SELECT * FROM settings')
      .all()
      .map(
        (r: any): Setting => ({
          key: r.key,
          scope: r.scope,
          scopeId: scopeIdFromDb(r.scope_id),
          value: r.value,
        }),
      ),
  };
}
