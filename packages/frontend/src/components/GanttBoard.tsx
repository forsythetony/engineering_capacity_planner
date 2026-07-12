import { useMemo, useState } from 'react';
import { colorFor, memberColorMap } from '../lib/memberColors';
import { formatDayShort } from '../lib/format';
import { buildGanttView, ganttCell, type MemberWeekCapacity } from '../lib/gantt';
import type { EpicScope } from '../lib/projection';
import { MemberAvatar } from './MemberAvatar';

/** DOM-safe slug for test ids and keys. */
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/**
 * The Gantt Planner tab (project plan §6a) — read-only for now. It zooms into a
 * sprint and breaks it out week by week: each week column carries a
 * green/yellow/red capacity verdict, the rows are epic subdivisions (from
 * labels), and the engineer strip opens a per-person weekly-capacity breakdown.
 * Dragging work in from the bag lands in the next slice.
 */
export function GanttBoard({ scope }: { scope: EpicScope }) {
  const [sprintId, setSprintId] = useState<string | null>(scope.sprints[0]?.id ?? null);
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  const view = useMemo(() => buildGanttView(scope, sprintId), [scope, sprintId]);
  const colors = useMemo(() => memberColorMap(scope.members), [scope.members]);

  if (scope.sprints.length === 0) {
    return (
      <div className="panel" data-testid="gantt-board">
        <p className="footnote">No sprints are configured for this team yet.</p>
      </div>
    );
  }

  const weeks = view.weeks;
  const gridStyle = { gridTemplateColumns: `220px repeat(${weeks.length}, minmax(150px, 1fr))` };
  const openMember = view.members.find((m) => m.member.id === openMemberId) ?? null;

  return (
    <div className="panel gantt" data-testid="gantt-board">
      <div className="gantt-toolbar">
        <label className="gantt-sprint">
          Sprint
          <select
            data-testid="gantt-sprint-select"
            value={view.sprint?.id ?? ''}
            onChange={(e) => setSprintId(e.target.value)}
          >
            {scope.sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {formatDayShort(s.startDate)}–{formatDayShort(s.endDate)}
              </option>
            ))}
          </select>
        </label>
        <div className="gantt-legend">
          <span className="chip-legend green">green — has slack</span>
          <span className="chip-legend yellow">yellow — full</span>
          <span className="chip-legend red">red — over capacity</span>
        </div>
      </div>

      <div className="gantt-grid" style={gridStyle} data-testid="gantt-grid">
        {/* Header row: corner + one cell per week. */}
        <div className="gantt-corner">
          Subdivision
          <span className="gantt-corner-sub">LOE (pts)</span>
        </div>
        {weeks.map((w) => (
          <div
            key={w.index}
            className={`gantt-week ${w.verdict}`}
            data-testid={`gantt-week-${w.index}`}
            data-verdict={w.verdict}
          >
            <div className="gantt-week-dates">
              {formatDayShort(w.start)}–{formatDayShort(w.end)}
            </div>
            <div className="gantt-week-load">
              <strong>{w.placedPoints}</strong> / {w.capacity} pts
            </div>
          </div>
        ))}

        {/* One row per lane. */}
        {view.lanes.map((lane) => (
          <LaneRow key={lane.label} lane={lane} weeks={weeks} view={view} />
        ))}
      </div>

      {/* Engineer strip. */}
      <div className="gantt-engineers" data-testid="gantt-engineer-strip">
        <span className="gantt-engineers-label">Capacity by engineer — click for the weekly breakdown</span>
        <div className="gantt-engineers-row">
          {view.members.map((mc) => (
            <button
              key={mc.member.id}
              type="button"
              className="gantt-engineer"
              data-testid={`gantt-engineer-${mc.member.id}`}
              onClick={() => setOpenMemberId(mc.member.id)}
              title={`${mc.member.name} — ${mc.total} pts this sprint`}
            >
              <MemberAvatar name={mc.member.name} color={colorFor(colors, mc.member.id)} size={26} />
            </button>
          ))}
        </div>
      </div>

      {/* Backlog bag (read-only in this slice; draggable next). */}
      <div className="gantt-bag" data-testid="gantt-bag">
        <div className="gantt-bag-head">
          Backlog bag <span className="gantt-bag-count">{view.bag.length}</span>
          <span className="gantt-bag-hint">Unassigned, unreserved work — drag-to-place lands next.</span>
        </div>
        <div className="gantt-bag-items">
          {view.bag.map((item) => (
            <span
              key={item.key}
              className="gantt-chip bag"
              data-testid={`gantt-bag-item-${item.key}`}
              title={item.title}
            >
              <strong>{item.key}</strong> {item.points}p
            </span>
          ))}
          {view.bag.length === 0 && <span className="footnote">Nothing left in the bag.</span>}
        </div>
      </div>

      {openMember && (
        <EngineerModal member={openMember} weeks={weeks} onClose={() => setOpenMemberId(null)} />
      )}
    </div>
  );
}


function LaneRow({
  lane,
  weeks,
  view,
}: {
  lane: { label: string; totalPoints: number };
  weeks: ReturnType<typeof buildGanttView>['weeks'];
  view: ReturnType<typeof buildGanttView>;
}) {
  return (
    <>
      <div className="gantt-lane-head" data-testid={`gantt-lane-${slug(lane.label)}`}>
        {lane.label}
        <span className="gantt-lane-total">{lane.totalPoints}p</span>
      </div>
      {weeks.map((w) => {
        const cell = ganttCell(view, lane.label, w.index);
        return (
          <div
            key={w.index}
            className="gantt-cell"
            data-testid={`gantt-cell-${slug(lane.label)}-${w.index}`}
          >
            {cell?.items.map((item) => (
              <span
                key={item.key}
                className={`gantt-chip${item.status === 'Done' ? ' done' : ''}`}
                data-testid={`gantt-chip-${item.key}`}
                title={`${item.title} — ${item.status}`}
              >
                <strong>{item.key}</strong> {item.points}p
              </span>
            ))}
          </div>
        );
      })}
    </>
  );
}

function EngineerModal({
  member,
  weeks,
  onClose,
}: {
  member: MemberWeekCapacity;
  weeks: ReturnType<typeof buildGanttView>['weeks'];
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose} data-testid="gantt-engineer-modal">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{member.member.name}</strong>
          <span className="footnote">{member.total} pts this sprint</span>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <ul className="modal-weeks">
          {weeks.map((w, i) => (
            <li key={w.index}>
              <span>
                {formatDayShort(w.start)}–{formatDayShort(w.end)}
              </span>
              <strong>{member.perWeek[i] ?? 0} pts</strong>
            </li>
          ))}
        </ul>
        {member.notes.length > 0 && (
          <ul className="modal-notes">
            {member.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
