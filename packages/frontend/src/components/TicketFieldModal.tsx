import { useMemo, useState } from 'react';
import type { DomainDataset } from '@ecp/shared';
import { parseJiraTicketKey, SETTING_KEYS } from '@ecp/shared';
import * as api from '../data/api';
import { JiraKeyLink } from './JiraLink';

/** Read a JSON-encoded global setting, or `fallback` when absent. */
function settingValue<T>(dataset: DomainDataset, key: string, fallback: T): T {
  const row = dataset.settings.find((s) => s.scope === 'global' && s.key === key);
  return row ? (JSON.parse(row.value) as T) : fallback;
}

function preview(value: unknown): string {
  if (value == null) return '—';
  if (Array.isArray(value)) {
    const named = value
      .map((v) => (typeof v === 'object' && v !== null && 'name' in v ? String(v.name) : null))
      .filter((v): v is string => v !== null && v.trim() !== '');
    if (named.length > 0) return named.join(', ');
  }
  if (typeof value === 'object' && 'name' in value && typeof value.name === 'string') {
    return value.name;
  }
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > 48 ? `${s.slice(0, 45)}…` : s;
}

interface TicketFieldModalProps {
  dataset: DomainDataset;
  disabled: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  /** Prefill the lookup box (e.g. the epic key already chosen). */
  initialRef?: string;
  onClose: () => void;
}

/**
 * Ticket-driven field mapper (project plan §7). The user pastes a ticket number
 * or browse URL; we fetch that real issue, show its fields, and let them point
 * the story-points / sprint roles at the right custom field from an issue they
 * recognize. Blocking is analyzed too: in stock Jira it's the native "Blocks"
 * issue-link type (not a custom field), so we auto-confirm it and say so rather
 * than making the user hunt for a field that doesn't exist.
 */
