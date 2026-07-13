import { useMemo, useState } from 'react';
import type { DomainDataset, IsoDate, TeamMember, Weekday } from '@ecp/shared';
import { globalStringSetting, SETTING_KEYS } from '@ecp/shared';
import { formatDate } from '../lib/format';
import { memberColorMap } from '../lib/memberColors';
import { buildAvailabilityEntries, type AvailabilityEntry, type AvailabilityKind } from '../lib/availability';
import * as api from '../data/api';
import { AvailabilityCalendar } from './AvailabilityCalendar';
import { AvailabilityList } from './AvailabilityList';
import { AddAvailabilityModal, type NewAvailability } from './AddAvailabilityModal';
import { MemberAvatar } from './MemberAvatar';
import { JiraSetupWizard } from './JiraSetupWizard';
import { SyncLog } from './SyncLog';
import { DatabaseTools } from './DatabaseTools';

interface ConfigurationProps {
  dataset: DomainDataset;
  teamId: string | null;
  epicKey: string | null;
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
  const team = teamId ? (dataset.teams.find((t) => t.id === teamId) ?? null) : null;
  const members = teamId ? dataset.members.filter((m) => m.teamId === teamId) : [];
  const colors = useMemo(() => memberColorMap(members), [members]);

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
      {team ? <CadenceSection team={team} disabled={disabled} run={run} /> : null}
      {teamId ? (
        <>
          <MembersSection members={members} colors={colors} teamId={teamId} disabled={disabled} run={run} />
          <ModifiersSection
            dataset={dataset}
            members={members}
            colors={colors}
            disabled={disabled}
            editable={editable}
            run={run}
            onReload={onReload}
          />
        </>
      ) : null}
      {epicKey ? <MilestonesSection dataset={dataset} epicKey={epicKey} disabled={disabled} run={run} /> : null}
      <JiraSetupWizard
        dataset={dataset}
        teamId={teamId}
        members={members}
        disabled={disabled}
        run={run}
        onReload={onReload}
      />
      <SyncLog
        editable={editable}
        refreshKey={globalStringSetting(dataset.settings, SETTING_KEYS.LAST_SYNCED_AT)}
      />
      <DatabaseTools editable={editable} onReload={onReload} />
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
  const [weekYellow, setWeekYellow] = useState(
    String(settingValue(dataset, SETTING_KEYS.WEEK_YELLOW_LOAD_FRACTION, 1)),
  );

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
        <Field
          label="Gantt week yellow at (% of capacity)"
          help="On the Gantt Planner, a week turns yellow once its planned load reaches this fraction of capacity, and red once it's over. 1 = yellow only when fully loaded; lower (e.g. 0.9) warns before a week is completely full."
        >
          <input type="number" min={0} max={1} step={0.05} value={weekYellow} disabled={disabled}
            data-testid="cfg-week-yellow" onChange={(e) => setWeekYellow(e.target.value)} />
        </Field>
        <button type="button" className="btn" disabled={disabled} data-testid="cfg-knobs-save"
          onClick={() => run(() => api.patchSettings({
            [SETTING_KEYS.ONCALL_MULTIPLIER]: Number(oncall),
            [SETTING_KEYS.GREEN_MIN_BUFFER_DAYS]: Number(green),
            [SETTING_KEYS.WEEK_YELLOW_LOAD_FRACTION]: Number(weekYellow),
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
function MembersSection({ members, colors, teamId, disabled, run }: {
  members: TeamMember[]; colors: Map<string, string>; teamId: string; disabled: boolean; run: Run;
}) {
  const [name, setName] = useState('');
  const [velocity, setVelocity] = useState('10');

  return (
    <section className="panel">
      <SectionTitle title="Team members" hint="Per-person velocity (points / sprint) and who's active." />
      <div className="config-list" data-testid="cfg-members">
        {members.map((m) => (
          <MemberRow key={m.id} member={m} color={colors.get(m.id) ?? '#6b7280'} disabled={disabled} run={run} />
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

function MemberRow({ member, color, disabled, run }: { member: TeamMember; color: string; disabled: boolean; run: Run }) {
  const [velocity, setVelocity] = useState(String(member.baseVelocity));
  const dirty = Number(velocity) !== member.baseVelocity;
  return (
    <div className={`config-row${member.active ? '' : ' inactive'}`} data-testid={`cfg-member-${member.id}`}>
      <MemberAvatar name={member.name} color={color} size={22} avatarUrl={member.avatarUrl} />
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
// Availability — PTO / on-call / velocity overrides, as a calendar + list
// ---------------------------------------------------------------------------
function ModifiersSection({ dataset, members, colors, disabled, editable, run, onReload }: {
  dataset: DomainDataset;
  members: TeamMember[];
  colors: Map<string, string>;
  disabled: boolean;
  editable: boolean;
  run: Run;
  onReload: () => Promise<void>;
}) {
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [adding, setAdding] = useState(false);
  const entries = useMemo(
    () => buildAvailabilityEntries(dataset, members, colors),
    [dataset, members, colors],
  );

  const onDelete = (entry: AvailabilityEntry) => {
    const del =
      entry.kind === 'pto'
        ? api.deletePto
        : entry.kind === 'oncall'
          ? api.deleteOncall
          : api.deleteVelocityOverride;
    run(() => del(entry.id));
  };

  // The modal surfaces its own errors and stays open on failure, so it uses a
  // throwing add (not the error-swallowing `run`).
  const onAdd = async (kind: AvailabilityKind, input: NewAvailability) => {
    if (kind === 'pto') await api.createPto(input);
    else if (kind === 'oncall') await api.createOncall(input);
    else await api.createVelocityOverride({ ...input, multiplier: input.multiplier ?? 1 });
    await onReload();
  };

  return (
    <section className="panel">
      <div className="section-title">
        <h2>Availability</h2>
        <div className="section-actions">
          <div className="subtabs" role="tablist" aria-label="Availability view">
            <button type="button" role="tab" aria-selected={view === 'calendar'}
              className={`subtab${view === 'calendar' ? ' active' : ''}`} data-testid="avail-view-calendar"
              onClick={() => setView('calendar')}>
              Calendar
            </button>
            <button type="button" role="tab" aria-selected={view === 'list'}
              className={`subtab${view === 'list' ? ' active' : ''}`} data-testid="avail-view-list"
              onClick={() => setView('list')}>
              List
            </button>
          </div>
          <button type="button" className="btn primary add-btn" disabled={disabled} data-testid="avail-add"
            onClick={() => setAdding(true)}>
            ＋ Add
          </button>
        </div>
      </div>

      {view === 'calendar' ? (
        <AvailabilityCalendar entries={entries} disabled={disabled} onDelete={onDelete} />
      ) : (
        <AvailabilityList entries={entries} disabled={disabled} onDelete={onDelete} />
      )}

      {adding && editable && (
        <AddAvailabilityModal members={members} onClose={() => setAdding(false)} onAdd={onAdd} />
      )}
    </section>
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
