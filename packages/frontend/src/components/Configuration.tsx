import { useState } from 'react';
import type { DomainDataset, IsoDate, Weekday } from '@ecp/shared';
import { SETTING_KEYS } from '@ecp/shared';
import { formatDate } from '../lib/format';
import * as api from '../data/api';

interface ConfigurationProps {
  dataset: DomainDataset;
  teamId: string;
  epicKey: string;
  /** True when a live backend is connected; edits are disabled otherwise. */
  editable: boolean;
  /** Re-fetch the dataset after a successful mutation so views recompute. */
  onReload: () => Promise<void>;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const todayIso = (): IsoDate => new Date().toISOString().slice(0, 10);

/** Read a JSON-encoded global setting, or `fallback` when absent. */
function settingValue<T>(dataset: DomainDataset, key: string, fallback: T): T {
  const row = dataset.settings.find((s) => s.scope === 'global' && s.key === key);
  return row ? (JSON.parse(row.value) as T) : fallback;
}

/** Shared mutation runner: run an API call, reload, and surface errors. */
function useConfigActions(onReload: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy };
}

/**
 * Configuration tab (project plan §6): the knobs dashboard. CRUD for team
 * cadence, members, PTO / on-call / velocity overrides, the epic's relevant
 * days, plus the tunable settings and the (inert) Jira mapping stubs. Every
 * change persists via the backend API and reloads the dataset so the timeline
 * and dependency graph recompute.
 */
export function Configuration({ dataset, teamId, epicKey, editable, onReload }: ConfigurationProps) {
  const { run, error, busy } = useConfigActions(onReload);
  const disabled = !editable || busy;
  const team = dataset.teams.find((t) => t.id === teamId)!;
  const members = dataset.members.filter((m) => m.teamId === teamId);
  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name ?? '—';

  return (
    <div data-testid="configuration">
      {!editable && (
        <div className="panel config-notice" data-testid="config-readonly">
          You're viewing bundled sample data, so configuration is read-only. Start the backend
          (<code>npm run dev</code>) to edit and persist changes.
        </div>
      )}
      {error && (
        <div className="panel config-error" data-testid="config-error">
          ⚠ {error}
        </div>
      )}

      <KnobsSection dataset={dataset} disabled={disabled} run={run} />
      <CadenceSection team={team} disabled={disabled} run={run} />
      <MembersSection members={members} teamId={teamId} disabled={disabled} run={run} />
      <ModifiersSection dataset={dataset} members={members} memberName={memberName} disabled={disabled} run={run} />
      <MilestonesSection dataset={dataset} epicKey={epicKey} disabled={disabled} run={run} />
      <JiraSection dataset={dataset} disabled={disabled} run={run} />
    </div>
  );
}

type Run = (fn: () => Promise<unknown>) => Promise<void>;

