import type {
  EpicMilestone,
  Oncall,
  PlannedPlacement,
  Pto,
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

// --- Settings knobs (+ Jira mapping stubs) ---------------------------------
export const patchSettings = (patch: Record<string, unknown>): Promise<unknown> =>
  request('PATCH', '/api/settings', patch);

// --- Team cadence ----------------------------------------------------------
export const updateTeam = (id: string, patch: Partial<Omit<Team, 'id'>>): Promise<Team> =>
  request('PUT', `/api/teams/${encodeURIComponent(id)}`, patch);

// --- Members ---------------------------------------------------------------
export const createMember = (input: {
  teamId: string;
  name: string;
  baseVelocity: number;
  active?: boolean;
}): Promise<TeamMember> => request('POST', '/api/members', input);

export const updateMember = (
  id: string,
  patch: Partial<Pick<TeamMember, 'name' | 'baseVelocity' | 'active'>>,
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
