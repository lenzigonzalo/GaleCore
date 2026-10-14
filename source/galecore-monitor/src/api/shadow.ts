import apiClient from './client';
import {
  DISCARD_EVENT_TYPES, PerformancePanelParams, PerformancePanelResponse, ShadowEvaluation, ShadowEvent, ShadowPosition, ShadowStatus, SpecVersionMetrics,
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

export async function fetchShadowDiscards(instanceId: string, limit = 20): Promise<ShadowEvent[]> {
  const { data } = await apiClient.get<ShadowEvent[]>(
    `/App/Runtime/Instances/${encodeURIComponent(instanceId)}/Events`,
    { params: { types: DISCARD_EVENT_TYPES.join(','), limit } });
  return data;
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
