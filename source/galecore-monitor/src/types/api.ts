// ─── App Config ───────────────────────────────────────────────────────────────
// Estructura de /App/GaleCore/Rules/Core — la configuración de la APLICACIÓN.
// Hasta v1.4.0 este endpoint servía las reglas de la estrategia core (tipo CoreRules); esa
// estrategia se eliminó y el archivo pasó a describir la plataforma. Las reglas de cada
// estrategia viven en su propio endpoint (/App/Rpf/Rules, /App/Gex/Rules).

/** Una estrategia implementada. Es lo que Main renderiza como card. */
export interface StrategyEntry {
  id: string;
  /** Prefijo de la estrategia: manda la ruta HTTP (/App/<prefix>/*) y la carpeta Files/<prefix>/. */
  prefix: string;
  /** Id de la pestaña del TabNav a la que navega la card. */
  tab: string;
  label: string;
  name?: string;
  kind?: string;
  description?: string;
  rules_endpoint: string;
  switch_endpoint: string;
}

/**
 * Un servicio de plataforma: un proceso que corre solo y NO es de ninguna estrategia. Es lo que
 * Main renderiza en la sección Plataforma.
 *
 * A diferencia de una estrategia, su switch tiene dos niveles y no tres —no hay preferencia por
 * usuario, porque no trabajan para nadie en particular— y solo lo pueden tocar los admin.
 */
export interface ServiceEntry {
  id: string;
  label: string;
  /** Nombre de la clase en el backend, para poder buscarla en el código y en los logs. */
  name?: string;
  description?: string;
  /** Lo que declara el JSON: el nivel de "reglas" del switch, no su estado actual. */
  enabled?: boolean;
  switch_endpoint: string;
}

export interface AppConfig {
  _meta?: {
    version?: string;
    name?: string;
    description?: string;
    last_updated?: string;
  };
  /** Símbolos que el front suscribe por SignalR. No es el universo de ninguna estrategia. */
  universe?: {
    tickers?: string[];
  };
  strategies?: StrategyEntry[];
  /** Procesos de plataforma con switch propio (hoy SkewSnapshotService). */
  services?: ServiceEntry[];
  /** Config de la pestaña Monitor — transversal a las estrategias. */
  monitor?: {
    trade_management?: {
      daily_kill_switch?: {
        daily_portfolio_mtm_loss_pct_net_liq_max: number;
      };
      take_profit?: {
        pct_of_initial_credit: number;
      };
      hard_defense?: {
        trigger_any: {
          short_leg_delta_abs_gt: number;
          unrealized_loss_pct_of_initial_credit_gte: number;
        };
      };
      defensive_roll?: {
        trigger_unrealized_loss_pct_of_initial_credit_gte: number;
        min_dte_remaining: number;
        min_net_credit_for_roll: number;
        max_rolls_per_position: number;
      };
      time_exit?: {
        dte_threshold: number;
      };
    };
    risk_limits?: {
      max_concurrent_positions?: number;
      portfolio_heat_max_pct?: number;
      risk_per_trade_pct?: number;
    };
  };
}

// ─── Analytics API ────────────────────────────────────────────────────────────

// Raw API response from /App.Analytics/GammaExposure
export interface GammaExposureApiResponse {
  symbol: string;
  spot: number;
  expiration: string;
  dte: number;
  expirationType: string;
  gammaZeroLevel: number;
  riskFreeRate: number;
  strikes: GexStrikeApi[];
}

export interface GexStrikeApi {
  strike: number;
  callDelta: number;
  callGamma: number;
  callIV: number;
  callOI: number;
  callGEX: number;
  putDelta: number;
  putGamma: number;
  putIV: number;
  putOI: number;
  putGEX: number;
  netGEX: number;
}

// Derived shape used throughout the app
export interface GammaExposureResponse {
  symbol: string;
  spot: number;
  dte: number;
  expiration: string;      // ISO date YYYY-MM-DD
  zeroGammaLevel: number;  // mapped from gammaZeroLevel
  netGex: number;           // sum of netGEX across strikes, in billions
  callWall: number;         // strike with max callGEX
  putWall: number;          // strike with most negative putGEX
  strikes: GexStrike[];
}

