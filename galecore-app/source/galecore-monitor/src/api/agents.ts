import apiClient from './client';

/**
 * Agentes en la nube (WS-0079): clave de agentes del usuario, corridas que reportan sus rutinas, token de disparo
 * y ejecución sin PC. El token de disparo y la clave sólo viajan hacia la API: nunca vuelven (se ve el final).
 */

export interface AgentRun {
  id: string; agent_key: string; origin: 'schedule' | 'manual'; status: 'requested' | 'ok' | 'error' | 'skipped' | 'no_report';
  summary?: string | null; reason_code?: string | null; session_url?: string | null;
  requested_at?: string | null; fired_at?: string | null; finished_at?: string | null; created_at: string;
}
export interface FireTokenStatus { exists: boolean; trigger_id?: string | null; token_hint?: string | null; last_fired_at?: string | null }
export interface AgentKeyStatus { exists: boolean; hint?: string | null; created_at?: string | null }

const base = '/App/GaleCore';
const agent = (key: string) => `${base}/Agents/${encodeURIComponent(key)}`;

export async function fetchRuns(key: string): Promise<AgentRun[]> {
  const { data } = await apiClient.get<{ runs: AgentRun[] }>(`${agent(key)}/Runs`);
  return data.runs ?? [];
}

export async function fetchFireToken(key: string): Promise<FireTokenStatus> {
  const { data } = await apiClient.get<FireTokenStatus>(`${agent(key)}/FireToken`);
  return data;
}

export async function saveFireToken(key: string, triggerId: string, token: string): Promise<FireTokenStatus> {
  const { data } = await apiClient.put<FireTokenStatus>(`${agent(key)}/FireToken`, { trigger_id: triggerId, token });
  return data;
}

export async function deleteFireToken(key: string): Promise<void> {
  await apiClient.delete(`${agent(key)}/FireToken`);
}

export async function runAgent(key: string): Promise<AgentRun> {
  const { data } = await apiClient.post<AgentRun>(`${agent(key)}/Run`, {});
  return data;
}

export async function fetchAgentKey(): Promise<AgentKeyStatus> {
  const { data } = await apiClient.get<AgentKeyStatus>(`${base}/AgentKey`);
  return data;
}

/** Genera o regenera la clave: la devuelve en claro esta única vez. */
export async function generateAgentKey(): Promise<{ key: string; hint: string }> {
  const { data } = await apiClient.post<{ key: string; hint: string }>(`${base}/AgentKey`, {});
  return data;
}

export async function revokeAgentKey(): Promise<void> {
  await apiClient.delete(`${base}/AgentKey`);
}

/** El mensaje de la API en castellano (409 routine_paused, 502 fire_token_rejected, 429 rate_limited…). */
export function apiMessage(e: any, fallback: string): string {
  const data = e?.response?.data;
  return typeof data?.error === 'string' && data.error ? data.error : fallback;
}
