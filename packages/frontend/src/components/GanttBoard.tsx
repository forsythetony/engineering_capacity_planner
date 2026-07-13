import { useEffect, useMemo, useState } from 'react';
import type { PlannedPlacement, WorkItem } from '@ecp/shared';
import * as api from '../data/api';
import type { DatasetSource } from '../data/loadDataset';
import { colorFor, memberColorMap } from '../lib/memberColors';
import { formatDayShort } from '../lib/format';
import { buildGanttView, ganttCell, type GanttView, type MemberWeekCapacity } from '../lib/gantt';
import type { EpicScope } from '../lib/projection';
import { MemberAvatar } from './MemberAvatar';
import { WorkCard, type CardAssignee } from './WorkCard';

/** Resolve a work item's assignee to a name + identity color, or null. */
type AssigneeOf = (item: WorkItem) => CardAssignee | null;

/** DOM-safe slug for test ids and keys. */
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** The key a drag carries. */
const DND_KEY = 'text/plain';

/**
 * The Gantt Planner tab (project plan §6a). Zooms into a sprint and breaks it
 * out week by week: each week column carries a green/yellow/red capacity
 * verdict, rows are epic subdivisions (from labels), and you drag work out of
 * the backlog "bag" into a week — the week recolors live as its load changes.
 * The engineer strip opens a per-person weekly-capacity breakdown.
 *
 * Placements persist via the API when a backend is connected; without one they
 * live in memory (like the Timeline tab's what-if edits), so the flow still
 * works — and e2e still passes — offline.
 */
