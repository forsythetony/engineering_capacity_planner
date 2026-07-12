import type { ProjectionResult } from '@ecp/engine';
import { formatFullDay, VERDICT_LABEL } from '../lib/format';

/** The big green/yellow/red banner: verdict, reasoning, and headline metrics. */
export function StatusStrip({ result }: { result: ProjectionResult }) {
  const { verdict } = result;
  return (
    <div className={`status-strip ${verdict}`} data-testid="status-strip" data-verdict={verdict}>
      <div className="status-dot" />
      <div className="status-body">
        <div className="status-label" data-testid="verdict-label">
          {VERDICT_LABEL[verdict]}
        </div>
        <div className="status-reason">{result.reason}</div>
      </div>
      <div className="status-metrics">
        <div className="metric">
          <div className="metric-value" data-testid="dev-complete">
            {result.projectedDevCompleteDate
              ? formatFullDay(result.projectedDevCompleteDate)
              : '—'}
          </div>
          <div className="metric-label">Projected dev-complete</div>
        </div>
        <div className="metric">
          <div className="metric-value" data-testid="buffer">
            {result.bufferWorkingDays ?? '—'}
          </div>
          <div className="metric-label">Buffer (working days)</div>
        </div>
        <div className="metric">
          <div className="metric-value" data-testid="remaining-points">
            {result.remainingPoints}
          </div>
          <div className="metric-label">Points remaining</div>
        </div>
      </div>
    </div>
  );
}
