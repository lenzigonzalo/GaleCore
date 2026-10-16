import apiClient from './client';
import { BalancesResponse, PositionResponse } from '../types/api';

/** Los `code` del 409 que la API manda cuando el operador no puede leer SU cuenta. */
const NOT_LINKED = 'broker_account_not_linked';
const CREDENTIAL_INVALID = 'broker_credential_invalid';

const NOT_LINKED_MESSAGE =
  'No tenés una cuenta de bróker configurada. Vinculala en Mi Cuenta › Configuración › Cuenta de bróker.';

const CREDENTIAL_INVALID_MESSAGE =
  'Tastytrade rechaza la credencial de tu cuenta. Revisá en Mi Cuenta › Configuración › Cuenta de bróker que el ' +
  'refresh token y el client secret sean de la misma aplicación OAuth, y que el token siga vigente.';

/**
 * Los dos estados en los que el operador se queda sin datos de cuenta y la solución está en sus
 * manos. Uno u otro, nunca los dos: por eso es un campo con dos valores y no dos booleanos, que
 * dejarían escribible un estado —vinculada Y sin vincular— que no existe.
 */
export type BrokerAccountIssue = 'not_linked' | 'credential_invalid';

export interface AccountFailure {
  /** Lo que se le muestra al operador. */
  message: string;
  /**
   * Cuál de los dos estados es, o null si el fallo es otra cosa. Es un dato aparte del mensaje
   * porque el Monitor decide con él qué cartel muestra, y matchear el texto para eso se rompe al
   * reescribirlo.
   */
  brokerAccountIssue: BrokerAccountIssue | null;
}

/**
 * Traduce un fallo de los endpoints de cuenta a algo que el operador pueda accionar.
 *
 * Los dos estados que distingue tienen la misma forma —no hay datos, y el arreglo está en Mi
 * Cuenta— pero MANDAN A HACER COSAS DISTINTAS, y por eso no se unifican:
 *   * `not_linked` — todavía no cargó nada. Es el estado normal de alguien recién dado de alta.
 *   * `credential_invalid` — cargó algo que Tastytrade rechaza: un token revocado o vencido, o las
 *     dos mitades de la credencial (refresh token y client secret) de aplicaciones OAuth distintas.
 *     Decirle "vinculá tu cuenta" acá lo manda a un formulario que ya llenó, a mirar un número de
 *     cuenta que está bien.
 *
 * Cualquier otra falla se muestra tal cual: si la API se cayó de verdad, mandarlo a Mi Cuenta lo
 * hace buscar donde no es.
 */
export function describeAccountError(err: any): AccountFailure {
  const data = err?.response?.data;

  // Los casos esperados, con el contrato de hoy.
  if (data?.code === NOT_LINKED) {
    return { message: NOT_LINKED_MESSAGE, brokerAccountIssue: 'not_linked' };
  }
  if (data?.code === CREDENTIAL_INVALID) {
    return { message: CREDENTIAL_INVALID_MESSAGE, brokerAccountIssue: 'credential_invalid' };
  }

  // Una API anterior al 409 lo tiraba como 500 con el texto de la excepción en el cuerpo. Se
  // reconoce por el texto para que el tablero no dependa de que la API esté al día; se puede sacar
  // cuando no quede ninguna vieja corriendo. Solo cubre el caso sin vincular: la credencial
  // rechazada nació con su 409, así que nunca hubo una versión que la mandara como texto.
  const body = typeof data === 'string' ? data : '';
  if (body.includes('no tiene una cuenta de bróker vinculada')) {
    return { message: NOT_LINKED_MESSAGE, brokerAccountIssue: 'not_linked' };
  }

  return {
    message: data?.error || err?.message || 'No se pudieron leer los datos de la cuenta.',
    brokerAccountIssue: null,
  };
}

/** Una respuesta incompleta no representa un saldo cero. */
export function parseBalances(data: unknown): BalancesResponse {
  const raw = ((data as any)?.data ?? data) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') throw new Error('La API no devolvió una lectura de cuenta válida.');
  const number = (keys: string[]): number => {
    const value = keys.map(key => raw[key]).find(value => value != null);
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(parsed)) throw new Error('La lectura de cuenta está incompleta: falta ' + keys[0] + '.');
    return parsed;
  };
  return {
    accountNumber: String(raw.accountNumber ?? raw['account-number'] ?? ''),
    netLiquidatingValue: number(['netLiquidatingValue', 'netLiquidation', 'net-liquidating-value']),
    buyingPower: number(['buyingPower', 'cashBuyingPower', 'derivativeBuyingPower', 'buying-power', 'derivative-buying-power']),
    cash: number(['cash', 'cashBalance', 'cash-balance', 'cashAvailableToWithdraw']),
    maintenanceRequirement: (raw.maintenanceRequirement ?? raw['maintenance-requirement']) as number | undefined,
    // El store conserva por separado la hora de recepción; no inventamos hora de fuente.
    timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : '',
  };
}

export async function fetchBalances(): Promise<BalancesResponse> {
  const { data } = await apiClient.get<unknown>('/Data/Tastytrade/Account/Balances');
  return parseBalances(data);
}

