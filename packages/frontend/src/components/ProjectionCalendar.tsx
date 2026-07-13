import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { IsoDate } from '@ecp/shared';
import { addDays, diffDays, formatIso, getWeekday, isWorkingDay, parseIso } from '@ecp/shared';
import type { ProjectionResult, Verdict, WeekVerdict } from '@ecp/engine';
import { sprintWeeks, weekVerdict } from '@ecp/engine';
import type { EpicScope } from '../lib/projection';
import type { AvailabilityEntry } from '../lib/availability';
import { KIND_LABEL } from '../lib/availability';
import { formatDate, formatMonth } from '../lib/format';
import { computeDomain } from '../lib/timeline';
import { MemberAvatar } from './MemberAvatar';

interface ProjectionCalendarProps {
  scope: EpicScope;
  result: ProjectionResult;
  today: IsoDate;
  /** PTO / on-call entries for the team's members (velocity overrides excluded). */
  availability: AvailabilityEntry[];
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Overlay lane geometry (px). The spanning bars sit in a band above the date
// numbers; each lane the week needs adds to the band height, which the day
// cells reserve as top padding so nothing overprints the numbers.
const SPRINT_H = 22;
const WEEK_H = 15;
const AVAIL_H = 20;
const LANE_GAP = 3;
const OVERLAY_TOP = 4;

/** A point-in-time event shown as a pill inside its day cell. */
type PointKind = 'gating' | 'milestone' | 'devcomplete';
interface PointEvent {
  kind: PointKind;
  order: number;
  label: string;
  verdict?: Verdict;
}

/** Toggleable layers exposed by the filter menu. All default to visible. */
type Layer = 'milestones' | 'devComplete' | 'sprints' | 'sprintWeeks' | 'availability';
type Filters = Record<Layer, boolean>;
const FILTER_OPTIONS: ReadonlyArray<{ key: Layer; label: string }> = [
  { key: 'sprints', label: 'Sprints' },
  { key: 'sprintWeeks', label: 'Sprint weeks' },
  { key: 'availability', label: 'Team availability' },
  { key: 'milestones', label: 'Relevant days' },
  { key: 'devComplete', label: 'Dev-complete' },
];

/** A span clipped to a single calendar week, positioned over the 7 columns. */
interface WeekSpan {
  colStart: number;
  colEnd: number;
  /** The span's true start falls in this week (rounded left edge + label). */
  isStart: boolean;
  /** The span's true end falls in this week (rounded right edge). */
  isEnd: boolean;
}

/**
 * A full-width, single-month calendar (Gmail / Outlook style) covering the
 * projection window one month at a time.
 *
 * Multi-day work is drawn as continuous bars that span the days they cover,
 * lifted into a band above the date numbers: sprints are the hero lane, a
 * thinner sub-band splits each sprint into its 7-day weeks, and PTO / on-call
 * run as their own spanning bars. Single-day markers — relevant days (gating
 * highlighted) and the projected dev-complete date — stay as pills on their
 * exact day. The linear timeline above carries the headline dates.
 *
 * Opens on the month containing "today" and pages across the window. Read-only.
 */
export function ProjectionCalendar({ scope, result, today, availability }: ProjectionCalendarProps) {
  const devComplete = result.projectedDevCompleteDate;
  const workingDays = scope.team.workingDays;

  const domain = useMemo(
    () =>
      computeDomain([
        today,
        devComplete,
        ...scope.milestones.map((m) => m.date),
        ...result.sprints.map((s) => s.end),
      ]),
    [today, devComplete, scope.milestones, result.sprints],
  );

  // Single-day pills (relevant days + dev-complete), keyed by date.
  const pointEventsByDay = useMemo(() => {
    const map = new Map<IsoDate, PointEvent[]>();
    const add = (date: IsoDate, ev: PointEvent) => {
      const list = map.get(date) ?? [];
      list.push(ev);
      map.set(date, list);
    };
    for (const m of scope.milestones) {
      add(
        m.date,
        m.isGating
          ? { kind: 'gating', order: 0, label: `${m.name} (gating)` }
          : { kind: 'milestone', order: 2, label: m.name },
      );
    }
    if (devComplete) add(devComplete, { kind: 'devcomplete', order: 1, label: 'Dev-complete', verdict: result.verdict });
    for (const [, list] of map) list.sort((a, b) => a.order - b.order);
    return map;
  }, [scope.milestones, devComplete, result.verdict]);

  // Every sprint's 7-day week windows, flattened for the sub-band.
  const sprintWeekWindows = useMemo(() => {
    const out: { sprintIndex: number; weekIndex: number; start: IsoDate; end: IsoDate }[] = [];
    for (const s of result.sprints) {
      for (const w of sprintWeeks(s.start, s.end, workingDays)) {
        out.push({ sprintIndex: s.index, weekIndex: w.index, start: w.start, end: w.end });
      }
    }
    return out;
  }, [result.sprints, workingDays]);

  // How loaded each sprint is, keyed by its start date so the calendar's
  // engine-derived sprint windows can be matched back to the stored sprints the
  // Gantt planner places work into (they tile off the same cadence, so their
  // start dates coincide). Load = placed, not-done points vs the sprint's
  // capacity, banded green/yellow/red exactly like the Gantt week columns.
  const sprintLoadByStart = useMemo(() => {
    const byItemKey = new Map(scope.workItems.map((w) => [w.key, w]));
    const placedBySprintId = new Map<string, number>();
    for (const p of scope.placements) {
      const item = byItemKey.get(p.workItemKey);
      if (!item || item.status === 'Done') continue;
      placedBySprintId.set(p.sprintId, (placedBySprintId.get(p.sprintId) ?? 0) + item.points);
    }
    const byStart = new Map<IsoDate, number>();
    for (const s of scope.sprints) byStart.set(s.startDate, placedBySprintId.get(s.id) ?? 0);
    return byStart;
  }, [scope.workItems, scope.placements, scope.sprints]);

  /** Placed load + verdict for a calendar sprint window, or `null` if no stored sprint aligns. */
  const loadFor = (start: IsoDate, capacity: number): { placed: number; verdict: WeekVerdict } | null => {
    if (!sprintLoadByStart.has(start)) return null;
    const placed = sprintLoadByStart.get(start)!;
    return { placed, verdict: weekVerdict(placed, capacity, scope.defaults.weekYellowLoadFraction) };
  };

  const months = useMemo(() => monthsBetween(domain.start, domain.end), [domain]);
  const todayMonthIdx = months.findIndex((m) => sameMonth(m, today));
  const [monthIdx, setMonthIdx] = useState(() => (todayMonthIdx >= 0 ? todayMonthIdx : 0));
  const safeIdx = Math.min(Math.max(monthIdx, 0), months.length - 1);
  const monthStart = months[safeIdx]!;
  const monthNum = parseIso(monthStart).getUTCMonth();
  const weeks = useMemo(() => chunkWeeks(monthGridDays(monthStart)), [monthStart]);

  // Layer visibility toggles.
  const [filters, setFilters] = useState<Filters>({
    milestones: true,
    devComplete: true,
    sprints: true,
    sprintWeeks: true,
    availability: true,
  });
  const hiddenCount = FILTER_OPTIONS.filter((o) => !filters[o.key]).length;

  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filterOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFilterOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [filterOpen]);