export function TicketFieldModal({ dataset, disabled, run, initialRef, onClose }: TicketFieldModalProps) {
  const [refText, setRefText] = useState(initialRef ?? '');
  const [fieldFilter, setFieldFilter] = useState('');
  const [ticket, setTicket] = useState<api.JiraTicketResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cur = (key: string) => settingValue<string | null>(dataset, key, null) ?? '';
  const pointsField = cur(SETTING_KEYS.JIRA_STORY_POINTS_FIELD);
  const sprintField = cur(SETTING_KEYS.JIRA_SPRINT_FIELD);
  const blocksType = cur(SETTING_KEYS.JIRA_BLOCKS_LINK_TYPE);

  const parsedKey = parseJiraTicketKey(refText);

  const lookup = async () => {
    setLoading(true);
    setError(null);
    try {
      const nextTicket = await api.getJiraTicket(refText.trim());
      setTicket(nextTicket);
      setFieldFilter('');
      if (nextTicket.blocks.isNativeLink && nextTicket.blocks.linkType && blocksType !== nextTicket.blocks.linkType) {
        await run(() => api.patchSettings({ [SETTING_KEYS.JIRA_BLOCKS_LINK_TYPE]: nextTicket.blocks.linkType }));
      }
    } catch (e) {
      setTicket(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Story-point candidates: numeric custom fields on this ticket, then any other
  // custom field (so a field that happened to be blank here is still mappable).
  const candidateFields = useMemo(
    () =>
      ticket
        ? [
            ...ticket.numericFields,
            ...ticket.catalog.filter(
              (c) => c.custom && !ticket.numericFields.some((n) => n.id === c.id),
            ),
          ]
        : [],
    [ticket],
  );

  const filteredFields = useMemo(() => {
    if (!ticket) return [];
    const q = fieldFilter.trim().toLowerCase();
    if (q === '') return candidateFields;
    return candidateFields.filter((c) => {
      const value = preview(ticket.fields[c.id]).toLowerCase();
      return c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || value.includes(q);
    });
  }, [candidateFields, fieldFilter, ticket]);

  const selectedFields = useMemo(() => {
    if (!ticket) return [];
    return [
      { role: 'Story points', fieldId: pointsField },
      { role: 'Sprint', fieldId: sprintField },
    ]
      .filter((s) => s.fieldId !== '')
      .map((s) => ({
        ...s,
        field: candidateFields.find((c) => c.id === s.fieldId) ?? ticket.catalog.find((c) => c.id === s.fieldId) ?? null,
      }));
  }, [candidateFields, pointsField, sprintField, ticket]);

  return (
    <div className="modal-overlay" data-testid="ticket-modal" onClick={onClose}>
      <div className="modal ticket-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="ticket-modal-head">
          <h3>Map fields from a ticket</h3>
          <button type="button" className="link-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p>
          Paste a ticket number (<code>CKT-42</code>) or its URL. We’ll pull that issue and let you
          point each role at the field it actually uses.
        </p>

        <div className="ticket-lookup">
          <input
            type="text"
            value={refText}
            disabled={disabled || loading}
            placeholder="CKT-42 or https://your-org.atlassian.net/browse/CKT-42"
            data-testid="ticket-ref-input"
            onChange={(e) => setRefText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && parsedKey) void lookup();
            }}
          />
          <button
            type="button"
            className="btn primary"
            disabled={disabled || loading || !parsedKey}
            data-testid="ticket-lookup-btn"
            onClick={() => void lookup()}
          >
            {loading ? 'Loading…' : 'Look up'}
          </button>
        </div>
        {refText.trim() !== '' && !parsedKey && (
          <div className="hint ticket-hint">That doesn’t look like a Jira key or URL yet.</div>
        )}
        {error && <div className="config-error" data-testid="ticket-error">⚠ {error}</div>}

        {ticket && (
          <div className="ticket-body" data-testid="ticket-body">
            <div className="ticket-card" data-testid="ticket-card">
              <div className="ticket-card-key"><JiraKeyLink jiraKey={ticket.key} /></div>
              <div className="ticket-card-summary">{ticket.summary ?? '(no summary)'}</div>
              <div className="ticket-card-meta">
                {ticket.issueType && <span className="jira-field-badge">{ticket.issueType}</span>}
                {ticket.status && <span className="unit">{ticket.status}</span>}
              </div>
            </div>

            <section className="ticket-section selected-mappings" data-testid="ticket-selected-mappings">
              <h4>Selected mappings</h4>
              <div className="selected-mapping-list">
                {selectedFields.map((s) => (
                  <div className="selected-mapping-row" key={`${s.role}-${s.fieldId}`}>
                    <span className="jira-field-badge">{s.role}</span>
                    <span className="selected-mapping-main">
                      <strong>{s.field?.name ?? s.fieldId}</strong>
                      <code>{s.fieldId}</code>
                    </span>
                    <span className="jira-field-value">{preview(ticket.fields[s.fieldId])}</span>
                  </div>
                ))}
                {blocksType && (
                  <div className="selected-mapping-row">
                    <span className="jira-field-badge">Blocking</span>
                    <span className="selected-mapping-main">
                      <strong>{blocksType}</strong>
                      <code>issue link type</code>
                    </span>
                    <span className="jira-field-value">native Jira links</span>
                  </div>
                )}
                {selectedFields.length === 0 && !blocksType && (
                  <div className="hint">No fields selected yet.</div>
                )}
              </div>
            </section>

            {/* --- Story points ------------------------------------------- */}
            <section className="ticket-section" data-testid="ticket-points">
              <h4>Story points</h4>
              <p className="hint">Which field on this ticket holds the estimate?</p>
              <div className="ticket-field-filter">
                <input
                  type="search"
                  value={fieldFilter}
                  disabled={disabled}
                  placeholder="Filter fields by name, id, or value…"
                  aria-label="Filter ticket fields"
                  data-testid="ticket-field-filter"
                  onChange={(e) => setFieldFilter(e.target.value)}
                />
                {fieldFilter.trim() !== '' && (
                  <button
                    type="button"
                    className="wizard-clear"
                    aria-label="Clear field filter"
                    disabled={disabled}
                    onClick={() => setFieldFilter('')}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="ticket-field-list">
                {filteredFields.map((c) => {
                  const value = ticket.fields[c.id];
                  const mapped = pointsField === c.id;
                  return (
                    <div className={`ticket-field-row${mapped ? ' mapped' : ''}`} key={c.id} data-testid="ticket-points-row">
                      <div className="ticket-field-meta">
                        <span className="jira-field-name">{c.name}</span>
                        <code className="jira-field-id">{c.id}</code>
                      </div>
                      <span className="jira-field-value">{preview(value)}</span>
                      <button
                        type="button"
                        className="btn btn-tiny"
                        disabled={disabled}
                        data-testid={`ticket-use-points-${c.id}`}
                        onClick={() => run(() => api.patchSettings({ [SETTING_KEYS.JIRA_STORY_POINTS_FIELD]: c.id }))}
                      >
                        {mapped ? '✓ Story points' : 'Use as Story points'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-tiny"
                        disabled={disabled}
                        data-testid={`ticket-use-sprint-${c.id}`}
                        onClick={() => run(() => api.patchSettings({ [SETTING_KEYS.JIRA_SPRINT_FIELD]: c.id }))}
                      >
                        {sprintField === c.id ? '✓ Sprint' : 'Use as Sprint'}
                      </button>
                    </div>
                  );
                })}
                {candidateFields.length === 0 && (
                  <div className="hint">This ticket exposes no custom fields to map.</div>
                )}
                {candidateFields.length > 0 && filteredFields.length === 0 && (
                  <div className="hint">No fields match “{fieldFilter.trim()}”.</div>
                )}
              </div>
            </section>

            {/* --- Blocked by --------------------------------------------- */}
            <BlockedBySection ticket={ticket} blocksType={blocksType} disabled={disabled} run={run} />
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} data-testid="ticket-done">Done</button>
        </div>
      </div>
    </div>
  );
}

function BlockedBySection({
  ticket,
  blocksType,
  disabled,
  run,
}: {
  ticket: api.JiraTicketResponse;
  blocksType: string;
  disabled: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { blocks } = ticket;
  const detected = blocks.linkType;
  const alreadySet = detected != null && blocksType === detected;

  return (
    <section className="ticket-section" data-testid="ticket-blocks">
      <h4>“Blocked by”</h4>
      {blocks.isNativeLink ? (
        <div className="conn-card ok" data-testid="ticket-blocks-native">
          <strong>● Handled automatically</strong>
          <div className="hint">
            Blocking isn’t a custom field — it’s Jira’s built-in{' '}
            <code>{detected}</code> issue-link type, so there’s nothing to configure by hand.
            {blocks.blockedBy.length > 0 && (
              <> This ticket is blocked by <strong>{blocks.blockedBy.join(', ')}</strong>.</>
            )}
          </div>
          <button
            type="button"
            className="btn btn-tiny"
            disabled={disabled || alreadySet}
            data-testid="ticket-blocks-confirm"
            onClick={() => run(() => api.patchSettings({ [SETTING_KEYS.JIRA_BLOCKS_LINK_TYPE]: detected }))}
          >
            {alreadySet ? `✓ Using “${detected}”` : `Use “${detected}” for blocking`}
          </button>
        </div>
      ) : (
        <div className="config-error" data-testid="ticket-blocks-none">
          No blocking issue-link type was found on your Jira site. If your team tracks blockers a
          different way, set the link type on the “Fields” step below.
        </div>
      )}

      {blocks.customFieldCandidate && (
        <div className="hint ticket-hint" data-testid="ticket-blocks-customfield">
          Heads-up: a custom field <strong>{blocks.customFieldCandidate.name}</strong>{' '}
          (<code>{blocks.customFieldCandidate.id}</code>) mentions “block” too. Blocking is read from
          native issue links, so this field is left as-is.
        </div>
      )}
    </section>
  );
}
