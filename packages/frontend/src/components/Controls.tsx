import type { Scenario } from '../lib/projection';

interface ControlsProps {
  scenario: Scenario;
  onChange: (patch: Partial<Scenario>) => void;
  onReset: () => void;
}

/** The live "knobs": today, green buffer threshold, on-call multiplier. */
export function Controls({ scenario, onChange, onReset }: ControlsProps) {
  return (
    <div className="controls">
      <div className="control">
        <label htmlFor="today">Today</label>
        <input
          id="today"
          type="date"
          data-testid="today-input"
          value={scenario.today}
          onChange={(e) => onChange({ today: e.target.value })}
        />
      </div>

      <div className="control">
        <label htmlFor="green-min">Green buffer ≥ (working days)</label>
        <input
          id="green-min"
          type="number"
          min={0}
          max={60}
          data-testid="green-min-input"
          value={scenario.greenMinBufferDays}
          onChange={(e) => onChange({ greenMinBufferDays: Number(e.target.value) })}
        />
      </div>

      <div className="control">
        <label htmlFor="oncall">
          On-call multiplier <span className="range-value">{scenario.oncallMultiplier.toFixed(2)}</span>
        </label>
        <input
          id="oncall"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={scenario.oncallMultiplier}
          onChange={(e) => onChange({ oncallMultiplier: Number(e.target.value) })}
        />
      </div>

      <button type="button" className="btn" data-testid="reset" onClick={onReset}>
        Reset scenario
      </button>
    </div>
  );
}
