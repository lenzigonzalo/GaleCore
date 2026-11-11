import apiClient from './client';

/** Agentes en la nube (WS-0079): las corridas que reportan sus rutinas. La clave y las variables las pone el Lab. */

export interface AgentRun {
  id: string; agent_key: string; origin: 'schedule' | 'manual'; status: 'requested' | 'ok' | 'error' | 'skipped' | 'no_report';
  summary?: string | null; reason_code?: string | null; session_url?: string | null;
  requested_at?: string | null; fired_at?: string | null; finished_at?: string | null; created_at: string;
  /** El cálculo de la skill (WS-0099 C): {skill, version, ok, error, salida}; `salida` sigue la convención de skills-con-codigo. */
  result?: { skill?: string | null; version?: number | null; ok?: boolean; error?: string | null; salida?: unknown } | null;
}

/** Aviso que dejó un agente (WS-0099 C): `id` es el del aviso y no se repite por agente. */
export interface AgentAlert { id: string; agent_key: string; title: string; created_at: string }

export async function fetchAgentAlerts(): Promise<AgentAlert[]> {
  const { data } = await apiClient.get<{ alerts?: AgentAlert[] }>('/App/GaleCore/Agents/Alerts');
  return data?.alerts ?? [];
}

export async function fetchRuns(key: string): Promise<AgentRun[]> {
  const { data } = await apiClient.get<{ runs: AgentRun[] }>(`/App/GaleCore/Agents/${encodeURIComponent(key)}/Runs`);
  return data.runs ?? [];
}

/** El mensaje de la API en castellano. */
export function apiMessage(e: any, fallback: string): string {
  const data = e?.response?.data;
  return typeof data?.error === 'string' && data.error ? data.error : fallback;
}
