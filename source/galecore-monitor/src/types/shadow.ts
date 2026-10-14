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
export interface Metric { value: number | null; reason: string | null }
export interface PerformanceGroup {
  key: string; trades: number; winRate: number | null; avgPnl: number | null;
  realizedPnl: number | null; avgGapToPlan: number | null;
}
export interface PerformancePanelParams {
  spec: string; version?: string; from?: string; to?: string; referenceCapital?: number;
}
export interface PerformanceSummary {
  spec: string; tradesClosed: number; tradesOpen: number;
  winRate: Metric; realizedPnl: Metric; unrealizedPnl: Metric; expectancy: Metric;
  maxDrawdown: Metric; worstTrade: Metric; avgDaysHeld: Metric;
  takeProfitExits: number; stopLossExits: number; otherExits: number; lastExitAt: string | null;
}
export interface PanelLeg { side: string; type: string; strike: number; expiration: string | null }
export interface PerformancePanelResponse {
  asOf: string; mode: string; source: string; spec: string; version: string | null;
  from: string | null; to: string | null;
  tradesClosed: number; tradesOpen: number; firstExitAt: string | null; lastExitAt: string | null;
  tradesWon: number; tradesLost: number;
  grossProfit: Metric; grossLoss: Metric; largestWin: Metric; winLossRatio: Metric;
  smallSample: boolean; notes: string[];
  curve: { at: string; pnl: number; cumulative: number; drawdown: number }[];
  daily: { date: string; pnl: number; trades: number }[];
  openPositions: { positionId: string; version: string; structure: string; legs: string; symbol: string; legList: PanelLeg[];
    entryAt: string; entryDte: number; currentDte: number | null; entryCredit: number;
    lastSpreadValue: number | null; unrealizedPnl: number | null; maxRisk: number;
    lastValuedAt: string | null; valuationProblems: string[] | null }[];
  closedTrades: { positionId: string; version: string; structure: string; legs: string; symbol: string; legList: PanelLeg[];
    entryAt: string; exitAt: string | null; daysHeld: number | null; entryCredit: number;
    exitDebit: number | null; exitReason: string | null; realizedPnl: number | null;
    maxRisk: number; pnlPctOfCredit: number | null; pnlPctOfMaxRisk: number | null;
    gapToPlan: number | null; entryVix: number | null; entryIvRank: number | null;
    entryUnderlyingPrice: number | null; exitDte: number | null }[];
  realizedPnl: Metric; unrealizedPnl: Metric; maxDrawdown: Metric;
  winRate: Metric; avgWin: Metric; avgLoss: Metric; profitFactor: Metric; expectancy: Metric;
  sharpe: Metric; sortino: Metric; avgDaysHeld: Metric; worstTrade: Metric; lossStreak: Metric;
  openMaxRisk: number;
  openRiskVsLimits: { limit: string; used: number; max: number; headroom: number; ok: boolean }[] | null;
  openRiskVsLimitsReason: string | null;
  regime: { byVix: PerformanceGroup[]; byIvRank: PerformanceGroup[]; byGamma: PerformanceGroup[];
    tradesWithoutContext: number; reason: string | null; edges: string };
  byExitRule: PerformanceGroup[]; byVersion: PerformanceGroup[];
  references: { periodDays: number | null; strategyReturnPct: Metric; cashReturnPct: Metric;
    bondReturnPct: Metric; targetReturnPct: Metric; excessVsCashPct: Metric;
    excessVsBondPct: Metric; excessVsTargetPct: Metric };
  hypothesis: { tradesClosed: number; tradesRequired: number | null; daysElapsed: number | null;
    daysRequired: number | null; sampleReached: boolean | null; reason: string | null };
  execution: { tradesMeasured: number; tradesWithoutQuotes: number; avgCrossingCost: Metric;
    totalCrossingCost: Metric; realizedMeasured: Metric; realizedAfterCrossing: Metric;
    winRateAfterCrossing: Metric; notIncluded: string };
}
