import type {
  EpicMilestone,
  Oncall,
  PlannedPlacement,
  Pto,
  SyncChange,
  SyncLogEntry,
  Team,
  TeamMember,
  VelocityOverride,
} from '@ecp/shared';

/**
 * Typed client for the backend Configuration write API (project plan §6). Each
 * call mirrors a repository operation; the caller reloads the dataset afterward
 * so the projection and graph recompute from the persisted source of truth.
 *
 * On a non-2xx response the server sends `{ error }`; this surfaces it as a
 * thrown {@link Error} so the UI can show the validation message.
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new Error(data?.error ?? `${method} ${path} failed (${res.status})`);
  }
  return data as T;
}

// --- Settings knobs (+ Jira mapping) ---------------------------------------
export const patchSettings = (patch: Record<string, unknown>): Promise<unknown> =>
  request('PATCH', '/api/settings', patch);

// --- Jira sync + live field mapping (project plan §7) ----------------------
export interface JiraSampleResponse {
  projectKey: string;
  sampleKey: string | null;
  fields: Record<string, unknown> | null;
  catalog: Array<{ id: string; name: string; custom: boolean; type: string | null }>;
  linkTypes: Array<{ id: string; name: string; inward: string; outward: string }>;
}

export interface SyncResponse {
  source: string;
  summary: Record<string, number>;
  changes?: SyncChange[];
  /** ISO datetime of this sync. */
  syncedAt?: string;
}

/** Analysis of one specific ticket, for the ticket-driven field mapper. */
export interface JiraFieldRef {
  id: string;
  name: string;
  custom: boolean;
  type: string | null;
}
export interface JiraTicketResponse {
  key: string;
  summary: string | null;
  status: string | null;
  issueType: string | null;
  fields: Record<string, unknown>;
  catalog: JiraFieldRef[];
  numericFields: Array<JiraFieldRef & { value: number }>;
  linkTypes: Array<{ id: string; name: string; inward: string; outward: string }>;
  blocks: {
    linkType: string | null;
    isNativeLink: boolean;
    blockedBy: string[];
    blocking: string[];
    customFieldCandidate: JiraFieldRef | null;
  };
}

/** Fetch the field catalog + a sample issue so the user can map fields live. */
export const getJiraSample = (params: { project?: string; epic?: string } = {}): Promise<JiraSampleResponse> => {
  const q = new URLSearchParams();
  if (params.project) q.set('project', params.project);
  if (params.epic) q.set('epic', params.epic);
  const qs = q.toString();
  return request('GET', `/api/jira/sample${qs ? `?${qs}` : ''}`);
};

/** Look up one specific ticket (by key or browse URL) for the field mapper. */
export const getJiraTicket = (ref: string): Promise<JiraTicketResponse> =>
  request('GET', `/api/jira/ticket${qs({ ref })}`);

/** Re-import from Jira and reconcile onto local state. */
export const syncNow = (): Promise<SyncResponse> => request('POST', '/api/sync');

/** The persisted sync-log history, newest first. */
export const getSyncLog = (): Promise<{ entries: SyncLogEntry[] }> => request('GET', '/api/sync/log');

// --- Jira setup wizard (project plan §7) -----------------------------------
export interface JiraConnection {
  connected: boolean;
  baseUrl: string | null;
  displayName?: string;
  email?: string | null;
  accountId?: string;
  error?: string;
}
export interface JiraBoardOption {
  id: number;
  name: string;
  type: string;
  projectKey: string | null;
}
export interface JiraEpicOption {
  key: string;
  summary: string;
}
export interface JiraUserOption {
  accountId: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
}

const qs = (params: Record<string, string | undefined>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && v.trim() !== '') q.set(k, v.trim());
  }
  const s = q.toString();
  return s ? `?${s}` : '';
};

/** Connection status for the wizard's Connect step (never returns the token). */
export const getJiraConnection = (): Promise<JiraConnection> => request('GET', '/api/jira/connection');

