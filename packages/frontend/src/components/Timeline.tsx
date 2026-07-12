import type { IsoDate } from '@ecp/shared';
import type { ProjectionResult } from '@ecp/engine';
import type { EpicScope } from '../lib/projection';
import { formatDayShort, formatMonth } from '../lib/format';
import { computeDomain, makeScale, monthTicks } from '../lib/timeline';

interface TimelineProps {
  scope: EpicScope;
  result: ProjectionResult;
  today: IsoDate;
}

/**
 * Horizontal timeline: a "today" marker, markers for the epic's relevant days
 * (the gating one highlighted), the projected dev-complete marker colored by
 * verdict, and a buffer band between dev-complete and the gating day.
 */
export function Timeline({ scope, result, today }: TimelineProps) {
  const devComplete = result.projectedDevCompleteDate;
  const domain = computeDomain([
    today,
    devComplete,
    ...scope.milestones.map((m) => m.date),
    ...result.sprints.map((s) => s.end),
  ]);
  const scale = makeScale(domain.start, domain.end);
  const pct = (d: IsoDate) => `${(scale.fractionOf(d) * 100).toFixed(3)}%`;

  return (
    <div className="timeline" data-testid="timeline">
      <div className="timeline-axis" />

      {result.sprints.map((s) => (
        <div
          key={s.index}
          className="sprint-band"
          style={{ left: pct(s.start), width: `${(scale.fractionOf(s.end) - scale.fractionOf(s.start)) * 100}%` }}
          title={`Sprint ${s.index}: ${s.capacity} pts capacity`}
        >
          {s.capacity}p
        </div>
      ))}

      {monthTicks(domain.start, domain.end).map((t) => (
        <div key={t} className="month-tick" style={{ left: pct(t) }}>
          {formatMonth(t)}
        </div>
      ))}

      {/* Buffer band between dev-complete and the gating day. */}
      {devComplete && <BufferBand from={devComplete} to={scope.gating.date} scale={scale} />}

      <Marker className="today" date={today} label="Today" pctOf={pct} />

      {scope.milestones.map((m) => (
        <Marker
          key={m.id}
          className={m.isGating ? 'gating' : 'milestone'}
          date={m.date}
          label={m.isGating ? `${m.name} (gating)` : m.name}
          pctOf={pct}
        />
      ))}

      {devComplete && (
        <Marker
          className={`devcomplete ${result.verdict}`}
          date={devComplete}
          label="Dev-complete"
          pctOf={pct}
          testId="marker-devcomplete"
          below
        />
      )}
    </div>
  );
}

function Marker({
  className,
  date,
  label,
  pctOf,
  testId,
  below = false,
}: {
  className: string;
  date: IsoDate;
  label: string;
  pctOf: (d: IsoDate) => string;
  testId?: string;
  /** Render the label below the axis (avoids colliding with top markers). */
  below?: boolean;
}) {
  const labelEl = (
    <div className="marker-label">
      {label}
      <br />
      <span className="marker-date">{formatDayShort(date)}</span>
    </div>
  );
  const lineEl = <div className="marker-line" />;
  return (
    <div
      className={`marker ${className}${below ? ' below' : ''}`}
      style={{ left: pctOf(date) }}
      data-testid={testId}
    >
      {below ? lineEl : labelEl}
      {below ? labelEl : lineEl}
    </div>
  );
}

function BufferBand({
  from,
  to,
  scale,
}: {
  from: IsoDate;
  to: IsoDate;
  scale: ReturnType<typeof makeScale>;
}) {
  const a = scale.fractionOf(from);
  const b = scale.fractionOf(to);
  const left = Math.min(a, b);
  const width = Math.abs(b - a);
  const positive = to >= from;
  return (
    <div
      className={`buffer-band ${positive ? 'positive' : 'negative'}`}
      style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
    />
  );
}
