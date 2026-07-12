import { useEffect, useRef, useState } from 'react';
import type { DomainDataset } from '@ecp/shared';
import { SETTING_KEYS } from '@ecp/shared';
import * as api from '../data/api';

/** The three field roles the user points at a real Jira field. */
const FIELD_ROLES = [
  { setting: SETTING_KEYS.JIRA_STORY_POINTS_FIELD, label: 'Story points' },
  { setting: SETTING_KEYS.JIRA_SPRINT_FIELD, label: 'Sprint' },
  { setting: SETTING_KEYS.JIRA_LABELS_FIELD, label: 'Labels' },
] as const;

function preview(value: unknown): string {
  if (value == null) return '—';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > 64 ? `${s.slice(0, 61)}…` : s;
}

/**
 * One row per catalog field (custom fields first), carrying the sample issue's
 * value when present — so any field is mappable even if this particular issue
 * left it blank.
 */
function fieldRows(sample: api.JiraSampleResponse): Array<{ id: string; name: string; value: unknown }> {
  const fields = sample.fields ?? {};
  return [...sample.catalog]
    .sort((a, b) => Number(b.custom) - Number(a.custom) || a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, name: c.name, value: fields[c.id] ?? null }));
}

/** Read a JSON-encoded global setting, or `fallback` when absent. */
function settingValue<T>(dataset: DomainDataset, key: string, fallback: T): T {
  const row = dataset.settings.find((s) => s.scope === 'global' && s.key === key);
  return row ? (JSON.parse(row.value) as T) : fallback;
}

interface JiraFieldMapperProps {
  dataset: DomainDataset;
  disabled: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  /** Project/epic to seed the sample from (defaults to persisted settings). */
  project?: string;
  epic?: string;
  /** Auto-load a sample on mount (used inside the wizard's Fields step). */
  autoLoad?: boolean;
}

/**
 * The live field mapper (project plan §7): pulls a real sample issue from the
 * board and lets the user *point at* the field that holds story points / the
 * sprint / labels rather than typing an opaque `customfield_*` id. Persists each
 * choice to settings. Reused by both the setup wizard and the advanced Jira
 * panel.
 */
export function JiraFieldMapper({ dataset, disabled, run, project, epic, autoLoad }: JiraFieldMapperProps) {
  const cur = (key: string) => settingValue<string | null>(dataset, key, null) ?? '';
  const nullify = (s: string) => (s.trim() === '' ? null : s.trim());
  const linkType = cur(SETTING_KEYS.JIRA_BLOCKS_LINK_TYPE);
  const pointsField = cur(SETTING_KEYS.JIRA_STORY_POINTS_FIELD);
  const sprintField = cur(SETTING_KEYS.JIRA_SPRINT_FIELD);
  const labelsField = cur(SETTING_KEYS.JIRA_LABELS_FIELD);
  const mappedTo = (id: string): string[] =>
    FIELD_ROLES.filter((r) => cur(r.setting) === id).map((r) => r.label);

  const [sample, setSample] = useState<api.JiraSampleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  const loadSample = async () => {
    setLoading(true);
    setSampleError(null);
    try {
      setSample(await api.getJiraSample({ project: project?.trim(), epic: epic?.trim() }));
    } catch (e) {
      setSample(null);
      setSampleError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Auto-load once when embedded in the wizard (so the Fields step arrives with
  // a sample already showing).
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoLoad && !autoTried.current && !disabled) {
      autoTried.current = true;
      void loadSample();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, disabled]);

  return (
    <div data-testid="cfg-jira-mapper">
      <div className="controls">
        <button type="button" className="btn" disabled={disabled || loading} data-testid="cfg-jira-load-sample" onClick={loadSample}>
          {loading ? 'Loading…' : sample ? 'Reload sample' : 'Load sample from Jira'}
        </button>
      </div>

      {sampleError && <div className="config-error" data-testid="cfg-jira-sample-error">⚠ {sampleError}</div>}

      {sample && (
        <div className="jira-mapper" data-testid="cfg-jira-sample">
          <p className="hint">
            {sample.sampleKey
              ? <>Sample issue <strong>{sample.sampleKey}</strong> — click a field to map it.</>
              : <>No issues found in <strong>{sample.projectKey}</strong> to sample; the field catalog is still shown below.</>}
          </p>
          <div className="jira-field-list">
            {fieldRows(sample).map(({ id, name, value }) => {
              const roles = mappedTo(id);
              return (
                <div className="jira-field-row" data-testid="cfg-jira-field-row" key={id}>
                  <div className="jira-field-meta">
                    <span className="jira-field-name">{name}</span>
                    <code className="jira-field-id">{id}</code>
                    {roles.length > 0 && <span className="jira-field-badge">{roles.join(', ')}</span>}
                  </div>
                  <span className="jira-field-value">{preview(value)}</span>
                  <div className="jira-field-actions">
                    {FIELD_ROLES.map((r) => (
                      <button key={r.setting} type="button" className="btn btn-tiny" disabled={disabled}
                        data-testid={`cfg-jira-use-${r.label.toLowerCase().replace(' ', '-')}`}
                        onClick={() => run(() => api.patchSettings({ [r.setting]: id }))}>
                        {cur(r.setting) === id ? `✓ ${r.label}` : `Use as ${r.label}`}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="controls">
            <div className="control">
              <label>'Blocks' link type</label>
              <select value={linkType} disabled={disabled} data-testid="cfg-jira-blocks-select"
                onChange={(e) => run(() => api.patchSettings({ [SETTING_KEYS.JIRA_BLOCKS_LINK_TYPE]: nullify(e.target.value) }))}>
                <option value="">(unset)</option>
                {sample.linkTypes.map((t) => (
                  <option key={t.id} value={t.name}>{t.name} ({t.outward})</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="jira-mapping-summary hint" data-testid="cfg-jira-summary">
        Mapped — points: <code>{pointsField || '—'}</code>, sprint: <code>{sprintField || '—'}</code>,
        labels: <code>{labelsField || 'labels'}</code>, blocks: <code>{linkType || '—'}</code>
      </div>
    </div>
  );
}
