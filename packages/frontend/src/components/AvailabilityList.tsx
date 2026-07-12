import { useMemo, useState } from 'react';
import type { AvailabilityEntry } from '../lib/availability';
import { KIND_LABEL } from '../lib/availability';
import { formatDate } from '../lib/format';
import { MemberAvatar } from './MemberAvatar';

interface AvailabilityListProps {
  entries: AvailabilityEntry[];
  disabled: boolean;
  onDelete: (entry: AvailabilityEntry) => void;
}

/** A searchable flat list of availability — quick to scan for one person's PTO. */
export function AvailabilityList({ entries, disabled, onDelete }: AvailabilityListProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.memberName.toLowerCase().includes(q) ||
        KIND_LABEL[e.kind].toLowerCase().includes(q) ||
        (e.note ?? '').toLowerCase().includes(q),
    );
  }, [entries, query]);

  return (
    <div className="availability-list" data-testid="availability-list">
      <input
        type="search"
        className="availability-search"
        placeholder="Search by member or type…"
        value={query}
        data-testid="availability-search"
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="config-list">
        {filtered.length === 0 && <div className="hint empty">No matching entries.</div>}
        {filtered.map((e) => (
          <div className="config-row" key={`${e.kind}-${e.id}`} data-testid={`avail-row-${e.id}`}>
            <MemberAvatar name={e.memberName} color={e.color} size={22} />
            <span className="config-primary">{e.memberName}</span>
            <span className={`badge kind-badge kind-${e.kind}`}>
              {KIND_LABEL[e.kind]}
              {e.multiplier !== undefined ? ` ×${e.multiplier}` : ''}
            </span>
            <span className="unit">
              {formatDate(e.startDate)} → {formatDate(e.endDate)}
            </span>
            {e.note && <span className="avail-note" title={e.note}>“{e.note}”</span>}
            <button
              type="button"
              className="link-btn danger"
              disabled={disabled}
              onClick={() => onDelete(e)}
            >
              remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
