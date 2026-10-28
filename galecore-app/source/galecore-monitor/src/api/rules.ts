import apiClient from './client';
import { AppConfig } from '../types/api';

/**
 * Configuración de la aplicación. El endpoint conserva el path histórico
 * (`/App/GaleCore/Rules/Core`) pero desde 2026-08-06 sirve config de plataforma, no reglas de
 * una estrategia: universo de streaming, `strategies[]` y el nodo `monitor`.
 */
export async function fetchAppConfig(): Promise<AppConfig> {
  const { data } = await apiClient.get<unknown>('/App/GaleCore/Rules/Core');
  const config: AppConfig = typeof data === 'string' ? JSON.parse(data) : data;
  console.debug('[AppConfig] tickers:', config?.universe?.tickers,
    'estrategias:', config?.strategies?.map((s) => s.id));
  return config;
}

export async function fetchRpfRulesRaw(): Promise<any> {
  const { data } = await apiClient.get<unknown>('/App/Rpf/Rules');
  return typeof data === 'string' ? JSON.parse(data) : data;
}
