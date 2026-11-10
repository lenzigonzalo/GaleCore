import apiClient from './client';
import {
  DISCARD_EVENT_TYPES, PerformancePanelParams, PerformancePanelResponse, PerformanceSummary, ShadowEvaluation, ShadowEvent, ShadowPosition, ShadowStatus, SpecVersionMetrics, StrategyCard,
} from '../types/shadow';

/**
 * Runtime SHADOW (GC-0004). Todo lo que la pestaña muestra sale de estos endpoints: las métricas las
 * calcula la API desde la base; el front no suma ni promedia nada.
 */

export async function fetchShadowStatus(): Promise<ShadowStatus> {
  const { data } = await apiClient.get<ShadowStatus>('/App/Runtime/Status');
  return data;
}

/** 503 si el runtime no persiste: no hay métricas guardadas que mostrar. */
export async function fetchShadowMetrics(): Promise<SpecVersionMetrics[]> {
  const { data } = await apiClient.get<SpecVersionMetrics[]>('/App/Runtime/Metrics', { timeout: 30000 });
  return data;
}

export async function fetchShadowEvaluations(instanceId: string, limit = 20): Promise<ShadowEvaluation[]> {
  const { data } = await apiClient.get<ShadowEvaluation[]>(
    `/App/Runtime/Instances/${encodeURIComponent(instanceId)}/Evaluations`, { params: { limit } });
  return data;
}

export async function fetchShadowDiscards(instanceId: string, limit = 20, types: readonly string[] = DISCARD_EVENT_TYPES): Promise<ShadowEvent[]> {
  const { data } = await apiClient.get<ShadowEvent[]>(
    `/App/Runtime/Instances/${encodeURIComponent(instanceId)}/Events`,
    { params: { types: types.join(','), limit } });
  return data;
}

/** Todos los eventos de la instancia, sin filtrar por tipo (el Registro de la ficha). */
export async function fetchShadowEvents(instanceId: string, limit = 200): Promise<ShadowEvent[]> {
  const { data } = await apiClient.get<ShadowEvent[]>(
    `/App/Runtime/Instances/${encodeURIComponent(instanceId)}/Events`, { params: { limit } });
  return data;
}

/** Ventana de entrada, tope diario y límites en USD de la estrategia; 404 si la API no la conoce. */
export async function fetchStrategyCard(name: string): Promise<StrategyCard> {
  const { data } = await apiClient.get<StrategyCard>(`/App/Runtime/Strategies/${encodeURIComponent(name)}/Card`);
  return data;
}

/** Vuelve a prender una estrategia detenida: crea una instancia nueva de la misma versión (409 si la vigente es otra, 503 sin persistencia). */
export async function deployShadowSpec(specName: string, expectedHash: string): Promise<void> {
  await apiClient.post('/App/Runtime/Deploy', { specName, expectedHash });
}

export async function fetchShadowPositions(instanceId: string): Promise<ShadowPosition[]> {
  const { data } = await apiClient.get<ShadowPosition[]>(
    `/App/Runtime/Instances/${encodeURIComponent(instanceId)}/Positions`);
  return data;
}

export async function fetchPerformancePanel(params: PerformancePanelParams): Promise<PerformancePanelResponse> {
  const { data } = await apiClient.get<PerformancePanelResponse>(
    '/App/Runtime/Performance/Panel', { params, timeout: 30000 });
  return data;
}

export async function fetchPerformanceSummary(): Promise<PerformanceSummary[]> {
  const { data } = await apiClient.get<PerformanceSummary[]>('/App/Runtime/Performance/Summary', { timeout: 30000 });
  return data;
}

/** Detiene una instancia: no evalúa más entradas; sus posiciones abiertas se siguen valuando hasta su salida. */
export async function stopShadowInstance(instanceId: string): Promise<void> {
  await apiClient.post(`/App/Runtime/Instances/${encodeURIComponent(instanceId)}/Stop`);
}

/** Etapa (SHADOW | PAPER | LIVE) y modo (AUTO | MANUAL) de cada estrategia (WS-0036). */
export interface StrategySetting { name: string; stage: 'SHADOW' | 'PAPER' | 'LIVE'; mode: 'AUTO' | 'MANUAL'; isDefault: boolean; effect: string; updatedBy?: string | null; updatedAt?: string | null }
export async function fetchStrategySettings(): Promise<StrategySetting[]> {
  const { data } = await apiClient.get<StrategySetting[]>('/App/Strategies/Settings', { timeout: 15000 });
  return data;
}
export async function saveStrategySetting(name: string, stage: StrategySetting['stage'], mode: StrategySetting['mode']): Promise<StrategySetting> {
  const { data } = await apiClient.put<StrategySetting>(`/App/Strategies/Settings/${encodeURIComponent(name)}`, { stage, mode });
  return data;
}
