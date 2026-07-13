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

type MarkKind = 'today' | 'gating' | 'milestone' | 'devcomplete';
interface DayMark {
  kind: MarkKind;
  label: string;
  verdict?: Verdict;
}

/**
 * A month-grid calendar of the same projection window the linear timeline
 * covers, giving day-level detail the bar view can't: exact placement of
 * "today", each relevant day (gating highlighted), the projected dev-complete
 * date (verdict-colored), sprint groupings, and who's out (PTO / on-call) on any
 * given day. It is read-only — the projection is driven from Configuration.
 */
export function ProjectionCalendar({ scope, result, today, availability }: ProjectionCalendarProps) {
  const devComplete = result.projectedDevCompleteDate;
  const domain = computeDomain([
    today,
    devComplete,
    ...scope.milestones.map((m) => m.date),
    ...result.sprints.map((s) => s.end),
  ]);

  // Day → event chips (only for days inside the projection window).
  const marks = new Map<IsoDate, DayMark[]>();
  const addMark = (date: IsoDate, mark: DayMark) => {
    if (date < domain.start || date > domain.end) return;
    const list = marks.get(date) ?? [];
    list.push(mark);
    marks.set(date, list);
  };
  addMark(today, { kind: 'today', label: 'Today' });
  for (const m of scope.milestones) {
    addMark(m.date, { kind: m.isGating ? 'gating' : 'milestone', label: m.name });
  }
  if (devComplete) addMark(devComplete, { kind: 'devcomplete', label: 'Dev-complete', verdict: result.verdict });

  // Day → sprint (for background grouping) and sprint-start labels.
  const sprintStarts = new Map<IsoDate, { index: number; capacity: number }>();
  for (const s of result.sprints) sprintStarts.set(s.start, { index: s.index, capacity: s.capacity });
  const sprintIndexFor = (date: IsoDate): number | null => {
    for (const s of result.sprints) if (date >= s.start && date <= s.end) return s.index;
    return null;
  };

  // Day → who's out (PTO / on-call). Ranges are inclusive.
  const availByDay = new Map<IsoDate, AvailabilityEntry[]>();
  for (const entry of availability) {
    for (let d = entry.startDate; d <= entry.endDate; d = addDays(d, 1)) {
      if (d < domain.start || d > domain.end) continue;
      const list = availByDay.get(d) ?? [];
      list.push(entry);
      availByDay.set(d, list);
    }
  }

  const months = monthsBetween(domain.start, domain.end);

  return (
    <div className="proj-calendar" data-testid="projection-calendar">
      <div className="section-title">
        <h2>Calendar</h2>
        <span className="hint">Day-by-day view of the projection window: relevant days, dev-complete, sprints, and who's out.</span>
      </div>

      <div className="cal-months">
        {months.map((monthStart) => {
          const days = daysOfMonth(monthStart);
          const leadingBlanks = getWeekday(days[0]!);
          return (
            <section className="cal-card" key={monthStart} data-testid={`cal-month-${monthStart}`}>
              <h3 className="cal-card-title">{formatMonth(monthStart)}</h3>
              <div className="cal-grid" role="grid">
                {WEEKDAY_LABELS.map((w) => (
                  <div className="cal-weekday" key={w} role="columnheader">
                    {w}
                  </div>
                ))}
                {Array.from({ length: leadingBlanks }, (_, i) => (
                  <div className="cal-cell blank" key={`blank-${i}`} aria-hidden="true" />
                ))}
                {days.map((date) => {
                  const inRange = date >= domain.start && date <= domain.end;
                  const dayMarks = marks.get(date) ?? [];
                  const sprint = sprintIndexFor(date);
                  const sprintStart = sprintStarts.get(date);
                  const outToday = availByDay.get(date) ?? [];
                  const working = isWorkingDay(date, scope.team.workingDays);
                  const isToday = date === today;

                  const classes = ['cal-cell'];
                  if (!inRange) classes.push('out-of-range');
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
                      <div className="cal-cell-top">
                        <span className="cal-day-num">{parseIso(date).getUTCDate()}</span>
                      </div>
                      {sprintStart && (
                        <span className="cal-sprint-tag" title={`Sprint ${sprintStart.index} starts · ${sprintStart.capacity} pts capacity`}>
                          S{sprintStart.index}
                        </span>
                      )}

                      {dayMarks.length > 0 && (
                        <div className="cal-marks">
                          {dayMarks.map((m, i) => (
                            <span
                              className={`cal-mark ${m.kind}${m.verdict ? ` ${m.verdict}` : ''}`}
                              key={`${m.kind}-${i}`}
                              title={m.label}
                            >
                              {m.label}
                            </span>
                          ))}
                        </div>
                      )}

                      {outToday.length > 0 && (
                        <div className="cal-out">
                          {outToday.map((e) => (
                            <MemberAvatar
                              key={`${e.kind}-${e.id}`}
                              name={e.memberName}
                              color={e.color}
                              size={16}
                              className={`kind-${e.kind}`}
                              title={`${e.memberName} · ${KIND_LABEL[e.kind]} · ${formatDate(e.startDate)} → ${formatDate(e.endDate)}`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="cal-legend">
        <span className="legend-item"><span className="cal-swatch today" /> Today</span>
        <span className="legend-item"><span className="cal-swatch gating" /> Gating relevant day</span>
        <span className="legend-item"><span className="cal-swatch milestone" /> Relevant day</span>
        <span className="legend-item"><span className={`cal-swatch devcomplete ${result.verdict}`} /> Dev-complete</span>
        <span className="legend-item"><span className="cal-swatch sprint" /> Sprint shading (S# marks each start)</span>
        <span className="legend-item">◦ Avatar = member out (PTO / on-call)</span>
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

/** Every day of the month that `firstIso` (a first-of-month date) belongs to. */
function daysOfMonth(firstIso: IsoDate): IsoDate[] {
  const first = parseIso(firstIso);
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const out: IsoDate[] = [];
  let d = new Date(Date.UTC(year, month, 1));
  while (d.getUTCMonth() === month) {
    out.push(formatIso(d));
    d = new Date(Date.UTC(year, month, d.getUTCDate() + 1));
  }
  return out;
}
