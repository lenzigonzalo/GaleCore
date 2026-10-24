import React, { useEffect, useState } from 'react';
import { fetchQuote } from '../../api/marketdata';
import { useMarketStore } from '../../store/useMarketStore';
import { fmtPrice, fmtTime, MARKET_TZ } from '../../utils/formatters';
import { amount, date, usd } from '../shadow/panelPresentation';
import { StrikeLadder } from '../monitor/StrikeLadder';
import './PositionRow.css';

export interface PositionLeg { side: string; type: string; strike: number; expiration?: string | null }
export interface PositionRowData {
  structure: string; symbol: string; expiration: string | null; dte: number | null;
  legs: PositionLeg[]; entryAt: string | null; credit: number | null; currentValue: number | null;
  pnl: number | null; risk: number | null; spot?: number | null; reason?: string | null;
  /** Acciones en largo (long_equity): lo que el back informa en vez de crédito y strikes. */
  equity?: { legs: string; shares: number | null; entryPrice: number | null; lastPrice: number | null; cost: number | null };
}
const quotes = new Map<string, Promise<number | null>>();
/** One quote per symbol, shared by mounted rows; stream always takes precedence. */
export function useUnderlyingPrice(symbol: string): number | null {
  const streamed = useMarketStore(state => state.tickers[symbol]?.price);
  const [fallback, setFallback] = useState<{ symbol: string; price: number | null } | null>(null);
  useEffect(() => {
    if (!symbol || (streamed !== undefined && Number.isFinite(streamed) && streamed > 0)) return;
    let active = true;
    if (!quotes.has(symbol)) quotes.set(symbol, fetchQuote(symbol).then(quote => {
      const event = quote.data?.find(item => item.eventSymbol === symbol);
      return event && Number.isFinite(event.midPrice) && event.midPrice > 0 && event.bidPrice > 0 && event.askPrice >= event.bidPrice ? event.midPrice : null;
    }).catch(() => null));
    void quotes.get(symbol)!.then(price => { if (active) setFallback({ symbol, price }); });
    return () => { active = false; };
  }, [symbol, streamed]);
  return streamed !== undefined && Number.isFinite(streamed) && streamed > 0 ? streamed : fallback?.symbol === symbol ? fallback.price : null;
}
const names: Record<string, string> = { iron_condor: 'IRON CONDOR', IC: 'IRON CONDOR', put_credit_spread: 'PUT CREDIT SPREAD', PUT_CS: 'PUT CREDIT SPREAD', PCS: 'PUT CREDIT SPREAD', call_credit_spread: 'CALL CREDIT SPREAD', CALL_CS: 'CALL CREDIT SPREAD', CCS: 'CALL CREDIT SPREAD', ACC: 'ACCIONES', long_equity: 'ACCIONES' };
export function PositionHeading({ structure, symbol, expiration, dte }: Pick<PositionRowData, 'structure' | 'symbol' | 'expiration' | 'dte'>) {
  const name = names[structure] || structure.toUpperCase();
  const condor = name === 'IRON CONDOR';
  const call = name === 'CALL CREDIT SPREAD';
  const expiry = expiration ? new Date(`${expiration.slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/\./g, '').toUpperCase() : null;
  return <div className="position-heading"><svg className="position-payoff" viewBox="0 0 48 40" aria-hidden="true"><path d={condor ? 'M4 32H10L18 9H30L38 32H44' : call ? 'M4 10H18L30 32H44' : 'M4 32H18L30 10H44'} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" /></svg><div><h4>{name} <span>{symbol}</span></h4><div className="position-expiry">{expiry && <span>{expiry}</span>}{dte !== null && <span className="position-dte">{fmtPrice(dte, 0)} DTE</span>}</div></div></div>;
}
export function PositionRow({ position, compact = false, children }: { position: PositionRowData; compact?: boolean; children?: React.ReactNode }) {
  const entry = position.entryAt ? `${new Date(position.entryAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', timeZone: MARKET_TZ })} ${fmtTime(new Date(position.entryAt)).slice(0, 5)} ET` : '—';
  return <article className={`position-row${compact ? ' compact' : ''}`} aria-label={`${position.symbol} ${names[position.structure] || position.structure}`}>
    <PositionHeading {...position} />
    {position.equity ? <div className="strike-empty">{position.equity.legs}</div> : <StrikeLadder legs={position.legs} spot={compact ? null : position.spot} />}
    {!compact && position.equity && <dl className="position-values"><div><dt>Entrada</dt><dd title={date(position.entryAt)}>{entry}</dd></div><div><dt>Precio de entrada</dt><dd>{position.equity.entryPrice === null ? '—' : amount(position.equity.entryPrice)}</dd></div><div><dt>Acciones</dt><dd>{position.equity.shares ?? '—'}</dd></div><div><dt>Costo</dt><dd>{position.equity.cost === null ? '—' : amount(position.equity.cost)}</dd></div><div><dt>Precio actual</dt><dd title={position.reason || undefined}>{position.equity.lastPrice === null ? '—' : amount(position.equity.lastPrice)}</dd></div><div><dt>Resultado abierto</dt><dd title={position.reason || undefined} style={{ color: position.pnl === null || position.pnl === 0 ? undefined : position.pnl > 0 ? 'var(--green)' : 'var(--red-gc)' }}>{position.pnl === null ? '—' : usd(position.pnl)}</dd></div></dl>}
    {!compact && !position.equity && <dl className="position-values"><div><dt>Entrada</dt><dd title={date(position.entryAt)}>{entry}</dd></div><div><dt>Crédito</dt><dd>{position.credit === null ? '—' : amount(position.credit)}</dd></div><div><dt>Valor actual</dt><dd title={position.reason || undefined}>{position.currentValue === null ? '—' : amount(position.currentValue)}</dd></div><div><dt>Resultado abierto</dt><dd title={position.reason || undefined} style={{ color: position.pnl === null || position.pnl === 0 ? undefined : position.pnl > 0 ? 'var(--green)' : 'var(--red-gc)' }}>{position.pnl === null ? '—' : usd(position.pnl)}</dd></div><div><dt>Riesgo</dt><dd title={position.risk === null ? 'La API de la cuenta no informa el riesgo de esta estructura.' : undefined}>{position.risk === null ? '—' : amount(position.risk)}</dd></div></dl>}
    {children}
  </article>;
}
export function LivePositionRow({ position, children }: { position: PositionRowData; children?: React.ReactNode }) {
  const spot = useUnderlyingPrice(position.symbol);
  return <PositionRow position={{ ...position, spot }} children={children} />;
}
