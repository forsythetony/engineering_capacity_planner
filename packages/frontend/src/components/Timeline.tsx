import type { CSSProperties } from 'react';
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

// Timeline geometry (px). The axis sits `AXIS_BASE` from the top; each extra
// label lane needed to keep close labels from overprinting pushes the axis (and
// everything anchored to it) down by one `LANE_HEIGHT`.
const AXIS_BASE = 70;
const LANE_HEIGHT = 48;
const LABEL_GAP = 6; // gap between a lane's label and the axis / the lane below
const LINE_BELOW = 31; // how far a top marker's connector extends past the axis

/**
 * Horizontal timeline: a "today" marker, markers for the epic's relevant days
 * (the gating one highlighted), the projected dev-complete marker colored by
 * verdict, and a buffer band between dev-complete and the gating day.
 *
 * Top labels are assigned vertical lanes so that relevant days falling close
 * together on the axis stack instead of overprinting one another.
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

  // Markers whose labels sit above the axis: "today" plus the epic's milestones.
  const topMarkers = [
    { key: 'today', className: 'today', date: today, label: 'Today' as string, testId: undefined as string | undefined },
    ...scope.milestones.map((m) => ({
      key: m.id,
      className: m.isGating ? 'gating' : 'milestone',
      date: m.date,
      label: m.isGating ? `${m.name} (gating)` : m.name,
      testId: undefined as string | undefined,
    })),
  ];
  const lanes = assignLanes(topMarkers.map((m) => scale.fractionOf(m.date)));
  const laneCount = lanes.reduce((max, l) => Math.max(max, l), 0) + 1;
  const axisTop = AXIS_BASE + (laneCount - 1) * LANE_HEIGHT;

  const rootStyle = {
    '--axis-top': `${axisTop}px`,
    height: `${axisTop + 70}px`,
  } as CSSProperties;

  return (
    <div className="timeline" data-testid="timeline" style={rootStyle}>
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
      {devComplete && scope.gating && <BufferBand from={devComplete} to={scope.gating.date} scale={scale} />}

      {topMarkers.map((m, i) => (
        <Marker
          key={m.key}
          className={m.className}
          date={m.date}
          label={m.label}
          pctOf={pct}
          axisTop={axisTop}
          lane={lanes[i] ?? 0}
        />
      ))}

      {devComplete && (
        <Marker
          className={`devcomplete ${result.verdict}`}
          date={devComplete}
          label="Dev-complete"
          pctOf={pct}
          axisTop={axisTop}
          testId="marker-devcomplete"
          below
        />
      )}
    </div>
  );
}

/**
 * Greedy lane assignment for markers along the axis. Markers whose positions
 * fall within `MIN_LANE_GAP` (as a fraction of the axis width) are pushed to a
 * higher lane so their labels don't overlap. Inputs need not be sorted; lanes
 * are returned in the same order, lane 0 being nearest the axis.
 */
const MIN_LANE_GAP = 0.12;
function assignLanes(fractions: number[]): number[] {
  const order = fractions.map((f, i) => ({ f, i })).sort((a, b) => a.f - b.f);
  const laneLast: number[] = []; // rightmost fraction placed in each lane so far
  const lanes = new Array<number>(fractions.length).fill(0);
  for (const { f, i } of order) {
    let lane = 0;
    while (lane < laneLast.length) {
      const last = laneLast[lane];
      if (last === undefined || f - last >= MIN_LANE_GAP) break;
      lane++;
    }
    laneLast[lane] = f;
    lanes[i] = lane;
  }
  return lanes;
}

function Marker({
  className,
  date,
  label,
  pctOf,
  axisTop,
  lane = 0,
  testId,
  below = false,
}: {
  className: string;
  date: IsoDate;
  label: string;
  pctOf: (d: IsoDate) => string;
  /** Distance from the timeline top to the axis, in px. */
  axisTop: number;
  /** Vertical lane above the axis (0 = nearest). Ignored for `below` markers. */
  lane?: number;
  testId?: string;
  /** Render the label below the axis (avoids colliding with top markers). */
  below?: boolean;
}) {
  const labelEl = (
    <div
      className="marker-label"
      style={below ? { top: axisTop + 26 } : { bottom: LABEL_GAP + lane * LANE_HEIGHT }}
    >
      {label}
      <br />
      <span className="marker-date">{formatDayShort(date)}</span>
    </div>
  );
  const lineStyle = below
    ? { top: axisTop, height: 22 }
    : { top: axisTop - LABEL_GAP - lane * LANE_HEIGHT, height: LINE_BELOW + LABEL_GAP + lane * LANE_HEIGHT };
  const lineEl = <div className="marker-line" style={lineStyle} />;
  return (
    <div
      className={`marker ${className}${below ? ' below' : ''}`}
      style={{ left: pctOf(date), height: axisTop }}
      data-testid={testId}
    >
      {labelEl}
      {lineEl}
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