export function GanttBoard({ scope, source }: { scope: EpicScope; source: DatasetSource }) {
  const [sprintId, setSprintId] = useState<string | null>(scope.sprints[0]?.id ?? null);
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  const [placements, setPlacements] = useState<PlannedPlacement[]>(scope.placements);
  const [dragOverWeek, setDragOverWeek] = useState<number | null>(null);
  const [dragOverBag, setDragOverBag] = useState(false);

  // Re-sync when the underlying dataset changes (e.g. after a reload).
  useEffect(() => setPlacements(scope.placements), [scope.placements]);

  const liveScope = useMemo(() => ({ ...scope, placements }), [scope, placements]);
  const view = useMemo(() => buildGanttView(liveScope, sprintId), [liveScope, sprintId]);
  const colors = useMemo(() => memberColorMap(scope.members), [scope.members]);

  const byKey = useMemo(() => new Map(scope.workItems.map((w) => [w.key, w])), [scope.workItems]);
  const membersById = useMemo(() => new Map(scope.members.map((m) => [m.id, m])), [scope.members]);
  const assigneeOf = useMemo<AssigneeOf>(
    () => (item) => {
      if (!item.assigneeId) return null;
      const m = membersById.get(item.assigneeId);
      return m ? { name: m.name, color: colorFor(colors, m.id) } : null;
    },
    [membersById, colors],
  );
  const sprint = view.sprint;

  function place(key: string, weekIndex: number): void {
    if (!sprint || !byKey.has(key)) return;
    setPlacements((prev) => [
      ...prev.filter((p) => p.workItemKey !== key),
      { id: `local-${key}`, workItemKey: key, sprintId: sprint.id, weekIndex },
    ]);
    if (source === 'api') {
      api
        .placeWorkItem({ workItemKey: key, sprintId: sprint.id, weekIndex })
        // eslint-disable-next-line no-console
        .catch((e) => console.error('Failed to persist placement', e));
    }
  }

  function unplace(key: string): void {
    if (!placements.some((p) => p.workItemKey === key)) return;
    setPlacements((prev) => prev.filter((p) => p.workItemKey !== key));
    if (source === 'api') {
      // eslint-disable-next-line no-console
      api.unplaceWorkItem(key).catch((e) => console.error('Failed to remove placement', e));
    }
  }

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

  // Step one sprint at a time through the (start-ordered) sprint list.
  const sprintIdx = scope.sprints.findIndex((s) => s.id === sprint?.id);
  const stepSprint = (delta: number): void => {
    const next = scope.sprints[sprintIdx + delta];
    if (next) setSprintId(next.id);
  };

  const dropHandlers = (weekIndex: number) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverWeek(weekIndex);
    },
    onDragLeave: () => setDragOverWeek((w) => (w === weekIndex ? null : w)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const key = e.dataTransfer.getData(DND_KEY);
      if (key) place(key, weekIndex);
      setDragOverWeek(null);
    },
  });

  const startDrag = (key: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData(DND_KEY, key);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="panel gantt" data-testid="gantt-board">
      <div className="gantt-toolbar">
        <div className="gantt-sprint">
          <label className="gantt-sprint-label" htmlFor="gantt-sprint-select">
            Sprint
          </label>
          <div className="gantt-sprint-picker">
            <button
              type="button"
              className="gantt-sprint-arrow"
              data-testid="gantt-sprint-prev"
              onClick={() => stepSprint(-1)}
              disabled={sprintIdx <= 0}
              aria-label="Previous sprint"
              title="Previous sprint"
            >
              ‹
            </button>
            <select
              id="gantt-sprint-select"
              data-testid="gantt-sprint-select"
              value={sprint?.id ?? ''}
              onChange={(e) => setSprintId(e.target.value)}
            >
              {scope.sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {formatDayShort(s.startDate)}–{formatDayShort(s.endDate)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="gantt-sprint-arrow"
              data-testid="gantt-sprint-next"
              onClick={() => stepSprint(1)}
              disabled={sprintIdx < 0 || sprintIdx >= scope.sprints.length - 1}
              aria-label="Next sprint"
              title="Next sprint"
            >
              ›
            </button>
          </div>
        </div>
        <div className="gantt-legend">
          <span className="chip-legend green">green — has slack</span>
          <span className="chip-legend yellow">yellow — full</span>
          <span className="chip-legend red">red — over capacity</span>
        </div>
      </div>

      <div className="gantt-grid" style={gridStyle} data-testid="gantt-grid">
        <div className="gantt-corner">
          Subdivision
          <span className="gantt-corner-sub">LOE (pts)</span>
        </div>
        {weeks.map((w) => (
          <div
            key={w.index}
            className={`gantt-week ${w.verdict}${dragOverWeek === w.index ? ' drop-target' : ''}`}
            data-testid={`gantt-week-${w.index}`}
            data-verdict={w.verdict}
            {...dropHandlers(w.index)}
          >
            <div className="gantt-week-dates">
              {formatDayShort(w.start)}–{formatDayShort(w.end)}
            </div>
            <div className="gantt-week-load">
              <strong>{w.placedPoints}</strong> / {w.capacity} pts
            </div>
          </div>
        ))}

        {view.lanes.map((lane) => (
          <LaneRow
            key={lane.label}
            lane={lane}
            weeks={weeks}
            view={view}
            dragOverWeek={dragOverWeek}
            dropHandlers={dropHandlers}
            startDrag={startDrag}
            assigneeOf={assigneeOf}
          />
        ))}
      </div>

      <div className="gantt-engineers" data-testid="gantt-engineer-strip">
        <span className="gantt-engineers-label">
          Capacity by engineer — click for the weekly breakdown
        </span>
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
              <MemberAvatar name={mc.member.name} color={colorFor(colors, mc.member.id)} size={26} avatarUrl={mc.member.avatarUrl} />
            </button>
          ))}
        </div>
      </div>

      <div
        className={`gantt-bag${dragOverBag ? ' drop-target' : ''}`}
        data-testid="gantt-bag"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverBag(true);
        }}
        onDragLeave={() => setDragOverBag(false)}
        onDrop={(e) => {
          e.preventDefault();
          const key = e.dataTransfer.getData(DND_KEY);
          if (key) unplace(key);
          setDragOverBag(false);
        }}
      >
        <div className="gantt-bag-head">
          Backlog bag <span className="gantt-bag-count">{view.bag.length}</span>
          <span className="gantt-bag-hint">
            Unassigned, unreserved work — drag a card into a week to plan it.
          </span>
        </div>
        <div className="gantt-bag-items">
          {view.bag.map((item) => (
            <WorkCard
              key={item.key}
              item={item}
              assignee={assigneeOf(item)}
              variant="bag"
              testId={`gantt-bag-item-${item.key}`}
              onDragStart={startDrag(item.key)}
            />
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
  dragOverWeek,
  dropHandlers,
  startDrag,
  assigneeOf,
}: {
  lane: { label: string; totalPoints: number };
  weeks: GanttView['weeks'];
  view: GanttView;
  dragOverWeek: number | null;
  dropHandlers: (weekIndex: number) => Record<string, unknown>;
  startDrag: (key: string) => (e: React.DragEvent) => void;
  assigneeOf: AssigneeOf;
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
            className={`gantt-cell${dragOverWeek === w.index ? ' drop-target' : ''}`}
            data-testid={`gantt-cell-${slug(lane.label)}-${w.index}`}
            {...dropHandlers(w.index)}
          >
            {cell?.items.map((item: WorkItem) => (
              <WorkCard
                key={item.key}
                item={item}
                assignee={assigneeOf(item)}
                variant="cell"
                testId={`gantt-chip-${item.key}`}
                onDragStart={startDrag(item.key)}
              />
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
  weeks: GanttView['weeks'];
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
