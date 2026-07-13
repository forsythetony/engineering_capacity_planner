import { useEffect, useState } from 'react';
import type { SyncChange, SyncLogEntry } from '@ecp/shared';
import { parseJiraTicketKey } from '@ecp/shared';
import { formatDate } from '../lib/format';
import * as api from '../data/api';
import { JiraKeyLink } from './JiraLink';

/** Human label + accent for each change category, for the detail modal. */
const CATEGORY_META: Record<SyncChange['category'], { label: string; tone: string }> = {
  'item-added': { label: 'Added', tone: 'green' },
  'item-removed': { label: 'Removed', tone: 'red' },
  status: { label: 'Status', tone: 'blue' },
  points: { label: 'Points', tone: 'blue' },
  assignee: { label: 'Assignee', tone: 'blue' },
  'placement-added': { label: 'Placed', tone: 'green' },
  'placement-conflict': { label: 'Conflict', tone: 'red' },
  'placement-pulled': { label: 'Completed', tone: 'green' },
  'placement-dropped': { label: 'Unplaced', tone: 'red' },
  'member-added': { label: 'Teammate', tone: 'green' },
  'sprint-added': { label: 'Sprint', tone: 'green' },
  'sprint-removed': { label: 'Sprint', tone: 'red' },
};

/** "Sun Jul 12, 2026, 3:24 PM" from an ISO datetime. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${formatDate(iso.slice(0, 10))}, ${time}`;
}

/** A short headline for a card, e.g. "12 items · 2 completed · +1 teammate". */
function headline(entry: SyncLogEntry): string {
  const s = entry.summary;
  const parts: string[] = [`${s.workItems ?? 0} items`];
  if (s.sprints) parts.push(`${s.sprints} sprints`);
  if (s.placementsAddedFromJira) parts.push(`${s.placementsAddedFromJira} placed`);
  if (s.placementConflicts) parts.push(`${s.placementConflicts} conflicts`);
  if (s.placementsPulledDone) parts.push(`${s.placementsPulledDone} completed`);
  if (s.membersAdded) parts.push(`+${s.membersAdded} ${s.membersAdded === 1 ? 'teammate' : 'teammates'}`);
  return parts.join(' · ');
}

interface SyncLogProps {
  /** True when a live backend is connected (the log lives server-side). */
  editable: boolean;
  /** Changes whenever a sync completes, so the list re-fetches. */
  refreshKey?: string | null;
}

/**
 * Sync log (project plan §7): a card per sync showing what the reconcile did.
 * Clicking a card opens a modal with the full, itemized change list. The history
 * is server-side (survives dataset re-imports), fetched on mount and whenever a
 * new sync stamps {@link refreshKey}.
 */
export function SyncLog({ editable, refreshKey }: SyncLogProps) {
  const [entries, setEntries] = useState<SyncLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<SyncLogEntry | null>(null);

  useEffect(() => {
    if (!editable) return;
    let active = true;
    api
      .getSyncLog()
      .then((r) => active && setEntries(r.entries))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [editable, refreshKey]);

  if (!editable) {
    return (
      <section className="panel" data-testid="sync-log">
        <SectionTitle />
        <div className="hint">Connect the backend to record and review sync history.</div>
      </section>
    );
  }

  return (
    <section className="panel" data-testid="sync-log">
      <SectionTitle />
      {error && <div className="config-error">⚠ {error}</div>}
      {entries && entries.length === 0 && (
        <div className="hint" data-testid="sync-log-empty">
          No syncs yet. Hit <strong>Sync</strong> in the top nav and each run will show up here.
        </div>
      )}
      <div className="sync-log-cards" data-testid="sync-log-cards">
        {entries?.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="sync-log-card"
            data-testid="sync-log-card"
            onClick={() => setOpen(entry)}
          >
            <div className="sync-log-card-top">
              <span className="sync-log-when">{formatWhen(entry.syncedAt)}</span>
              <span className="sync-log-count">{entry.changes.length} changes</span>
            </div>
            <div className="sync-log-headline">{headline(entry)}</div>
            <div className="sync-log-source">from {entry.source}</div>
          </button>
        ))}
      </div>

      {open && <SyncLogModal entry={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function SectionTitle() {
  return (
    <div className="section-title">
      <h2>Sync log</h2>
      <span className="hint">Every sync and exactly what it changed. Click a card for the full list.</span>
    </div>
  );
}

function SyncLogModal({ entry, onClose }: { entry: SyncLogEntry; onClose: () => void }) {
  return (
    <div className="modal-overlay" data-testid="sync-log-modal" onClick={onClose}>
      <div className="modal sync-log-detail" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="ticket-modal-head">
          <h3>Sync · {formatWhen(entry.syncedAt)}</h3>
          <button type="button" className="link-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p>{headline(entry)} · from {entry.source}</p>

        {entry.changes.length === 0 ? (
          <div className="hint" data-testid="sync-log-nochanges">
            Nothing changed — Jira matched what we already had.
          </div>
        ) : (
          <ul className="sync-change-list" data-testid="sync-change-list">
            {entry.changes.map((c, i) => {
              const meta = CATEGORY_META[c.category];
              return (
                <li key={i} className="sync-change-row">
                  <span className={`sync-change-tag tone-${meta.tone}`}>{meta.label}</span>
                  <span className="sync-change-entity">
                    {parseJiraTicketKey(c.entity) === c.entity ? <JiraKeyLink jiraKey={c.entity} /> : <code>{c.entity}</code>}
                  </span>
                  <span className="sync-change-detail">{c.detail}</span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
