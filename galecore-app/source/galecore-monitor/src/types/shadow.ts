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
  /** Quién la desplegó (la API lo guarda en la instancia). */
  deployedBy?: string | null;
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
  /** Contratos de la pata (opciones, la misma en todas); null en posiciones anteriores = 1. */
  quantity?: number | null;
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
  /** Sólo acciones (long_equity), lo calcula el back; null en spreads. */
  legsText?: string;
  shares?: number | null; entryPrice?: number | null; exitPrice?: number | null; lastPrice?: number | null; cost?: number | null;
  /** El back: «credit» | «debit», el monto sin signo y si está vencida sin liquidar. */
  entryKind?: 'credit' | 'debit'; entryAmount?: number; pendingSettlement?: boolean;
}

/** Los tipos de evento que explican por qué una evaluación no terminó en una posición. */
export const DISCARD_EVENT_TYPES = [
  'GATES_NOT_PASSED', 'ENTRY_SKIPPED', 'CANDIDATE_NOT_VIABLE', 'RISK_CHECK_FAILED', 'ENTRY_ABORTED',
] as const;

export const DISCARD_LABELS: Record<string, string> = {
  GATES_NOT_PASSED: 'Gates no cumplidos',
  ENTRY_SKIPPED: 'Entrada salteada',
  CANDIDATE_NOT_VIABLE: 'Sin candidato viable',
  RISK_CHECK_FAILED: 'Riesgo rechazado',
  ENTRY_ABORTED: 'Switch apagado durante la entrada',
  MAX_POSITIONS: 'Máximo de posiciones',
  TOO_SOON: 'Entradas muy seguidas',
  TRADE_LIMIT: 'Límite de operaciones',
  LOSS_BRAKE: 'Freno por pérdida',
  RISK_LIMIT: 'Límite de riesgo',
  OUTSIDE_ENTRY_WINDOW: 'Fuera de la ventana de entrada',
};
/** Qué límite frenó una entrada salteada (el campo `limit` del evento). */
export const LIMIT_LABELS: Record<string, string> = {
  trade_limits: 'Límite de operaciones',
  loss_brake: 'Freno por pérdida',
  max_bet: 'Tope por apuesta',
  risk_budget: 'Presupuesto de riesgo',
  margin_account_minimum: 'Mínimo de cuenta (margen)',
  intraday_margin: 'Margen intradiario',
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
export interface PanelLeg { side: string; type: string; strike: number; expiration: string | null; quantity?: number | null }
/** Una regla de entrada con el valor que vio al abrir la posición (WS-0057 C). */
export interface PanelGate { gateId: string; label: string; status: string; value: number | null; threshold: number | null; operator: string; onFail: string }
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
    entryAt: string; entryDte: number | null; currentDte: number | null; entryCredit: number;
    entryKind?: 'credit' | 'debit'; entryAmount?: number; pendingSettlement?: boolean;
    pnlPctOfCredit?: number | null; pnlPctOfCost?: number | null; pnlPctOfMaxRisk?: number | null;
    lastSpreadValue: number | null; unrealizedPnl: number | null; maxRisk: number;
    shares?: number | null; entryPrice?: number | null; lastPrice?: number | null; cost?: number | null;
    lastValuedAt: string | null; valuationProblems: string[] | null;
    entryGates?: PanelGate[]; entryVix?: number | null; entryIvRank?: number | null; entryUnderlyingPrice?: number | null }[];
  closedTrades: { positionId: string; version: string; structure: string; legs: string; symbol: string; legList: PanelLeg[];
    entryAt: string; exitAt: string | null; daysHeld: number | null; entryCredit: number;
    exitDebit: number | null; exitReason: string | null; realizedPnl: number | null;
    shares?: number | null; entryPrice?: number | null; exitPrice?: number | null; cost?: number | null;
    maxRisk: number; pnlPctOfCredit: number | null; pnlPctOfMaxRisk: number | null;
    entryKind?: 'credit' | 'debit'; entryAmount?: number; pnlPctOfCost?: number | null;
    grossPnl?: number | null; costs?: number | null; costsDeclared?: boolean;
    gapToPlan: number | null; entryVix: number | null; entryIvRank: number | null;
    entryUnderlyingPrice: number | null; exitDte: number | null; entryGates?: PanelGate[] }[];
  realizedPnl: Metric; unrealizedPnl: Metric; maxDrawdown: Metric;
  /** Neto = realizedPnl; el bruto y los costos sólo se muestran si la spec declara costos. */
  realizedGrossPnl?: Metric; totalCosts?: Metric; costsDeclared?: boolean;
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

/** GET /App/Runtime/Strategies/{name}/Card: ventana, tope diario y límites de la versión vigente; lo calcula la API. */
export interface StrategyCard {
  specName: string; version: string | null; contentHash: string | null;
  window: { start: string; end: string; timezone: string } | null;
  maxEntriesPerDay: number | null;
  limitsUsd: { capital: number | null; perTrade: number | null; openRisk: number | null; perBet: number | null };
  /** «Por qué no opera»: días hábiles seguidos sin entrar por la misma causa; lo calcula la API (StrategyStall). */
  stall?: { days: number; since: string; until: string; cause: string; causeLabel: string; reason: string; text: string } | null;
}