export interface GexStrike {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
  callOI: number;
  putOI: number;
  callDelta: number;
  putDelta: number;
}

// Raw API response from /App.Analytics/IVRank (field names TBD)
export type IVRankApiResponse = Record<string, unknown>;

// Raw API response from /App.Analytics/ImpliedVolatility (field names TBD)
export type ImpliedVolatilityApiResponse = Record<string, unknown>;

export interface IVRankResponse {
  symbol: string;
  ivRank: number;
  ivPercentile: number;
  timestamp: string;
}

export interface ImpliedVolatilityResponse {
  symbol: string;
  iv30: number;
  iv9d?: number;
  iv3m?: number;
  timestamp: string;
}

// ─── ValidationLayer API ─────────────────────────────────────────────────────
// Shape de los checks de régimen macro. Hoy lo produce /App/Gex/Analysis (la pestaña GEX lo adapta
// en `asValidationShape`); el endpoint /App/GaleCore/ValidationLayer que lo originó ya no existe.
export interface ValidationLayerApiResponse {
  symbol: string;
  profile: string;
  timestamp: string;
  spotPrice: number;
  overallSignal: string;
  failedAtLayer: number | null;
  macroRegime: MacroRegimeResult | null;
  positionBuilder: PositionBuilderResult | null;
  gexData: ValidationGexData | null;
}

export interface ValidationGexData {
  spot: number;
  dte: number;
  expiration: string;
  gammaZeroLevel: number | null;
  strikes: ValidationGexStrike[];
}

export interface ValidationGexStrike {
  strike: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  callOI: number;
  putOI: number;
  callDelta: number;
  putDelta: number;
}

// ─── Macro Regime (Layer 1) ───────────────────────────────────────────────────

export interface MacroRegimeResult {
  signal: string;
  passedCount: number;
  totalChecks: number;
  checks: MacroRegimeChecks;
}

export interface MacroRegimeChecks {
  vixAbsolute: { passed: boolean; value: number | null; threshold: number };
  // VIX9D vs VIX reales (índices CBOE), no la IV del símbolo. noData: faltó alguno de los dos; el
  // check viene passed=true porque no bloquea, pero no hay que pintarlo como un pass legítimo.
  vixTermStructure: { passed: boolean; noData: boolean; vix9d: number | null; vix30d: number | null };
  ivRank: { passed: boolean; value: number; min: number; max: number };
  ivMomentum: { passed: boolean; value: number | null; threshold: number };
  /** `thresholdDeclared: false` = el símbolo no tiene umbral propio y se usó el default del
   *  handler; el check se muestra apagado (sin validar) en vez de reprobado. */
  gexTotal: { passed: boolean; value: number; metric: string; threshold: number | null; thresholdDeclared?: boolean };
  spotVsZgl: { passed: boolean; spot: number; zgl: number | null; bufferPct: number };
}

// ─── Position Builder (Layers 2, 3, 4) ──────────────────────────────────────

export interface PositionBuilderResult {
  signal: string;
  strikeEngine: StrikeEngineResult | null;
  microstructure: MicrostructureResult | null;
  riskAndSizing: RiskAndSizingResult | null;
  /** Embudo signal_gates v1.4.0 (VRP, tail_score, edge, credit_minimum, short≤put_wall). */
  signalGates: SignalGatesResult | null;
}

// ─── Signal Gates (embudo v1.4.0) ─────────────────────────────────────────────

export interface GateResult {
  id: string;
  label: string;
  enabled: boolean;
  pass: boolean;
  /** pass | fail | skipped | no_data */
  status: 'pass' | 'fail' | 'skipped' | 'no_data';
  value: number | null;
  threshold: number | null;
  detail: string | null;
  onFail: string | null;
}

export interface SignalGatesResult {
  allPass: boolean;
  failedGate: string | null;
  gates: GateResult[];
}

