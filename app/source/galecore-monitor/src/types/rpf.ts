// ─── Contrato de orquestación RPF (Fase 6) ──────────────────────────────────
// Espeja los DTOs del backend (DataFeed.Application/App/Rpf). SignalR serializa
// con CamelCasePropertyNamesContractResolver → nombres camelCase en el wire.

import { LegSymbols, LegMetaSet } from './api';

export type RpfStateName =
  | 'VETOED'
  | 'WAITING_CAPACITY'
  | 'IN_POSITION'
  | 'DORMANT'
  | 'ARMED'
  | 'COOLDOWN'
  | 'TRIGGERED';

export type RpfCheckStatus = 'pass' | 'fail' | 'skipped' | 'no_data' | 'pending';

/** Un check con etiqueta legible + valor/umbral, para pintar una fila del tablero. */
export interface RpfCheck {
  id: string;
  label: string;
  status: RpfCheckStatus;
  value?: number | null;
  threshold?: number | null;
  detail?: string | null;
}

/** La posición PCS candidata que el motor arma (se muestra siempre, aun DORMANT). */
export interface RpfCandidate {
  shortPutStrike?: number | null;
  longPutStrike?: number | null;
  shortPutDelta?: number | null;
  dte: number;
  expiration?: string | null;
  credit?: number | null;
  width?: number | null;
  creditRatio?: number | null; // fracción del ancho (0.21 = 21%)
  pop?: number | null;
  putWall?: number | null;
  edge?: number | null;
  bar?: number | null;
  fromCascade: boolean;
  /** Símbolos DXLink de los legs — el tablero los suscribe al socket para primas en vivo. */
  legSymbols?: LegSymbols | null;
  /** OI + cierre previo por leg — sublínea bajo cada strike. */
  legMeta?: LegMetaSet | null;
}

/** Snapshot del estado del loop por símbolo (evento ReceiveRpfState), enriquecido con el
 *  detalle de los dos ejes: arma (macro + gates de señal) y dispara (candidato). */
export interface RpfStateUpdate {
  symbol: string;
  state: RpfStateName;

  edge?: number | null;
  bar?: number | null;
  regime?: string | null;
  capacityAvailable?: boolean;
  openPositions?: number;
  maxPositions?: number;
  heatPct?: number | null;
  cooldownRemainingSec?: number | null;
  suggestionId?: string | null;

  // Eje ARMA
  macroPassed?: number;
  macroTotal?: number;
  macroChecks?: RpfCheck[];
  gates?: RpfCheck[];

  // Eje DISPARA
  candidate?: RpfCandidate | null;

  cascadeOk?: boolean;
  diedAtLayer?: number | null;
  timestamp: string;
}

export interface TradeSuggestionLeg {
  action: 'sell' | 'buy';
  streamerSymbol?: string | null;
  strike: number;
  delta?: number | null;
}

/** Sugerencia emitida al entrar en TRIGGERED (evento ReceiveTradeSuggestion). */
export interface TradeSuggestion {
  id: string;
  symbol: string;
  structure: string;
  legs: TradeSuggestionLeg[];
  credit: number;
  width: number;
  creditRatio?: number | null;
  edgeEmp?: number | null;
  bar?: number | null;
  regime: string;
  deltaShort: number;
  dte: number;
  riskPerTradePct?: number | null;
  highRisk: boolean;
  contracts: number;
  state: string;
  createdAt: string;
  ttlSeconds: number;
}
