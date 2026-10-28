export type PositionType = 'PUT_CS' | 'CALL_CS' | 'IC' | 'LONG';

export type AlertType =
  | 'CERRAR'
  | 'STOP_LOSS'
  | 'TIME_EXIT'
  | 'EVALUAR_ROLL'
  | 'DELTA_BREACH'
  | 'MACRO_PROXIMO'
  | null;

export interface ManualPosition {
  id: string;
  symbol: string;
  type: PositionType;
  shortStrike: number;
  longStrike: number;
  shortStrike2?: number;  // IC: call side short
  longStrike2?: number;   // IC: call side long
  expiration: string;     // ISO date YYYY-MM-DD
  credit: number;
  contracts: number;
  openDate: string;       // ISO date
  note?: string;
}

export interface EnrichedPosition extends ManualPosition {
  dte: number;
  currentPnl: number | null;      // P&L in dollars
  pnlPct: number | null;           // P&L as % of initial credit
  currentNetCredit: number | null; // live net credit from leg quotes
  legSymbols: Record<string, string>; // DXLink streamer symbols by role
  alert: AlertType;
}

/**
 * A structured credit spread reconstructed from Tastytrade account legs.
 * Source of truth for the Monitor tab — no manual entry required.
 */
export interface LiveSpread {
  id: string;                       // "{underlying}|{expiration}"
  underlyingSymbol: string;         // "SPY"
  expiration: string;               // "2026-05-16"
  dte: number;
  type: PositionType;
  contracts: number;
  multiplier: number;               // 100
  openDate: string;                 // ISO timestamp from Tastytrade

  // Strikes (parsed from OCC symbols)
  shortPutStrike?:  number;
  longPutStrike?:   number;
  shortCallStrike?: number;
  longCallStrike?:  number;

  // Entry prices per leg (averageOpenPrice from Tastytrade)
  shortPutEntry?:  number;
  longPutEntry?:   number;
  shortCallEntry?: number;
  longCallEntry?:  number;

  initialCredit:   number;          // net credit per contract at entry
  initialPremium:  number;          // initialCredit × 100 × contracts

  // Close prices snapshot from API (updated on account refresh)
  shortPutClose?:  number;
  longPutClose?:   number;
  shortCallClose?: number;
  longCallClose?:  number;

  // Computed metrics (live socket quote preferred, closePrice fallback)
  currentNetCredit: number | null;
  currentPnl:       number | null;  // P&L in USD
  pnlPct:           number | null;  // P&L as % of initialPremium
  hasLiveQuote:     boolean;        // true if at least one leg has a live socket quote

  legSymbols:  Record<string, string>;  // DXLink symbols by role
  legs:        import('./api').PositionResponse[];
  alert:       AlertType;
}

/** Computed suggested setup derived from GEX + IV + rules */
export interface SuggestedSetup {
  type: 'PUT_CS' | 'CALL_CS' | 'IC';
  // Primary leg pair (or put side for IC)
  shortStrike: number;
  longStrike: number;
  // Call side for IC
  secondShortStrike?: number;
  secondLongStrike?: number;
  expiration: string;
  dte: number;
  width: number;          // points
  // From GEX data
  shortLegOI: number | null;
  shortLegDelta: number | null;
  // Computed checks
  pop: number | null;          // proxy: (1 - |delta|) × 100
  creditRatioMin: number;      // from rules (e.g. 0.10)
  maxDeltaAbs: number;         // from rules
  // Live quote (not fetched automatically)
  estimatedCredit: number | null;
}
