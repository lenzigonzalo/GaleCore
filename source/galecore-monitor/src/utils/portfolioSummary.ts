import { PositionResponse } from '../types/api';
import { buildStreamerSymbol, legMid, parseOccSymbol } from './streamerSymbol';
import { TickerState } from '../types/market';
import { isStale } from './formatters';

/** Sólo combina estructuras inequívocas; las demás patas se conservan individualmente. */
export function portfolioRows(positions: PositionResponse[], tickers: Record<string, TickerState> = {}) {
  const groups = new Map<string, PositionResponse[]>();
  positions.filter(p => p.quantity !== 0).forEach(p => {
    const o = p.instrumentType === 'Equity' ? null : parseOccSymbol(p.symbol);
    const key = o ? `${o.underlying}|${o.expiration}` : p.symbol;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  });
  return Array.from(groups.values()).flatMap(legs => {
    const parsed = legs.map(p => parseOccSymbol(p.symbol));
    const pair = (side: 'P' | 'C') => {
      const subset = legs.filter((p, i) => parsed[i]?.side === side);
      const short = subset.find(p => p.quantityDirection === 'Short');
      const long = subset.find(p => p.quantityDirection === 'Long');
      if (subset.length !== 2 || !short || !long) return false;
      const s = parseOccSymbol(short.symbol)!.strike, l = parseOccSymbol(long.symbol)!.strike;
      return side === 'P' ? s > l : s < l;
    };
    const balanced = legs.every(p => p.quantity === legs[0].quantity && p.multiplier === legs[0].multiplier);
    const ic = legs.length === 4 && pair('P') && pair('C') &&
      Math.max(...parsed.filter(o => o?.side === 'P').map(o => o!.strike)) <
      Math.min(...parsed.filter(o => o?.side === 'C').map(o => o!.strike));
    const type = balanced ? (ic ? 'IC' : legs.length === 2 && pair('P') ? 'PCS' : legs.length === 2 && pair('C') ? 'CCS' : null) : null;
    return (type ? [legs] : legs.map(p => [p])).map(parts => {
      const first = parts[0];
      const option = first.instrumentType === 'Equity' ? null : parseOccSymbol(first.symbol);
      const marks = parts.map(p => {
        const o = p.instrumentType === 'Equity' ? null : parseOccSymbol(p.symbol);
        const symbol = o ? buildStreamerSymbol(o.underlying, o.expiration, o.side, o.strike) : p.symbol;
        const quote = tickers[symbol];
        const mid = legMid(quote?.bid, quote?.ask);
        return { mid: mid !== null && Number.isFinite(mid) && quote.bid <= quote.ask ? mid : null,
          stale: isStale(quote?.lastQuoteReceivedAt ?? null) };
      });
      const priceStatus = marks.some(m => m.mid === null) ? 'Sin cotización' : marks.some(m => m.stale) ? 'Cotización anterior' : null;
      const valid = parts.every(p => Number.isFinite(p.averageOpenPrice) &&
        Number.isFinite(p.quantity) && p.quantity > 0 && Number.isFinite(p.multiplier) && p.multiplier > 0 &&
        ['Long', 'Short'].includes(p.quantityDirection));
      const entry = valid ? parts.reduce((s, p) => s + (p.quantityDirection === 'Short' ? -1 : 1) * p.averageOpenPrice * p.quantity * p.multiplier, 0) : null;
      const pnl = valid && !priceStatus ? parts.reduce((s, p, i) => s + (p.quantityDirection === 'Short' ? -1 : 1) * (marks[i].mid! - p.averageOpenPrice) * p.quantity * p.multiplier, 0) : null;
      const gross = valid && !priceStatus ? parts.reduce((s, p, i) => s + Math.abs(marks[i].mid! * p.quantity * p.multiplier), 0) : null;
      return { id: parts.map(p => p.symbol).join('|'), ticker: first.underlyingSymbol || first.symbol,
        quantity: first.quantity, unit: first.instrumentType === 'Equity' ? 'acc' : 'ctos',
        structure: type ?? (first.instrumentType === 'Equity' ? 'ACC' : option?.side === 'P' ? 'PUT' : option?.side === 'C' ? 'CALL' : first.instrumentType),
        short: !type && first.quantityDirection === 'Short', expiry: option?.expiration,
        pnl, pct: pnl !== null && entry ? pnl / Math.abs(entry) * 100 : null, gross, priceStatus };
    });
  });
}
