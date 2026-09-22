import axios, { AxiosError } from 'axios';
import {
  RegimeMeta, RegimeRecordsResponse, RegimeReviewRequest, RegimeReviewResponse, RegimeTodayResponse,
} from '../types/regime';

/**
 * Cliente del adapter LOCAL de registros de régimen (GaleCore-AI). No es la API .NET: es otro
 * proceso, en loopback, que lee `GaleCore/research/regime/` con las verificaciones de `query`.
 *
 * Va aparte de `apiClient` a propósito: el interceptor de aquel adjunta el JWT de Supabase o la
 * API key de GaleCore, y nada de eso tiene que viajar a este proceso. Lo único que este cliente
 * manda de más es el token de review, y solo en el POST.
 */
export const REGIME_ADAPTER_URL = process.env.REACT_APP_REGIME_ADAPTER_URL || 'http://127.0.0.1:8765';

const regimeClient = axios.create({ baseURL: REGIME_ADAPTER_URL, timeout: 15000 });

/** Dónde guarda el navegador el token de review que el operador pegó. Por pestaña, no persistente. */
export const REVIEW_TOKEN_STORAGE_KEY = 'galecore:regimeReviewToken';

export function getStoredReviewToken(): string {
  try { return sessionStorage.getItem(REVIEW_TOKEN_STORAGE_KEY) || ''; } catch { return ''; }
}

export function storeReviewToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(REVIEW_TOKEN_STORAGE_KEY, token);
    else sessionStorage.removeItem(REVIEW_TOKEN_STORAGE_KEY);
  } catch { /* sin storage no hay memoria del token; el formulario lo vuelve a pedir */ }
}

export async function fetchRegimeMeta(): Promise<RegimeMeta> {
  const { data } = await regimeClient.get<RegimeMeta>('/api/meta');
  return data;
}

export async function fetchRegimeToday(symbol: string): Promise<RegimeTodayResponse> {
  const { data } = await regimeClient.get<RegimeTodayResponse>('/api/today', { params: { symbol } });
  return data;
}

/**
 * Historial en un rango. 422 (integridad fallida) y 409 (lectura inconsistente) NO son errores de
 * transporte: el cuerpo trae la lista completa con esos días marcados, igual que el `exit 3` del CLI
 * trae el JSON. Por eso se aceptan como respuesta.
 */
export async function fetchRegimeRecords(symbol: string, since: string, until?: string): Promise<RegimeRecordsResponse> {
  const { data } = await regimeClient.get<RegimeRecordsResponse>('/api/records', {
    params: { symbol, since, ...(until ? { until } : {}) },
    validateStatus: (s) => s === 200 || s === 409 || s === 422,
  });
  return data;
}

/** Único endpoint de escritura: agrega el veredicto humano al run_id vía `record_review`. */
export async function postRegimeReview(body: RegimeReviewRequest, token: string): Promise<RegimeReviewResponse> {
  const { data } = await regimeClient.post<RegimeReviewResponse>('/api/reviews', body, {
    headers: { 'Content-Type': 'application/json', 'X-Review-Token': token },
  });
  return data;
}

/** 'unreachable' = no contestó nadie (adapter apagado); 'responded' = el adapter contestó con error. */
export function classifyRegimeError(e: unknown): 'unreachable' | 'responded' | 'unknown' {
  const err = e as AxiosError;
  if (err?.response) return 'responded';
  if (err?.request) return 'unreachable';
  return 'unknown';
}

/**
 * Mensaje para el operador. Distingue "el adapter no está corriendo" (lo más probable, es un
 * proceso aparte) de una respuesta del adapter con su propio error.
 */
export function describeRegimeError(e: unknown): string {
  const err = e as AxiosError<{ error?: string }>;
  if (err?.response) {
    const detail = err.response.data?.error;
    return detail ? `${detail} (HTTP ${err.response.status})` : `HTTP ${err.response.status}`;
  }
  if (err?.request) {
    return `No responde el adapter local en ${REGIME_ADAPTER_URL}. Arrancalo desde GaleCore-AI: `
      + 'python -B -m galecore_ai.adapters.regime_viewer';
  }
  return (err as Error)?.message ?? 'Error desconocido';
}
