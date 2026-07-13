import { useEffect, useMemo, useState } from 'react';
import type { DomainDataset, TeamMember } from '@ecp/shared';
import { isMappingComplete, SETTING_KEYS } from '@ecp/shared';
import * as api from '../data/api';
import { memberColorMap } from '../lib/memberColors';
import { MemberAvatar } from './MemberAvatar';
import { JiraFieldMapper } from './JiraFieldMapper';
import { TicketFieldModal } from './TicketFieldModal';
import { Typeahead } from './Typeahead';
import { JiraKeyLink } from './JiraLink';

/** Read a JSON-encoded global setting, or `fallback` when absent. */
function settingValue<T>(dataset: DomainDataset, key: string, fallback: T): T {
  const row = dataset.settings.find((s) => s.scope === 'global' && s.key === key);
  return row ? (JSON.parse(row.value) as T) : fallback;
}

type Run = (fn: () => Promise<unknown>) => Promise<void>;

interface WizardProps {
  dataset: DomainDataset;
  teamId: string | null;
  members: TeamMember[];
  disabled: boolean;
  run: Run;
  onReload: () => Promise<void>;
}

type StepId = 'connect' | 'board' | 'epic' | 'fields' | 'members';

const STEPS: Array<{ id: StepId; title: string }> = [
  { id: 'connect', title: 'Connect' },
  { id: 'board', title: 'Board' },
  { id: 'epic', title: 'Epic' },
  { id: 'fields', title: 'Fields' },
  { id: 'members', title: 'Members' },
];

/**
 * Guided "Connect to Jira" flow (project plan §7). Walks an empty install from
 * credentials → board → epic → field mapping → team members, driving live Jira
 * search under the hood (typeaheads) so the user points at real things instead
 * of typing opaque ids. Each choice persists to settings / the members table and
 * reloads, so the rest of the app (and the nav Sync button) react immediately.
 */
