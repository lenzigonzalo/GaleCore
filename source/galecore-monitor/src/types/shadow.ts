/**
 * Contratos de /App/Runtime/* (runtime SHADOW, GC-0004). La API los serializa en camelCase; las
 * claves de diccionarios (motivos de descarte, payload de eventos) llegan tal cual.
 */

export interface ShadowInstance {
  instanceId: string;
  deploymentId: string;
  versionHash: string;
  lifecycleState: string;
  schedulerState: string;
  specName: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShadowRecoveryReport {
  instances: number;
  openPositions: number;
  closedPositions: number;
  evaluations: number;
  events: number;
  specsRebuilt: string[];
  problems: string[];
}

export interface ShadowStatus {
  persistence: {
    available: boolean;
    reason: string | null;
    recoveredAt: string | null;
    recovery: ShadowRecoveryReport | null;
  };
  switch: { enabled: boolean; source: string };
  instances: ShadowInstance[];
}

export interface SpecVersionMetrics {
  contentHash: string;
  specName: string;
  specVersion: string;
  instances: number;
  evaluations: number;
  evaluationsPassed: number;
  firstEvaluationAt: string | null;
  lastEvaluationAt: string | null;
  discards: Record<string, number>;
  discardsTotal: number;
  noDataBlocks: number;
  positionsOpened: number;
  positionsOpen: number;
  positionsClosed: number;
  openPositionsNotValued: number;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  winRate: number | null;
  maxDrawdown: number | null;
  noTrades: boolean;
}

export interface GateResult {
  gateId: string;
  label: string;
  status: string;
  value: number | null;
  threshold: number | null;
  operator: string;
  onFail: string;
}

export interface ShadowEvaluation {
  evaluationId: string;
  instanceId: string;
  symbol: string;
  overallPass: boolean;
  gateResults: GateResult[];
  evaluatedAt: string;
}

export interface ShadowEvent {
  eventId: string;
  instanceId: string;
  eventType: string;
  symbol: string | null;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface ShadowLeg {
  side: string;
  type: string;
  strike: number;
  expiration: string | null;
  streamerSymbol: string | null;
  entryPrice: number;
  exitPrice: number | null;
}

export interface ShadowPosition {
  positionId: string;
  instanceId: string;
  symbol: string;
  structure: string;
  legs: ShadowLeg[];
  status: 'OPEN' | 'CLOSED' | string;
  entryCredit: number;
  maxRisk: number;
  width: number;
  entryDte: number;
  entryAt: string;
  exitDebit: number | null;
  exitAt: string | null;
  exitReason: string | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  lastSpreadValue: number | null;
  currentDte: number | null;
  lastValuedAt: string | null;
  valuationProblems: string[] | null;
}

/** Los tipos de evento que explican por qué una evaluación no terminó en una posición. */
export const DISCARD_EVENT_TYPES = [
  'GATES_NOT_PASSED', 'ENTRY_SKIPPED', 'CANDIDATE_NOT_VIABLE', 'RISK_CHECK_FAILED', 'ENTRY_ABORTED',
] as const;

export const DISCARD_LABELS: Record<string, string> = {
  GATES_NOT_PASSED: 'Gates no cumplidos',
  ENTRY_SKIPPED: 'Máximo de posiciones',
  CANDIDATE_NOT_VIABLE: 'Sin candidato viable',
  RISK_CHECK_FAILED: 'Riesgo rechazado',
  ENTRY_ABORTED: 'Switch apagado durante la entrada',
};