export interface LegSymbols {
  shortPut: string | null;
  longPut: string | null;
  shortCall: string | null;
  longCall: string | null;
}

/** OI + cierre del período anterior de un leg. Fuente: definitions.leg_open_interest / leg_prev_close. */
export interface LegMeta {
  openInterest: number | null;
  prevClose: number | null;
}

export interface LegMetaSet {
  shortPut: LegMeta | null;
  longPut: LegMeta | null;
  shortCall: LegMeta | null;
  longCall: LegMeta | null;
}

export interface StrikeEngineResult {
  signal: string;
  expectedMove: number;
  dte: number;
  expiration: string;
  callWall: number | null;
  putWall: number | null;
  zScore: number;
  selectedStructure: string;
  shortPutStrike: number | null;
  shortCallStrike: number | null;
  shortPutDelta: number | null;
  shortCallDelta: number | null;
  longPutStrike: number | null;
  longCallStrike: number | null;
  strikesInsideWalls: boolean;
  structureRuleId: number | null;
  structureRuleName: string | null;
  structureRuleLabel: string | null;
  gexSign: string | null;
  trendSignal: string | null;
  ema20: number | null;
  ema50: number | null;
  realizedVolSignal: string | null;
  rv10d: number | null;
  rv30d: number | null;
  /** Proxy POP: (1 - |delta|) × 100. IC = mínimo de ambos lados. */
  pop: number | null;
  /** Regla 1/3 Tastytrade: credit/spread_width × 100. Target ≥ 33.3%. Fuente: definitions.credit_ratio. */
  creditRatio: number | null;
  /** Score compuesto de prioridad: (pop/100)*0.6 + (credit/width)*0.4. Fuente: position_builder.ranking. */
  priorityScore: number | null;
  /** Símbolos DXLink streamer por leg — suscribir al socket para quotes live. */
  legSymbols: LegSymbols | null;
  /** OI + cierre anterior por leg. Fuente: definitions.leg_open_interest / leg_prev_close. */
  legMeta: LegMetaSet | null;
}

export interface MicrostructureResult {
  signal: string;
  atmStrike: number;
  oiChecks: OIChecks;
  atmCallDelta: number | null;
  atmPutDelta: number | null;
  bidAskChecks: BidAskChecks | null;
  creditMinimum: CreditMinimumCheck | null;
}

export interface OIChecks {
  shortPut: OICheck | null;
  shortCall: OICheck | null;
  longPut: OICheck | null;
  longCall: OICheck | null;
}

export interface OICheck {
  passed: boolean;
  value: number;
  minRequired: number;
}

export interface BidAskChecks {
  shortPut: BidAskLegCheck | null;
  shortCall: BidAskLegCheck | null;
  longPut: BidAskLegCheck | null;
  longCall: BidAskLegCheck | null;
}

export interface BidAskLegCheck {
  passed: boolean;
  spreadPct: number | null;
  maxAllowed: number;
}

export interface CreditMinimumCheck {
  passed: boolean;
  midCredit: number;
  minRequired: number;
}

export interface RiskAndSizingResult {
  signal: string;
  netLiq: number;
  riskPerTrade: number;
  maxRiskAmount: number;
  openPositions: number;
  maxPositions: number;
  positionsAvailable: boolean;
  currentHeatPct: number;
  maxHeatPct: number;
  heatOk: boolean;
  /** Contratos máximos calculados con crédito snapshot. */
  contracts: number;
  /** Máx profit snapshot (frontend recalcula con live). */
  maxProfit: number;
  /** Máx loss snapshot (frontend recalcula con live). */
  maxLoss: number;
  /** Buying power requirement por contrato snapshot. */
  buyingPowerReq: number;
}

// ─── Market Data API ──────────────────────────────────────────────────────────

// Raw API response from /Data/Tastytrade/MarketData/ByType
export interface MarketDataByTypeApiResponse {
  data: {
    items: MarketDataItem[];
  };
}