export const searchJiraBoards = (q?: string): Promise<{ boards: JiraBoardOption[] }> =>
  request('GET', `/api/jira/boards${qs({ q })}`);

export const searchJiraEpics = (params: { project?: string; q?: string } = {}): Promise<{
  projectKey: string;
  epics: JiraEpicOption[];
}> => request('GET', `/api/jira/epics${qs({ project: params.project, q: params.q })}`);

export const searchJiraUsers = (q?: string): Promise<{ users: JiraUserOption[] }> =>
  request('GET', `/api/jira/users${qs({ q })}`);

// --- Team cadence ----------------------------------------------------------
export const updateTeam = (id: string, patch: Partial<Omit<Team, 'id'>>): Promise<Team> =>
  request('PUT', `/api/teams/${encodeURIComponent(id)}`, patch);

// --- Members ---------------------------------------------------------------
export const createMember = (input: {
  teamId: string;
  name: string;
  baseVelocity: number;
  active?: boolean;
  /** Jira accountId to link this member to (from the people picker). */
  jiraAccountId?: string | null;
  /** Jira avatar image URL to show in the avatar chip. */
  avatarUrl?: string | null;
}): Promise<TeamMember> => request('POST', '/api/members', input);

export const updateMember = (
  id: string,
  patch: Partial<Pick<TeamMember, 'name' | 'baseVelocity' | 'active' | 'jiraAccountId' | 'avatarUrl'>>,
): Promise<TeamMember> => request('PUT', `/api/members/${encodeURIComponent(id)}`, patch);

export const deleteMember = (id: string): Promise<void> =>
  request('DELETE', `/api/members/${encodeURIComponent(id)}`);

// --- Date-range modifiers --------------------------------------------------
export const createPto = (input: {
  memberId: string;
  startDate: string;
  endDate: string;
  note?: string | null;
}): Promise<Pto> => request('POST', '/api/pto', input);
export const deletePto = (id: string): Promise<void> =>
  request('DELETE', `/api/pto/${encodeURIComponent(id)}`);

export const createOncall = (input: {
  memberId: string;
  startDate: string;
  endDate: string;
  note?: string | null;
}): Promise<Oncall> => request('POST', '/api/oncall', input);
export const deleteOncall = (id: string): Promise<void> =>
  request('DELETE', `/api/oncall/${encodeURIComponent(id)}`);

export const createVelocityOverride = (input: {
  memberId: string;
  startDate: string;
  endDate: string;
  multiplier: number;
  note?: string | null;
}): Promise<VelocityOverride> => request('POST', '/api/velocity-overrides', input);
export const deleteVelocityOverride = (id: string): Promise<void> =>
  request('DELETE', `/api/velocity-overrides/${encodeURIComponent(id)}`);

// --- Epic milestones ("relevant days") -------------------------------------
export const createMilestone = (
  epicKey: string,
  input: { name: string; date: string; isGating?: boolean },
): Promise<EpicMilestone> =>
  request('POST', `/api/epics/${encodeURIComponent(epicKey)}/milestones`, input);

export const updateMilestone = (
  id: string,
  patch: Partial<Pick<EpicMilestone, 'name' | 'date' | 'isGating'>>,
): Promise<EpicMilestone> => request('PUT', `/api/milestones/${encodeURIComponent(id)}`, patch);

export const deleteMilestone = (id: string): Promise<void> =>
  request('DELETE', `/api/milestones/${encodeURIComponent(id)}`);

// --- Gantt Planner placements (project plan §6a) ---------------------------
export const placeWorkItem = (input: {
  workItemKey: string;
  sprintId: string;
  weekIndex: number;
}): Promise<PlannedPlacement> => request('PUT', '/api/placements', input);

export const unplaceWorkItem = (workItemKey: string): Promise<void> =>
  request('DELETE', `/api/placements/${encodeURIComponent(workItemKey)}`);
