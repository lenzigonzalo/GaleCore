import apiClient from './client';
import { GexAnalysisResponse, GexRules } from '../types/gex';

/**
 * Switch de la estrategia. No hay funciones propias para leerlo ni escribirlo: el contrato es
 * uniforme para todas las estrategias y lo maneja `useStrategySwitchStore` sobre `api/strategies`.
 * Lo único propio de GEX es el endpoint, y el config de la app también lo declara — el que manda
 * es el del config (`switch_endpoint`); esta constante cubre el arranque, antes de que llegue.
 */
export const GEX_SWITCH_ENDPOINT = '/App/Gex/Switch';

/** Reglas de la estrategia GEX (`Files/Gex/galecore_rules_gex.json`, servido tal cual). */
export async function fetchGexRules(): Promise<GexRules> {
  const { data } = await apiClient.get<GexRules>('/App/Gex/Rules');
  return data;
}

/**
 * GEX global + desglose por vencimiento + contexto de mercado.
 * Timeout largo a propósito: la primera llamada del día barre toda la cadena (todos los
 * vencimientos ≤ max_dte). Las siguientes salen del cache del handler.
 */
export async function fetchGexAnalysis(
  symbol: string,
  refresh = false,
): Promise<GexAnalysisResponse> {
  const { data } = await apiClient.get<GexAnalysisResponse>('/App/Gex/Analysis', {
    params: { Symbol: symbol, Refresh: refresh },
    timeout: 300_000,
  });
  return data;
}
