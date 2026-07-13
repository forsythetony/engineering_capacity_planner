import { useMemo, useState } from 'react';
import type { IsoDate } from '@ecp/shared';
import { addDays, formatIso, getWeekday, isWorkingDay, parseIso } from '@ecp/shared';
import type { ProjectionResult, Verdict } from '@ecp/engine';
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

type EventKind = 'gating' | 'milestone' | 'devcomplete' | 'sprint' | 'avail';
interface CalEvent {
  kind: EventKind;
  /** Stacking order within a day cell (lower = higher up). */
  order: number;
  label: string;
  verdict?: Verdict;
  /** Present for `avail` events. */
  entry?: AvailabilityEntry;
}

/**
 * A full-width, single-month calendar (Gmail / Outlook style) covering the
 * projection window one month at a time. The linear timeline above carries the
 * headline dates; this view uses the extra real estate to spell each day out:
 * relevant days (gating highlighted), the projected dev-complete date
 * (verdict-colored), sprint starts + shading, and who's out (PTO / on-call).
 *
 * It opens on the month containing "today" and pages month-by-month across the
 * window. Read-only — the projection is driven from Configuration.
 */
export function ProjectionCalendar({ scope, result, today, availability }: ProjectionCalendarProps) {
  const devComplete = result.projectedDevCompleteDate;

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

  // Day → the events shown in that cell, pre-sorted for a stable stack order.
  const eventsByDay = useMemo(() => {
    const map = new Map<IsoDate, CalEvent[]>();
    const add = (date: IsoDate, ev: CalEvent) => {
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
    if (devComplete) {
      add(devComplete, { kind: 'devcomplete', order: 1, label: 'Dev-complete', verdict: result.verdict });
    }
    for (const s of result.sprints) {
      add(s.start, { kind: 'sprint', order: 3, label: `Sprint ${s.index} · ${s.capacity} pts` });
    }
    for (const entry of availability) {
      for (let d = entry.startDate; d <= entry.endDate; d = addDays(d, 1)) {
        add(d, { kind: 'avail', order: 4, label: `${entry.memberName} · ${KIND_LABEL[entry.kind]}`, entry });
      }
    }
    for (const [, list] of map) list.sort((a, b) => a.order - b.order);
    return map;
  }, [scope.milestones, devComplete, result.verdict, result.sprints, availability]);

  const sprintIndexFor = (date: IsoDate): number | null => {
    for (const s of result.sprints) if (date >= s.start && date <= s.end) return s.index;
    return null;
  };

  const months = useMemo(() => monthsBetween(domain.start, domain.end), [domain]);
  const todayMonthIdx = months.findIndex((m) => sameMonth(m, today));
  const [monthIdx, setMonthIdx] = useState(() => (todayMonthIdx >= 0 ? todayMonthIdx : 0));
  // Clamp against a domain that may have changed since the last render.
  const safeIdx = Math.min(Math.max(monthIdx, 0), months.length - 1);
  const monthStart = months[safeIdx]!;
  const monthNum = parseIso(monthStart).getUTCMonth();
  const gridDays = useMemo(() => monthGridDays(monthStart), [monthStart]);

  return (
    <div className="proj-calendar" data-testid="projection-calendar">
      <div className="cal-toolbar">
        <div className="cal-toolbar-left">
          <h2>Calendar</h2>
          <span className="hint">
            Day-by-day detail for the projection window — the headline dates stay on the timeline above.
          </span>
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

      <div className="cal-month-grid" role="grid">
        {WEEKDAY_LABELS.map((w) => (
          <div className="cal-weekday" role="columnheader" key={w}>
            {w}
          </div>
        ))}
        {gridDays.map((date) => {
          const inMonth = parseIso(date).getUTCMonth() === monthNum;
          const inRange = date >= domain.start && date <= domain.end;
          const events = eventsByDay.get(date) ?? [];
          const sprint = sprintIndexFor(date);
          const working = isWorkingDay(date, scope.team.workingDays);
          const isToday = date === today;

          const classes = ['cal-cell'];
          if (!inMonth) classes.push('adjacent');
          if (!working) classes.push('non-working');
          if (isToday) classes.push('is-today');
          if (sprint !== null) classes.push(sprint % 2 === 0 ? 'sprint-even' : 'sprint-odd');

          return (
            <div
              className={classes.join(' ')}
              key={date}
              role="gridcell"
              data-testid={`cal-day-${date}`}
              title={sprint !== null ? `Sprint ${sprint} · ${formatDate(date)}` : formatDate(date)}
            >
              <div className="cal-cell-head">
                <span className="cal-daynum">{parseIso(date).getUTCDate()}</span>
              </div>

              {inRange && events.length > 0 && (
                <div className="cal-events">
                  {events.map((ev, i) =>
                    ev.kind === 'avail' && ev.entry ? (
                      <div
                        className={`cal-event avail kind-${ev.entry.kind}`}
                        key={`avail-${ev.entry.kind}-${ev.entry.id}`}
                        title={`${ev.label} · ${formatDate(ev.entry.startDate)} → ${formatDate(ev.entry.endDate)}`}
                      >
                        <MemberAvatar name={ev.entry.memberName} color={ev.entry.color} size={16} />
                        <span className="cal-event-text">
                          {ev.entry.memberName} · {KIND_LABEL[ev.entry.kind]}
                        </span>
                      </div>
                    ) : (
                      <div
                        className={`cal-event ${ev.kind}${ev.verdict ? ` ${ev.verdict}` : ''}`}
                        key={`${ev.kind}-${i}`}
                        title={ev.label}
                      >
                        <span className="cal-event-text">{ev.label}</span>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="cal-legend">
        <span className="legend-item"><span className="cal-dot today" /> Today</span>
        <span className="legend-item"><span className="cal-dot gating" /> Gating relevant day</span>
        <span className="legend-item"><span className="cal-dot milestone" /> Relevant day</span>
        <span className="legend-item"><span className={`cal-dot devcomplete ${result.verdict}`} /> Dev-complete</span>
        <span className="legend-item"><span className="cal-dot sprint" /> Sprint start / shading</span>
        <span className="legend-item"><span className="cal-dot pto" /> PTO</span>
        <span className="legend-item"><span className="cal-dot oncall" /> On-call</span>
      </div>
    </div>
  );
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
 * through the Saturday on/after the last day, so weeks are always full (leading
 * and trailing cells fall in the adjacent months, dimmed in the UI).
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
