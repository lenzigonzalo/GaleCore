import { PositionType } from '../types/position';

// ── OCC symbol parsing ────────────────────────────────────────────────────────

export interface ParsedOcc {
  underlying: string;   // "SPY"
  expiration: string;   // "2026-05-16"
  side: 'C' | 'P';
  strike: number;       // 520.0
}

/**
 * Parses a Tastytrade OCC option symbol (21-char format).
 * "SPY   260516P00520000" → { underlying:"SPY", expiration:"2026-05-16", side:"P", strike:520 }
 */
export function parseOccSymbol(occ: string): ParsedOcc | null {
  if (!occ || occ.trim().length < 15) return null;
  // OCC: SSSSSSYYMMDDTPPPPPQQQ (21 chars, S padded with spaces)
  const s = occ.padEnd(21, ' ');
  const underlying = s.slice(0, 6).trim();
  const dateStr    = s.slice(6, 12);   // "260516"
  const side       = s.slice(12, 13) as 'C' | 'P';
  const strikeStr  = s.slice(13, 21);  // "00520000" = strike × 1000

  if (!underlying || !dateStr || (side !== 'C' && side !== 'P')) return null;

  const yy = dateStr.slice(0, 2);
  const mm = dateStr.slice(2, 4);
  const dd = dateStr.slice(4, 6);
  const expiration = `20${yy}-${mm}-${dd}`;

  const strike = parseInt(strikeStr, 10) / 1000;
  if (isNaN(strike)) return null;

  return { underlying, expiration, side, strike };
}

/**
 * Builds a DXLink streamer symbol for a single option leg.
 * Format: .{SYMBOL}{YYMMDD}{P|C}{STRIKE}
 * Example: .SPY260717P520
 */
export function buildStreamerSymbol(
  symbol: string,
  expiration: string, // "YYYY-MM-DD"
  side: 'P' | 'C',
  strike: number,
): string {
  const [year, month, day] = expiration.split('-');
  const dateStr = year.slice(2) + month + day;
  const strikeStr = Number.isInteger(strike) ? String(strike) : String(strike);
  return `.${symbol}${dateStr}${side}${strikeStr}`;
}

/**
 * Returns a map of leg role → streamer symbol for a given position.
 * Roles: shortPut, longPut, shortCall, longCall (as applicable to type).
 */
export function getLegSymbols(
  symbol: string,
  expiration: string,
  type: PositionType,
  shortStrike: number,
  longStrike: number,
  shortStrike2?: number,
  longStrike2?: number,
): Record<string, string> {
  const legs: Record<string, string> = {};

  if (type === 'PUT_CS' || type === 'IC') {
    legs.shortPut = buildStreamerSymbol(symbol, expiration, 'P', shortStrike);
    legs.longPut  = buildStreamerSymbol(symbol, expiration, 'P', longStrike);
  }

  if (type === 'CALL_CS') {
    legs.shortCall = buildStreamerSymbol(symbol, expiration, 'C', shortStrike);
    legs.longCall  = buildStreamerSymbol(symbol, expiration, 'C', longStrike);
  }

  if (type === 'IC') {
    const cs = shortStrike2 ?? shortStrike;
    const cl = longStrike2  ?? longStrike;
    legs.shortCall = buildStreamerSymbol(symbol, expiration, 'C', cs);
    legs.longCall  = buildStreamerSymbol(symbol, expiration, 'C', cl);
  }

  return legs;
}

/** Returns the mid price from bid/ask, or null if unavailable. */
export function legMid(bid?: number, ask?: number): number | null {
  if (!bid || !ask || bid <= 0 || ask <= 0) return null;
  return (bid + ask) / 2;
}

/** Computes the current net credit for a position given live leg mids. */
export function computeCurrentNetCredit(
  type: PositionType,
  shortPutMid: number | null,
  longPutMid: number | null,
  shortCallMid: number | null,
  longCallMid: number | null,
): number | null {
  if (type === 'PUT_CS') {
    if (shortPutMid == null || longPutMid == null) return null;
    return shortPutMid - longPutMid;
  }
  if (type === 'CALL_CS') {
    if (shortCallMid == null || longCallMid == null) return null;
    return shortCallMid - longCallMid;
  }
  if (type === 'IC') {
    if (shortPutMid == null || longPutMid == null || shortCallMid == null || longCallMid == null) return null;
    return (shortPutMid - longPutMid) + (shortCallMid - longCallMid);
  }
  return null;
}
