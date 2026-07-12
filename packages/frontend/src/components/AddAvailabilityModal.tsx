import { useEffect, useState } from 'react';
import type { TeamMember } from '@ecp/shared';
import type { AvailabilityKind } from '../lib/availability';
import { KIND_LABEL } from '../lib/availability';

export interface NewAvailability {
  memberId: string;
  startDate: string;
  endDate: string;
  multiplier?: number;
}

interface AddAvailabilityModalProps {
  members: TeamMember[];
  onClose: () => void;
  /** Persist the entry; rejects (with a message) if the backend refuses. */
  onAdd: (kind: AvailabilityKind, input: NewAvailability) => Promise<void>;
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const KINDS: AvailabilityKind[] = ['pto', 'oncall', 'velocity'];

/** Modal form for adding a PTO / on-call / velocity-override entry. */
export function AddAvailabilityModal({ members, onClose, onAdd }: AddAvailabilityModalProps) {
  const [kind, setKind] = useState<AvailabilityKind>('pto');
  const [memberId, setMemberId] = useState(members[0]?.id ?? '');
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState(todayIso());
  const [multiplier, setMultiplier] = useState('0.5');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAdd(kind, {
        memberId,
        startDate: start,
        endDate: end,
        ...(kind === 'velocity' ? { multiplier: Number(multiplier) } : {}),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" data-testid="add-availability-modal" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add availability" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Add availability</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div className="segmented" role="tablist" aria-label="Entry type">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={`segment${kind === k ? ' active' : ''}`}
              data-testid={`modal-kind-${k}`}
              onClick={() => setKind(k)}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="modal-body">
          <label className="control">
            <span>Member</span>
            <select value={memberId} data-testid="modal-member" onChange={(e) => setMemberId(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          <label className="control">
            <span>Start</span>
            <input type="date" value={start} data-testid="modal-start" onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="control">
            <span>End</span>
            <input type="date" value={end} data-testid="modal-end" onChange={(e) => setEnd(e.target.value)} />
          </label>
          {kind === 'velocity' && (
            <label className="control">
              <span>Multiplier</span>
              <input type="number" min={0} step={0.05} value={multiplier} data-testid="modal-multiplier"
                onChange={(e) => setMultiplier(e.target.value)} />
            </label>
          )}
        </div>

        {error && <div className="config-error modal-error" data-testid="modal-error">⚠ {error}</div>}

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || !memberId} data-testid="modal-submit" onClick={submit}>
            {busy ? 'Adding…' : 'Add entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