  return (
    <div className="proj-calendar" data-testid="projection-calendar">
      <div className="cal-toolbar">
        <div className="cal-toolbar-left">
          <h2>Calendar</h2>
          <span className="hint">
            Multi-day work spans across the days it covers; the headline dates stay on the timeline above.
          </span>
        </div>
        <div className="cal-controls">
          <div className="cal-filter" ref={filterRef}>
            <button
              type="button"
              className={`cal-filter-btn${hiddenCount > 0 ? ' has-hidden' : ''}`}
              data-testid="cal-filter-btn"
              aria-haspopup="true"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((v) => !v)}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path
                  d="M1.5 2.5h13l-5 6v5l-3-1.5v-3.5z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
              Filter
              {hiddenCount > 0 && <span className="cal-filter-badge">{hiddenCount}</span>}
            </button>
            {filterOpen && (
              <div className="cal-filter-menu" role="menu" data-testid="cal-filter-menu">
                <div className="cal-filter-title">Show on calendar</div>
                {FILTER_OPTIONS.map((opt) => (
                  <label className="cal-filter-item" key={opt.key} role="menuitemcheckbox" aria-checked={filters[opt.key]}>
                    <input
                      type="checkbox"
                      data-testid={`cal-filter-${opt.key}`}
                      checked={filters[opt.key]}
                      onChange={(e) => setFilters((f) => ({ ...f, [opt.key]: e.target.checked }))}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="cal-nav">
            <button
              type="button"
              className="cal-nav-btn"
              data-testid="cal-prev"
              disabled={safeIdx === 0}
              onClick={() => setMonthIdx(safeIdx - 1)}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="cal-cur-month" data-testid="cal-current-month">
              {formatMonth(monthStart)}
            </span>
            <button
              type="button"
              className="cal-nav-btn"
              data-testid="cal-next"
              disabled={safeIdx === months.length - 1}
              onClick={() => setMonthIdx(safeIdx + 1)}
              aria-label="Next month"
            >
              ›
            </button>
            {todayMonthIdx >= 0 && (
              <button
                type="button"
                className="cal-today-btn"
                data-testid="cal-today-btn"
                disabled={safeIdx === todayMonthIdx}
                onClick={() => setMonthIdx(todayMonthIdx)}
              >
                Today
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="cal-month-grid" data-testid="cal-month-grid">
        <div className="cal-weekhead">
          {WEEKDAY_LABELS.map((w) => (
            <div className="cal-weekday" key={w}>
              {w}
            </div>
          ))}
        </div>

        {weeks.map((week) => {
          const weekStart = week[0]!;
          const weekEnd = week[6]!;

          // --- Spanning bars for this week, split into lanes. -----------------
          const sprintBars = filters.sprints
            ? result.sprints
                .map((s) => ({ s, span: clipToWeek(s.start, s.end, weekStart, weekEnd) }))
                .filter((x): x is { s: (typeof result.sprints)[number]; span: WeekSpan } => x.span !== null)
            : [];
          const weekBars = filters.sprintWeeks
            ? sprintWeekWindows
                .map((w) => ({ w, span: clipToWeek(w.start, w.end, weekStart, weekEnd) }))
                .filter((x): x is { w: (typeof sprintWeekWindows)[number]; span: WeekSpan } => x.span !== null)
            : [];
          const availSpans = filters.availability
            ? availability
                .map((e) => ({ e, span: clipToWeek(e.startDate, e.endDate, weekStart, weekEnd) }))
                .filter((x): x is { e: AvailabilityEntry; span: WeekSpan } => x.span !== null)
            : [];
          const availLanes = packLanes(availSpans, (x) => x.span);

          // Vertical placement of each lane inside the overlay band.
          let top = OVERLAY_TOP;
          const sprintTop = top;
          if (sprintBars.length > 0) top += SPRINT_H + LANE_GAP;
          const weekTop = top;
          if (weekBars.length > 0) top += WEEK_H + LANE_GAP;
          const availTop = top;
          if (availLanes.length > 0) top += availLanes.length * (AVAIL_H + LANE_GAP);
          const barsHeight = top > OVERLAY_TOP ? top : 0;

          const weekStyle = { '--bars-h': `${barsHeight}px` } as CSSProperties;

          return (
            <div className="cal-week" key={weekStart} style={weekStyle}>
              {barsHeight > 0 && (
                <div className="cal-week-overlay" aria-hidden="true">
                  {sprintBars.map(({ s, span }) => {
                    const load = loadFor(s.start, s.capacity);
                    const tone = load ? `load-${load.verdict}` : s.index % 2 === 0 ? 'even' : 'odd';
                    return (
                      <div
                        key={`sprint-${s.index}`}
                        className={`cal-bar sprint ${tone}${spanEdges(span)}`}
                        style={{ ...spanStyle(span), top: sprintTop, height: SPRINT_H }}
                        title={
                          load
                            ? `Sprint ${s.index} · ${load.placed} / ${s.capacity} pts placed (${load.verdict})`
                            : `Sprint ${s.index} · ${s.capacity} pts capacity`
                        }
                        data-load={load?.verdict}
                      >
                        {span.isStart && (
                          <span className="cal-bar-text">
                            Sprint {s.index} · {load ? `${load.placed}/${s.capacity}` : s.capacity} pts
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {weekBars.map(({ w, span }) => (
                    <div
                      key={`week-${w.sprintIndex}-${w.weekIndex}`}
                      className={`cal-bar week${spanEdges(span)}`}
                      style={{ ...spanStyle(span), top: weekTop, height: WEEK_H }}
                      title={`Sprint ${w.sprintIndex} · week ${w.weekIndex + 1}`}
                    >
                      {span.isStart && <span className="cal-bar-text">W{w.weekIndex + 1}</span>}
                    </div>
                  ))}
                  {availLanes.map((lane, laneIdx) =>
                    lane.map(({ e, span }) => (
                      <div
                        key={`avail-${e.kind}-${e.id}`}
                        className={`cal-bar avail kind-${e.kind}${spanEdges(span)}`}
                        style={{ ...spanStyle(span), top: availTop + laneIdx * (AVAIL_H + LANE_GAP), height: AVAIL_H }}
                        title={`${e.memberName} · ${KIND_LABEL[e.kind]} · ${formatDate(e.startDate)} → ${formatDate(e.endDate)}`}
                      >
                        {span.isStart && <MemberAvatar name={e.memberName} color={e.color} size={15} />}
                        <span className="cal-bar-text">
                          {e.memberName} · {KIND_LABEL[e.kind]}
                        </span>
                      </div>
                    )),
                  )}
                </div>
              )}

              <div className="cal-week-days">
                {week.map((date) => {
                  const inMonth = parseIso(date).getUTCMonth() === monthNum;
                  const inRange = date >= domain.start && date <= domain.end;
                  const points = (pointEventsByDay.get(date) ?? []).filter((ev) =>
                    ev.kind === 'devcomplete' ? filters.devComplete : filters.milestones,
                  );
                  const working = isWorkingDay(date, workingDays);
                  const isToday = date === today;

                  const classes = ['cal-cell'];
                  if (!inMonth) classes.push('adjacent');
                  if (!working) classes.push('non-working');
                  if (isToday) classes.push('is-today');

                  return (
                    <div
                      className={classes.join(' ')}
                      key={date}
                      data-testid={`cal-day-${date}`}
                      title={formatDate(date)}
                    >
                      <div className="cal-cell-head">
                        <span className="cal-daynum">{parseIso(date).getUTCDate()}</span>
                      </div>
                      {inRange && points.length > 0 && (
                        <div className="cal-events">
                          {points.map((ev, i) => (
                            <div
                              className={`cal-event ${ev.kind}${ev.verdict ? ` ${ev.verdict}` : ''}`}
                              key={`${ev.kind}-${i}`}
                              title={ev.label}
                            >
                              <span className="cal-event-text">{ev.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="cal-legend">
        <span className="legend-item"><span className="cal-dot today" /> Today</span>
        <span className="legend-item">Sprint load:</span>
        <span className="legend-item"><span className="cal-bar-swatch sprint load-green" /> has slack</span>
        <span className="legend-item"><span className="cal-bar-swatch sprint load-yellow" /> full</span>
        <span className="legend-item"><span className="cal-bar-swatch sprint load-red" /> over capacity</span>
        <span className="legend-item"><span className="cal-bar-swatch week" /> Sprint week</span>
        <span className="legend-item"><span className="cal-bar-swatch pto" /> PTO</span>
        <span className="legend-item"><span className="cal-bar-swatch oncall" /> On-call</span>
        <span className="legend-item"><span className="cal-dot gating" /> Gating relevant day</span>
        <span className="legend-item"><span className="cal-dot milestone" /> Relevant day</span>
        <span className="legend-item"><span className={`cal-dot devcomplete ${result.verdict}`} /> Dev-complete</span>
      </div>
    </div>
  );
}

/** Left / width CSS for a span across the 7 day columns (2px inset each side). */
function spanStyle(span: WeekSpan): CSSProperties {
  const cols = span.colEnd - span.colStart + 1;
  return {
    left: `calc(${((span.colStart / 7) * 100).toFixed(4)}% + 2px)`,
    width: `calc(${((cols / 7) * 100).toFixed(4)}% - 4px)`,
  };
}

/** Edge classes so bars continuing past a week boundary render flat, not rounded. */
function spanEdges(span: WeekSpan): string {
  return `${span.isStart ? '' : ' cont-left'}${span.isEnd ? '' : ' cont-right'}`;
}

/** Clip an inclusive date interval to a calendar week, or `null` if disjoint. */
function clipToWeek(itemStart: IsoDate, itemEnd: IsoDate, weekStart: IsoDate, weekEnd: IsoDate): WeekSpan | null {
  const start = itemStart > weekStart ? itemStart : weekStart;
  const end = itemEnd < weekEnd ? itemEnd : weekEnd;
  if (start > end) return null;
  return {
    colStart: diffDays(weekStart, start),
    colEnd: diffDays(weekStart, end),
    isStart: itemStart >= weekStart && itemStart <= weekEnd,
    isEnd: itemEnd >= weekStart && itemEnd <= weekEnd,
  };
}

/** Greedy interval packing: items that don't overlap share a lane. */
function packLanes<T>(items: T[], spanOf: (item: T) => WeekSpan): T[][] {
  const sorted = [...items].sort((a, b) => {
    const sa = spanOf(a);
    const sb = spanOf(b);
    return sa.colStart - sb.colStart || sa.colEnd - sb.colEnd;
  });
  const lanes: T[][] = [];
  const laneEnd: number[] = [];
  for (const item of sorted) {
    const span = spanOf(item);
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      if (span.colStart > laneEnd[i]!) {
        lanes[i]!.push(item);
        laneEnd[i] = span.colEnd;
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes.push([item]);
      laneEnd.push(span.colEnd);
    }
  }
  return lanes;
}

/** First-of-month ISO dates spanning `[start, end]`, inclusive. */
function monthsBetween(start: IsoDate, end: IsoDate): IsoDate[] {
  const first = parseIso(start);
  const endDt = parseIso(end);
  const out: IsoDate[] = [];
  let d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
  while (d <= endDt) {
    out.push(formatIso(d));
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }
  return out;
}

/** True if two ISO dates fall in the same calendar month. */
function sameMonth(a: IsoDate, b: IsoDate): boolean {
  const da = parseIso(a);
  const db = parseIso(b);
  return da.getUTCFullYear() === db.getUTCFullYear() && da.getUTCMonth() === db.getUTCMonth();
}

/**
 * The days rendered for a month's grid: from the Sunday on/before the 1st
 * through the Saturday on/after the last day, so weeks are always full.
 */
function monthGridDays(monthStartIso: IsoDate): IsoDate[] {
  const first = parseIso(monthStartIso);
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const lastIso = formatIso(lastDay);
  const gridStart = addDays(monthStartIso, -getWeekday(monthStartIso));
  const gridEnd = addDays(lastIso, 6 - getWeekday(lastIso));
  const out: IsoDate[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Split a flat day list (a multiple of 7) into week rows. */
function chunkWeeks(days: IsoDate[]): IsoDate[][] {
  const weeks: IsoDate[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}