export interface MarketDataItem {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  mark: number;
  last: number;       // current price
  open: number;
  'prev-close'?: number; // nombre publicado por la API de GaleCore
  volume: number;
  beta: number;
}

// Normalized shape returned by fetchMarketDataByType
export interface MarketDataByTypeResponse {
  symbol: string;
  open: number;
  prevClose?: number; // previous session close
  last: number;       // use as current price
  bid: number;
  ask: number;
  volume: number;
}

export interface CandleItem {
  time: number;   // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface QuoteResponse {
  symbol: string;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  timestamp: string;
}

// ─── Account API ──────────────────────────────────────────────────────────────
export interface BalancesResponse {
  accountNumber: string;
  netLiquidatingValue: number;
  buyingPower: number;
  cash: number;
  maintenanceRequirement?: number;
  timestamp: string;
}

export interface GroupedPosition {
  underlyingSymbol: string;
  legs: PositionResponse[];
  legCount: number;
  unrealizedPnl: number;
  realizedToday: number;
  typeLabel: string;   // 'Eq' | 'Opt' | 'Eq+Opt'
}

export interface PositionResponse {
  accountNumber: string;
  symbol: string;
  instrumentType: string;
  underlyingSymbol: string;
  quantity: number;
  quantityDirection: string;
  closePrice: number;
  averageOpenPrice: number;
  multiplier: number;
  costEffect: string;
  isSuppressed: boolean;
  isFrozen: boolean;
  restrictedQuantity: number;
  realizedDayGain: number;
  realizedDayGainEffect: string;
  realizedToday: number;
  realizedTodayEffect: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Structure Inputs ────────────────────────────────────────────────────────
// Factores de contexto de mercado (z-score, skew GEX, tendencia, vol realizada) que computa
// CascadeUtils en el backend. Hoy los expone /App/Gex/Analysis y los renderiza el DetailsPanel de
// GEX, repartidos entre sus grupos de volatilidad, gamma y precio según qué pregunta contesta cada uno.

export interface StructureInputs {
  priceZScore: PriceZScoreInput;
  gexSign: GexSignInput;
  trend: TrendInput;
  realizedVolRegime: RealizedVolInput;
}

export interface PriceZScoreInput {
  value: number;
  formula: string;
  ret5d: number;
  ivAtm: number;
  interpretation: string;
}

export interface GexSignInput {
  value: string;
  /** Ratio callGEX / (callGEX + |putGEX|) en [0, 1]. Ver definitions.gex_skew. */
  skewRatio: number;
  interpretation: string;
}

export interface TrendInput {
  ema20: number | null;
  ema50: number | null;
  signal: string;
  interpretation: string;
}

export interface RealizedVolInput {
  rv10d: number | null;
  rv30d: number | null;
  signal: string;
  interpretation: string;
}

// ─── SignalR Payloads ─────────────────────────────────────────────────────────
export interface TradePayload {
  price: number;
  size: number;
  timestamp: string;
  extendedTradingHours?: boolean;
}

export interface QuotePayload {
  bidPrice: number;
  askPrice: number;
  bidSize?: number;
  askSize?: number;
  midPrice?: number;
  volume?: number;
  timestamp?: string;
}

// ─── Symbol search (Data.Api) ─────────────────────────────────────────────────
/** Un resultado de GET /Data/Tastytrade/Symbols/Search. */
export interface SymbolSearchResult {
  symbol: string;
  description?: string | null;
  /**
   * "Equity" (incluye ETFs), "Index", "Future", "Cryptocurrency"…
   * **No dice si el símbolo tiene cadena de opciones**: eso recién se sabe al pedir el barrido, y
   * ahí la API responde 409 con `option_chain_not_found`.
   */
  instrumentType?: string | null;
  listedMarket?: string | null;
}

export interface SymbolSearchApiResponse {
  query: string;
  items: SymbolSearchResult[];
  count: number;
}

export interface GreeksPayload {
  eventSymbol?: string;
  price?: number;       // theoretical option price
  volatility?: number;  // implied volatility of the contract
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho?: number;
  timestamp?: string;
}

