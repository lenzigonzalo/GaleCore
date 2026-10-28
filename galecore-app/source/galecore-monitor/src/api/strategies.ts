import apiClient from './client';

/**
 * Estado del switch de una estrategia. Es GLOBAL: apagarla la apaga para todos, así que el POST
 * está restringido a los admin de la plataforma (`users.is_admin`) y responde 403 al resto.
 *
 * `source` dice qué nivel decidió el `enabled`, que se resuelve en el backend entre dos:
 *   - 'platform' — el kill switch del operador (`Files/<Prefijo>/<prefijo>_switch_state.json`)
 *   - 'rules'    — nadie tocó el switch: manda el JSON de reglas de la estrategia
 *
 * Hubo un tercer nivel por usuario (`'user'`, tabla `user_strategies`) que se eliminó el
 * 2026-08-12. Ver docs/GaleCore-plan-reorganizacion-2026-08.md, etapa 1.
 */
export interface StrategySwitchState {
  enabled: boolean;
  source: 'platform' | 'rules';
}

/**
 * Lee/escribe el switch por endpoint en vez de hardcodear la ruta: cada estrategia declara su
 * `switch_endpoint` en el config de la app, así que sumar una estrategia nueva no requiere
 * tocar el front. Contrato uniforme: GET → { enabled, source }, POST { enabled } → lo mismo.
 */
export async function fetchStrategySwitch(endpoint: string): Promise<StrategySwitchState> {
  const { data } = await apiClient.get<StrategySwitchState>(endpoint);
  return data;
}

export async function setStrategySwitch(endpoint: string, enabled: boolean): Promise<StrategySwitchState> {
  const { data } = await apiClient.post<StrategySwitchState>(endpoint, { enabled });
  return data;
}