// ---------------------------------------------------------------------------
// Planning knobs
// ---------------------------------------------------------------------------
function KnobsSection({ dataset, disabled, run }: { dataset: DomainDataset; disabled: boolean; run: Run }) {
  const [oncall, setOncall] = useState(String(settingValue(dataset, SETTING_KEYS.ONCALL_MULTIPLIER, 0.5)));
  const [green, setGreen] = useState(String(settingValue(dataset, SETTING_KEYS.GREEN_MIN_BUFFER_DAYS, 5)));

  return (
    <section className="panel">
      <SectionTitle title="Planning knobs" hint="Defaults that drive the red/yellow/green verdict." />

      <div className="knob-explainer" data-testid="knob-explainer">
        <p>
          The verdict compares the epic's <strong>projected dev-complete date</strong> — the
          remaining story points burned down through the team's real capacity, one working day at
          a time — against its <strong>gating relevant day</strong>. The <strong>buffer</strong> is
          the number of working days between the two, and the band is:
        </p>
        <ul className="verdict-legend">
          <li>
            <span className="dot green" /> <strong>Green</strong> — buffer ≥ the green threshold
            below (comfortable slack)
          </li>
          <li>
            <span className="dot yellow" /> <strong>Yellow</strong> — 0 ≤ buffer &lt; the threshold
            (finishes in time, but eats into the slack)
          </li>
          <li>
            <span className="dot red" /> <strong>Red</strong> — buffer &lt; 0 (projected to finish
            after the gating day)
          </li>
        </ul>
        <p className="knob-note">
          Capacity itself comes from each member's velocity, minus PTO, minus the on-call drag set
          here — all editable in the sections below.
        </p>
      </div>

      <div className="controls">
        <Field
          label="On-call multiplier"
          help="Output of someone on call, as a fraction of normal: 0 = fully consumed by on-call, 1 = no impact. Lower values shrink capacity during on-call rotations, pushing the projected finish later."
        >
          <input type="number" min={0} max={1} step={0.05} value={oncall} disabled={disabled}
            data-testid="cfg-oncall-mult" onChange={(e) => setOncall(e.target.value)} />
        </Field>
        <Field
          label="Green buffer ≥ (working days)"
          help="How many working days of slack you want before the gating day. At or above this the epic is green; between 0 and this it's yellow."
        >
          <input type="number" min={0} max={60} value={green} disabled={disabled}
            data-testid="cfg-green" onChange={(e) => setGreen(e.target.value)} />
        </Field>
        <button type="button" className="btn" disabled={disabled} data-testid="cfg-knobs-save"
          onClick={() => run(() => api.patchSettings({
            [SETTING_KEYS.ONCALL_MULTIPLIER]: Number(oncall),
            [SETTING_KEYS.GREEN_MIN_BUFFER_DAYS]: Number(green),
          }))}>
          Save knobs
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Team cadence
// ---------------------------------------------------------------------------
function CadenceSection({ team, disabled, run }: { team: DomainDataset['teams'][number]; disabled: boolean; run: Run }) {
  const [name, setName] = useState(team.name);
  const [length, setLength] = useState(String(team.sprintLengthDays));
  const [startWeekday, setStartWeekday] = useState(String(team.sprintStartWeekday));
  const [anchor, setAnchor] = useState(team.sprintAnchorDate);
  const [workingDays, setWorkingDays] = useState<Weekday[]>(team.workingDays);

  const toggleDay = (d: Weekday) =>
    setWorkingDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));

  return (
    <section className="panel">
      <SectionTitle title="Team cadence" hint={`${team.name} — sprint rhythm & working days.`} />
      <div className="controls">
        <Field label="Team name">
          <input type="text" value={name} disabled={disabled} data-testid="cfg-team-name" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Sprint length (days)">
          <input type="number" min={1} value={length} disabled={disabled} onChange={(e) => setLength(e.target.value)} />
        </Field>
        <Field label="Sprint start weekday">
          <select value={startWeekday} disabled={disabled} onChange={(e) => setStartWeekday(e.target.value)}>
            {WEEKDAYS.map((w, i) => (
              <option key={w} value={i}>{w}</option>
            ))}
          </select>
        </Field>
        <Field label="Sprint anchor date">
          <input type="date" value={anchor} disabled={disabled} onChange={(e) => setAnchor(e.target.value)} />
        </Field>
      </div>
      <div className="weekday-row">
        {WEEKDAYS.map((w, i) => (
          <label key={w} className="weekday-toggle">
            <input type="checkbox" checked={workingDays.includes(i as Weekday)} disabled={disabled}
              onChange={() => toggleDay(i as Weekday)} />
            {w}
          </label>
        ))}
      </div>
      <button type="button" className="btn" disabled={disabled} data-testid="cfg-cadence-save"
        onClick={() => run(() => api.updateTeam(team.id, {
          name,
          sprintLengthDays: Number(length),
          sprintStartWeekday: Number(startWeekday) as Weekday,
          sprintAnchorDate: anchor,
          workingDays,
        }))}>
        Save cadence
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
function MembersSection({ members, teamId, disabled, run }: {
  members: DomainDataset['members']; teamId: string; disabled: boolean; run: Run;
}) {
  const [name, setName] = useState('');
  const [velocity, setVelocity] = useState('10');

  return (
    <section className="panel">
      <SectionTitle title="Team members" hint="Per-person velocity (points / sprint) and who's active." />
      <div className="config-list" data-testid="cfg-members">
        {members.map((m) => (
          <MemberRow key={m.id} member={m} disabled={disabled} run={run} />
        ))}
      </div>
      <div className="controls config-add">
        <Field label="Name">
          <input type="text" value={name} disabled={disabled} data-testid="cfg-member-name" placeholder="New member"
            onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Base velocity">
          <input type="number" min={0} value={velocity} disabled={disabled} onChange={(e) => setVelocity(e.target.value)} />
        </Field>
        <button type="button" className="btn" disabled={disabled || name.trim() === ''} data-testid="cfg-member-add"
          onClick={() => run(async () => {
            await api.createMember({ teamId, name: name.trim(), baseVelocity: Number(velocity) });
            setName('');
          })}>
          Add member
        </button>
      </div>
    </section>
  );
}

function MemberRow({ member, disabled, run }: { member: DomainDataset['members'][number]; disabled: boolean; run: Run }) {
  const [velocity, setVelocity] = useState(String(member.baseVelocity));
  const dirty = Number(velocity) !== member.baseVelocity;
  return (
    <div className={`config-row${member.active ? '' : ' inactive'}`} data-testid={`cfg-member-${member.id}`}>
      <span className="config-primary">{member.name}</span>
      <label className="inline-check">
        <input type="checkbox" checked={member.active} disabled={disabled}
          onChange={(e) => run(() => api.updateMember(member.id, { active: e.target.checked }))} />
        active
      </label>
      <input className="mini" type="number" min={0} value={velocity} disabled={disabled}
        onChange={(e) => setVelocity(e.target.value)} />
      <span className="unit">pts/sprint</span>
      <button type="button" className="link-btn" disabled={disabled || !dirty}
        onClick={() => run(() => api.updateMember(member.id, { baseVelocity: Number(velocity) }))}>
        save
      </button>
      <button type="button" className="link-btn danger" disabled={disabled}
        onClick={() => run(() => api.deleteMember(member.id))}>
        remove
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PTO / on-call / velocity overrides
// ---------------------------------------------------------------------------
function ModifiersSection({ dataset, members, memberName, disabled, run }: {
  dataset: DomainDataset; members: DomainDataset['members']; memberName: (id: string | null) => string; disabled: boolean; run: Run;
}) {
  return (
    <section className="panel">
      <SectionTitle title="Availability" hint="PTO, on-call rotations, and temporary velocity changes." />

      <RangeList
        testid="cfg-pto" heading="PTO" members={members} disabled={disabled}
        rows={dataset.pto.map((p) => ({ id: p.id, label: `${memberName(p.memberId)}: ${formatDate(p.startDate)} → ${formatDate(p.endDate)}` }))}
        onAdd={(memberId, start, end) => run(() => api.createPto({ memberId, startDate: start, endDate: end }))}
        onDelete={(id) => run(() => api.deletePto(id))}
      />
      <RangeList
        testid="cfg-oncall" heading="On-call" members={members} disabled={disabled}
        rows={dataset.oncall.map((o) => ({ id: o.id, label: `${memberName(o.memberId)}: ${formatDate(o.startDate)} → ${formatDate(o.endDate)}` }))}
        onAdd={(memberId, start, end) => run(() => api.createOncall({ memberId, startDate: start, endDate: end }))}
        onDelete={(id) => run(() => api.deleteOncall(id))}
      />
      <RangeList
        testid="cfg-velocity" heading="Velocity overrides" members={members} disabled={disabled} withMultiplier
        rows={dataset.velocityOverrides.map((v) => ({ id: v.id, label: `${memberName(v.memberId)}: ×${v.multiplier} (${formatDate(v.startDate)} → ${formatDate(v.endDate)})` }))}
        onAdd={(memberId, start, end, multiplier) => run(() => api.createVelocityOverride({ memberId, startDate: start, endDate: end, multiplier: multiplier ?? 1 }))}
        onDelete={(id) => run(() => api.deleteVelocityOverride(id))}
      />
    </section>
  );
}

function RangeList({ testid, heading, members, rows, disabled, withMultiplier, onAdd, onDelete }: {
  testid: string; heading: string; members: DomainDataset['members']; rows: { id: string; label: string }[];
  disabled: boolean; withMultiplier?: boolean;
  onAdd: (memberId: string, start: IsoDate, end: IsoDate, multiplier?: number) => void;
  onDelete: (id: string) => void;
}) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? '');
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState(todayIso());
  const [mult, setMult] = useState('0.5');

  return (
    <div className="modifier-block" data-testid={testid}>
      <h3 className="subheading">{heading}</h3>
      <div className="config-list">
        {rows.length === 0 && <div className="hint empty">None.</div>}
        {rows.map((r) => (
          <div className="config-row" key={r.id} data-testid={`${testid}-${r.id}`}>
            <span className="config-primary">{r.label}</span>
            <button type="button" className="link-btn danger" disabled={disabled} onClick={() => onDelete(r.id)}>
              remove
            </button>
          </div>
        ))}
      </div>
      <div className="controls config-add">
        <Field label="Member">
          <select value={memberId} disabled={disabled} onChange={(e) => setMemberId(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Start">
          <input type="date" value={start} disabled={disabled} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End">
          <input type="date" value={end} disabled={disabled} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        {withMultiplier && (
          <Field label="Multiplier">
            <input type="number" min={0} step={0.05} value={mult} disabled={disabled} onChange={(e) => setMult(e.target.value)} />
          </Field>
        )}
        <button type="button" className="btn" disabled={disabled || !memberId} data-testid={`${testid}-add`}
          onClick={() => onAdd(memberId, start, end, withMultiplier ? Number(mult) : undefined)}>
          Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Epic milestones ("relevant days")
// ---------------------------------------------------------------------------
function MilestonesSection({ dataset, epicKey, disabled, run }: {
  dataset: DomainDataset; epicKey: string; disabled: boolean; run: Run;
}) {
  const milestones = dataset.milestones
    .filter((m) => m.epicKey === epicKey)
    .sort((a, b) => a.date.localeCompare(b.date));
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayIso());

  return (
    <section className="panel">
      <SectionTitle title="Relevant days" hint="The epic's key dates. Exactly one is the gating day that drives the verdict." />
      <div className="config-list" data-testid="cfg-milestones">
        {milestones.map((m) => (
          <div className={`config-row${m.isGating ? ' gating' : ''}`} key={m.id} data-testid={`cfg-milestone-${m.id}`}>
            <label className="inline-check" title="Gating day">
              <input type="radio" name="gating" checked={m.isGating} disabled={disabled || m.isGating}
                onChange={() => run(() => api.updateMilestone(m.id, { isGating: true }))} />
              gate
            </label>
            <span className="config-primary">{m.name}</span>
            <span className="unit">{formatDate(m.date)}</span>
            <button type="button" className="link-btn danger" disabled={disabled || m.isGating}
              title={m.isGating ? 'Mark another day as the gate first' : undefined}
              onClick={() => run(() => api.deleteMilestone(m.id))}>
              remove
            </button>
          </div>
        ))}
      </div>
      <div className="controls config-add">
        <Field label="Name">
          <input type="text" value={name} disabled={disabled} data-testid="cfg-milestone-name" placeholder="e.g. Code freeze"
            onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Date">
          <input type="date" value={date} disabled={disabled} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <button type="button" className="btn" disabled={disabled || name.trim() === ''} data-testid="cfg-milestone-add"
          onClick={() => run(async () => {
            await api.createMilestone(epicKey, { name: name.trim(), date });
            setName('');
          })}>
          Add relevant day
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Jira mapping stubs (inert until Phase 7, but editable settings)
// ---------------------------------------------------------------------------
function JiraSection({ dataset, disabled, run }: { dataset: DomainDataset; disabled: boolean; run: Run }) {
  const [flavor, setFlavor] = useState(settingValue<string | null>(dataset, SETTING_KEYS.JIRA_FLAVOR, null) ?? '');
  const [project, setProject] = useState(settingValue<string | null>(dataset, SETTING_KEYS.JIRA_PROJECT_KEY, null) ?? '');
  const [pointsField, setPointsField] = useState(settingValue<string | null>(dataset, SETTING_KEYS.JIRA_STORY_POINTS_FIELD, null) ?? '');
  const [linkType, setLinkType] = useState(settingValue<string | null>(dataset, SETTING_KEYS.JIRA_BLOCKS_LINK_TYPE, null) ?? '');
  const nullify = (s: string) => (s.trim() === '' ? null : s.trim());

  return (
    <section className="panel">
      <SectionTitle title="Jira mapping" hint="Designed in early; inert until the Jira importer lands (Phase 7)." />
      <div className="controls">
        <Field label="Flavor">
          <select value={flavor} disabled={disabled} onChange={(e) => setFlavor(e.target.value)}>
            <option value="">(unset)</option>
            <option value="cloud">Cloud</option>
            <option value="server">Server / Data Center</option>
          </select>
        </Field>
        <Field label="Project key">
          <input type="text" value={project} disabled={disabled} placeholder="e.g. CKT" onChange={(e) => setProject(e.target.value)} />
        </Field>
        <Field label="Story-points field">
          <input type="text" value={pointsField} disabled={disabled} placeholder="customfield_10016" onChange={(e) => setPointsField(e.target.value)} />
        </Field>
        <Field label="'Blocks' link type">
          <input type="text" value={linkType} disabled={disabled} placeholder="Blocks" onChange={(e) => setLinkType(e.target.value)} />
        </Field>
        <button type="button" className="btn" disabled={disabled} data-testid="cfg-jira-save"
          onClick={() => run(() => api.patchSettings({
            [SETTING_KEYS.JIRA_FLAVOR]: nullify(flavor),
            [SETTING_KEYS.JIRA_PROJECT_KEY]: nullify(project),
            [SETTING_KEYS.JIRA_STORY_POINTS_FIELD]: nullify(pointsField),
            [SETTING_KEYS.JIRA_BLOCKS_LINK_TYPE]: nullify(linkType),
          }))}>
          Save mapping
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------
function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      <span className="hint">{hint}</span>
    </div>
  );
}

function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="control">
      <label>{label}</label>
      {children}
      {help && <span className="field-help">{help}</span>}
    </div>
  );
}