export function JiraSetupWizard({ dataset, teamId, members, disabled, run, onReload }: WizardProps) {
  const projectKey = settingValue<string | null>(dataset, SETTING_KEYS.JIRA_PROJECT_KEY, null);
  const boardId = settingValue<string | null>(dataset, SETTING_KEYS.JIRA_BOARD_ID, null);
  const epicKey = settingValue<string | null>(dataset, SETTING_KEYS.JIRA_EPIC_KEY, null);
  const mapped = isMappingComplete(dataset.settings);

  const done: Record<StepId, boolean> = {
    connect: false, // filled from the live connection check below
    board: boardId !== null,
    epic: epicKey !== null,
    fields: mapped,
    members: teamId !== null && members.some((m) => m.jiraAccountId),
  };

  // First unfinished step is the natural landing spot.
  const [step, setStep] = useState<StepId>(() => {
    if (!boardId) return 'board';
    if (!epicKey) return 'epic';
    if (!mapped) return 'fields';
    return 'connect';
  });

  return (
    <section className="panel jira-wizard" data-testid="jira-wizard">
      <div className="section-title">
        <h2>Connect to Jira</h2>
        <span className="hint">Wire up your board, pick what to track, and map fields — no ids to memorize.</span>
      </div>

      <ol className="wizard-steps" data-testid="wizard-steps">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              className={`wizard-step${step === s.id ? ' active' : ''}${done[s.id] ? ' done' : ''}`}
              data-testid={`wizard-step-${s.id}`}
              onClick={() => setStep(s.id)}
            >
              <span className="wizard-step-num">{done[s.id] ? '✓' : i + 1}</span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>

      <div className="wizard-body">
        {step === 'connect' && <ConnectStep />}
        {step === 'board' && (
          <BoardStep dataset={dataset} projectKey={projectKey} boardId={boardId} disabled={disabled} run={run} onNext={() => setStep('epic')} />
        )}
        {step === 'epic' && (
          <EpicStep projectKey={projectKey} epicKey={epicKey} disabled={disabled} run={run} onNext={() => setStep('fields')} />
        )}
        {step === 'fields' && (
          <FieldsStep
            dataset={dataset}
            projectKey={projectKey}
            epicKey={epicKey}
            disabled={disabled}
            run={run}
            onNext={() => setStep('members')}
          />
        )}
        {step === 'members' && (
          <MembersStep teamId={teamId} members={members} disabled={disabled} run={run} onReload={onReload} />
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------
function ConnectStep() {
  const [conn, setConn] = useState<api.JiraConnection | null>(null);
  const [loading, setLoading] = useState(true);

  const check = () => {
    setLoading(true);
    api
      .getJiraConnection()
      .then(setConn)
      .catch((e) => setConn({ connected: false, baseUrl: null, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => setLoading(false));
  };
  useEffect(check, []);

  return (
    <div data-testid="wizard-connect">
      {loading && <p className="hint">Checking connection…</p>}
      {!loading && conn?.connected && (
        <div className="conn-card ok" data-testid="wizard-connect-ok">
          <strong>● Connected</strong>
          <div className="hint">
            {conn.baseUrl ?? 'your Jira site'} — signed in as <strong>{conn.displayName}</strong>
            {conn.email ? ` (${conn.email})` : ''}.
          </div>
        </div>
      )}
      {!loading && conn && !conn.connected && (
        <div className="conn-card bad" data-testid="wizard-connect-bad">
          <strong>○ Not connected</strong>
          <div className="hint">{conn.error ?? 'No Jira credentials found.'}</div>
          <p className="hint">
            Credentials are read from the environment (never stored in the shared database). Set
            these where the backend runs, then re-check:
          </p>
          <pre className="env-block">
JIRA_BASE_URL=https://your-org.atlassian.net{'\n'}JIRA_EMAIL=you@your-org.com{'\n'}JIRA_API_TOKEN=…{'\n'}ECP_DATA_SOURCE=jira
          </pre>
        </div>
      )}
      <div className="wizard-nav">
        <button type="button" className="btn" onClick={check} data-testid="wizard-connect-recheck">Re-check connection</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------
function BoardStep({ dataset, projectKey, boardId, disabled, run, onNext }: {
  dataset: DomainDataset; projectKey: string | null; boardId: string | null; disabled: boolean; run: Run; onNext: () => void;
}) {
  const [text, setText] = useState('');
  const currentName = settingValue<string | null>(dataset, SETTING_KEYS.JIRA_BOARD_NAME, null);
  const clearBoard = () => {
    setText('');
    run(() =>
      api.patchSettings({
        [SETTING_KEYS.JIRA_BOARD_ID]: null,
        [SETTING_KEYS.JIRA_BOARD_NAME]: null,
        [SETTING_KEYS.JIRA_PROJECT_KEY]: null,
        [SETTING_KEYS.JIRA_EPIC_KEY]: null,
        [SETTING_KEYS.JIRA_STORY_POINTS_FIELD]: null,
        [SETTING_KEYS.JIRA_SPRINT_FIELD]: null,
        [SETTING_KEYS.JIRA_LABELS_FIELD]: null,
      }),
    );
  };

  return (
    <div data-testid="wizard-board">
      <p className="hint wizard-help">Search your Agile boards and pick the one this plan tracks.</p>
      {boardId && (
        <div className="wizard-current" data-testid="wizard-board-current">
          <span>
            Selected board: <strong>{currentName ?? `#${boardId}`}</strong>
            {projectKey ? <> · project <code>{projectKey}</code></> : null}
          </span>
          <button
            type="button"
            className="wizard-clear"
            aria-label="Clear selected board"
            disabled={disabled}
            onClick={clearBoard}
          >
            ×
          </button>
        </div>
      )}
      {!boardId && (
        <Typeahead
          value={text}
          onChange={setText}
          disabled={disabled}
          searchOnEmpty
          placeholder="Search boards…"
          testId="wizard-board-search"
          search={(q) =>
            api.searchJiraBoards(q).then((r) =>
              r.boards.map((b) => ({ id: String(b.id), label: b.name, hint: b.projectKey ?? b.type, board: b })),
            )
          }
          onSelect={(opt) => {
            const b = (opt as { board: api.JiraBoardOption }).board;
            setText('');
            run(() =>
              api.patchSettings({
                [SETTING_KEYS.JIRA_BOARD_ID]: String(b.id),
                [SETTING_KEYS.JIRA_BOARD_NAME]: b.name,
                // A board carries its project; setting it unlocks epic + sample.
                ...(b.projectKey ? { [SETTING_KEYS.JIRA_PROJECT_KEY]: b.projectKey } : {}),
              }),
            );
          }}
        />
      )}
      <div className="wizard-nav">
        <button type="button" className="btn" disabled={!boardId} onClick={onNext} data-testid="wizard-board-next">
          Next: pick an epic →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Epic
// ---------------------------------------------------------------------------
function EpicStep({ projectKey, epicKey, disabled, run, onNext }: {
  projectKey: string | null; epicKey: string | null; disabled: boolean; run: Run; onNext: () => void;
}) {
  const [text, setText] = useState('');
  const clearEpic = () => {
    setText('');
    run(() => api.patchSettings({ [SETTING_KEYS.JIRA_EPIC_KEY]: null }));
  };
  return (
    <div data-testid="wizard-epic">
      <p className="hint wizard-help">
        Choose the epic to track{projectKey ? <> in <code>{projectKey}</code></> : null}. Work under
        it (stories → tickets) is what gets imported.
      </p>
      {!projectKey && <div className="config-error">Pick a board first so we know which project to search.</div>}
      {epicKey && (
        <div className="wizard-current" data-testid="wizard-epic-current">
          <span>
            Tracking epic: <JiraKeyLink jiraKey={epicKey} />
          </span>
          <button
            type="button"
            className="wizard-clear"
            aria-label="Clear selected epic"
            disabled={disabled}
            onClick={clearEpic}
          >
            ×
          </button>
        </div>
      )}
      {!epicKey && (
        <Typeahead
          value={text}
          onChange={setText}
          disabled={disabled || !projectKey}
          searchOnEmpty
          placeholder="Search epics…"
          testId="wizard-epic-search"
          search={(q) =>
            api.searchJiraEpics({ project: projectKey ?? undefined, q }).then((r) =>
              r.epics.map((e) => ({ id: e.key, label: e.summary, hint: e.key })),
            )
          }
          onSelect={(opt) => {
            setText('');
            run(() => api.patchSettings({ [SETTING_KEYS.JIRA_EPIC_KEY]: opt.id }));
          }}
        />
      )}
      <div className="wizard-nav">
        <button type="button" className="btn" disabled={!epicKey} onClick={onNext} data-testid="wizard-epic-next">
          Next: map fields →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------
function FieldsStep({ dataset, projectKey, epicKey, disabled, run, onNext }: {
  dataset: DomainDataset; projectKey: string | null; epicKey: string | null; disabled: boolean; run: Run; onNext: () => void;
}) {
  const [showTicket, setShowTicket] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <div data-testid="wizard-fields">
      <p className="hint wizard-help">
        Point the roles below at the fields your board actually uses. Story points and the
        “blocks” link type are required before you can sync.
      </p>

      <div className="ticket-cta" data-testid="wizard-ticket-cta">
        <div>
          <strong>Map from a ticket you know</strong>
          <div className="hint">Enter a ticket number or URL and we’ll read its fields for you.</div>
        </div>
        <button type="button" className="btn primary" disabled={disabled} data-testid="wizard-open-ticket"
          onClick={() => setShowTicket(true)}>
          Enter a ticket →
        </button>
      </div>

      <button type="button" className="link-btn" data-testid="wizard-toggle-advanced"
        onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? '▾ Hide' : '▸ Prefer to browse a board sample?'}
      </button>
      {showAdvanced && (
        <JiraFieldMapper dataset={dataset} disabled={disabled} run={run} project={projectKey ?? undefined} epic={epicKey ?? undefined} autoLoad />
      )}

      <div className="wizard-nav">
        <button type="button" className="btn" onClick={onNext}>Next: team members →</button>
      </div>

      {showTicket && (
        <TicketFieldModal
          dataset={dataset}
          disabled={disabled}
          run={run}
          initialRef={epicKey ?? ''}
          onClose={() => setShowTicket(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
function MembersStep({ teamId, members, disabled, run, onReload }: {
  teamId: string | null; members: TeamMember[]; disabled: boolean; run: Run; onReload: () => Promise<void>;
}) {
  const colors = useMemo(() => memberColorMap(members), [members]);
  const [addText, setAddText] = useState('');
  const memberControlsDisabled = disabled || teamId === null;

  return (
    <div data-testid="wizard-members">
      <p className="hint wizard-help">
        Search Jira for teammates to add, or link people you already created to their Jira account so
        their assigned work maps onto them.
      </p>
      {teamId === null && (
        <div className="wizard-current" data-testid="wizard-members-pending">
          Team members become editable after the first Jira sync creates the local team.
        </div>
      )}

      <div className="control">
        <label>Add a teammate from Jira</label>
        <Typeahead
          value={addText}
          onChange={setAddText}
          disabled={memberControlsDisabled}
          searchOnEmpty
          placeholder="Search people…"
          testId="wizard-member-search"
          search={(q) =>
            api.searchJiraUsers(q).then((r) =>
              r.users
                // Hide people already linked to a member.
                .filter((u) => !members.some((m) => m.jiraAccountId === u.accountId))
                .map((u) => ({ id: u.accountId, label: u.displayName, hint: u.email ?? undefined, imageUrl: u.avatarUrl })),
          )
          }
          onSelect={(opt) => {
            if (teamId === null) return;
            setAddText('');
            run(async () => {
              await api.createMember({ teamId, name: opt.label, baseVelocity: 10, jiraAccountId: opt.id, avatarUrl: opt.imageUrl ?? null });
              await onReload();
            });
          }}
        />
      </div>

      <div className="config-list" data-testid="wizard-member-list">
        {members.map((m) => (
          <MemberLinkRow key={m.id} member={m} color={colors.get(m.id) ?? '#6b7280'} disabled={disabled} run={run} onReload={onReload} />
        ))}
        {members.length === 0 && <div className="hint">No team members yet — search above to add some.</div>}
      </div>
    </div>
  );
}

function MemberLinkRow({ member, color, disabled, run, onReload }: {
  member: TeamMember; color: string; disabled: boolean; run: Run; onReload: () => Promise<void>;
}) {
  const [linkText, setLinkText] = useState('');
  const [linking, setLinking] = useState(false);
  return (
    <div className="config-row" data-testid={`wizard-member-${member.id}`}>
      <MemberAvatar name={member.name} color={color} size={22} avatarUrl={member.avatarUrl} />
      <span className="config-primary">{member.name}</span>
      {member.jiraAccountId ? (
        <>
          <span className="jira-field-badge" title={member.jiraAccountId}>🔗 linked</span>
          <button type="button" className="link-btn danger" disabled={disabled}
            onClick={() => run(async () => { await api.updateMember(member.id, { jiraAccountId: null }); await onReload(); })}>
            unlink
          </button>
        </>
      ) : linking ? (
        <div className="member-link-picker">
          <Typeahead
            value={linkText}
            onChange={setLinkText}
            disabled={disabled}
            searchOnEmpty
            placeholder="Find Jira user…"
            testId={`wizard-member-link-${member.id}`}
            search={(q) => api.searchJiraUsers(q).then((r) => r.users.map((u) => ({ id: u.accountId, label: u.displayName, hint: u.email ?? undefined, imageUrl: u.avatarUrl })))}
            onSelect={(opt) => {
              setLinking(false);
              setLinkText('');
              run(async () => { await api.updateMember(member.id, { jiraAccountId: opt.id, avatarUrl: opt.imageUrl ?? null }); await onReload(); });
            }}
          />
          <button type="button" className="link-btn" onClick={() => setLinking(false)}>cancel</button>
        </div>
      ) : (
        <>
          <span className="unit">local</span>
          <button type="button" className="link-btn" disabled={disabled}
            data-testid={`wizard-member-link-btn-${member.id}`} onClick={() => setLinking(true)}>
            link to Jira
          </button>
        </>
      )}
    </div>
  );
}