export async function fetchPositions(): Promise<PositionResponse[]> {
  const { data } = await apiClient.get<unknown>('/Data/Tastytrade/Account/Positions');
  const arr = Array.isArray(data) ? data : (data as any)?.positions;
  if (!Array.isArray(arr)) throw new Error('La API no devolvió una lista de posiciones válida.');
  return arr as PositionResponse[];
}

/** Riesgo de cada spread de la cuenta, calculado en la API (pérdida máxima, POP y griegas netas). */
export interface AccountSpreadRisk {
  id: string;                 // "{subyacente}|{vencimiento}", igual que LiveSpread.id
  structure: string;
  width: number;
  maxProfit: number;
  maxLoss: number;
  pop: number | null;
  pop50: number | null;
  popBasis: 'vivo' | 'entrada';
  greeks: { delta: number; gamma: number; theta: number; vega: number; shortLegIv: number | null } | null;
}

export async function fetchSpreadRisk(): Promise<Record<string, AccountSpreadRisk>> {
  const { data } = await apiClient.get<{ spreads?: AccountSpreadRisk[] }>('/Data/Tastytrade/Account/Spreads');
  return Object.fromEntries((data?.spreads ?? []).map(s => [s.id, s]));
}

/** Inicio de la cuenta real (WS-0036): todo calculado en la API; el Monitor sólo lo muestra. */
export interface AccountOverview {
  asOf: string;
  netLiq: number; cash: number; buyingPower: number;
  dayPnl: number | null; dayPnlPct: number | null; openPnl: number | null;
  /** Hoy (posiciones) y semana, mes y año (valor de la cuenta). */
  periods?: { label: string; pnl: number | null; pct: number | null }[];
  /** Margen usado (mantenimiento), USD y % de la cuenta. */
  marginUsed?: number | null; marginUsedPct?: number | null;
  /** Valor de la cuenta: cierres diarios del último año y puntos de hoy, para el gráfico de Inicio. */
  history?: { time: string; value: number }[]; intraday?: { time: string; value: number }[];
  maxRisk: number; maxRiskPct: number | null; maxRiskLimitPct: number | null;
  exposure: {
    spyEquivalentShares: number | null; spyEquivalentDollars: number | null; theta: number | null; vega: number | null;
    byUnderlying: { symbol: string; dollarDelta: number | null; beta: number | null; maxRisk: number }[];
  };
  attention: { kind: 'gestion' | 'evento'; title: string }[];
  positions: PositionLine[];
  missing: string[];
}

/** Una posición en una línea, armada en la API (objetivo: el de las reglas mientras el usuario no ponga el suyo). */
export interface PositionLine {
  id: string; symbol: string; structure: 'PUT_CS' | 'CALL_CS' | 'IC' | 'EQUITY' | string;
  expiration: string | null; dte: number | null; quantity: number;
  shortPutStrike: number | null; longPutStrike: number | null; shortCallStrike: number | null; longCallStrike: number | null;
  spot: number | null; pnl: number | null; pnlPct: number | null;
  takeProfit: number | null; stopLoss: number | null; targetSource: string | null;
  /** Detalle (lo que era Cartera): spreads con crédito y valor por acción; acciones con precio promedio y valor. */
  credit?: number | null; currentValue?: number | null; maxLoss?: number | null; pop?: number | null;
  delta?: number | null; theta?: number | null; vega?: number | null; shortDistance?: number | null;
  averageOpenPrice?: number | null; marketValue?: number | null;
}

/** Aviso cerca del strike vendido (WS-0036): la API lo evalúa con la preferencia `aviso-strike` del usuario. */
export interface StrikeAlertSettings {
  enabled: boolean; unit: 'points' | 'pct'; distance: number; market_hours_only: boolean;
  by_position: Record<string, number>;
}
export const STRIKE_ALERT_KEY = 'aviso-strike';
export const STRIKE_ALERT_DEFAULTS: StrikeAlertSettings = { enabled: false, unit: 'points', distance: 15, market_hours_only: true, by_position: {} };

export interface StrikeAlert {
  id: string; positionId: string; side: 'put' | 'call'; strike: number; spot: number;
  distancePoints: number; distancePct: number; thresholdPoints: number; title: string;
}

export interface StrikeAlertsResult {
  alerts: StrikeAlert[];
  /** Posiciones que la API no pudo vigilar (sin cotización del subyacente o sin pareja): «sin aviso» no es «lejos del strike». */
  unevaluated: string[];
}

export async function fetchStrikeAlerts(): Promise<StrikeAlertsResult> {
  const { data } = await apiClient.get<{ alerts?: StrikeAlert[]; unevaluated?: string[] }>('/App/GaleCore/Account/StrikeAlerts', { timeout: 30_000 });
  return { alerts: data?.alerts ?? [], unevaluated: data?.unevaluated ?? [] };
}

export async function fetchAccountOverview(): Promise<AccountOverview> {
  const { data } = await apiClient.get<AccountOverview>('/App/GaleCore/Account/Overview', { timeout: 30_000 });
  return data;
}
