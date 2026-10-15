import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import apiClient from '../api/client';
import { useAccountStore } from '../store/useAccountStore';
import { fmtCurrency, fmtPct, fmtPnl, etDateParts } from '../utils/formatters';
import { AccountOverview, describeAccountError, fetchAccountOverview } from '../api/account';
import { useMarketStore } from '../store/useMarketStore';
import type { Tab } from '../components/layout/TabNav';
import { portfolioRows } from '../utils/portfolioSummary';
import { LivePositionRow } from '../components/positions/PositionRow';
import { parseOccSymbol } from '../utils/streamerSymbol';
import './Resumen.css';

/** Cuenta del operador y calendario real de GaleCore. */

const LONG = 45_000;

interface CalEvent { date: string; name: string; expiry?: boolean }
const todayET = () => { const [y, m, d] = etDateParts(); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
const daysTo = (iso: string) => Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(todayET())) / 86_400_000);

let calendarCache: { at: number; events: CalEvent[] } | null = null;
async function readCalendar(): Promise<CalEvent[]> {
  if (calendarCache && Date.now() - calendarCache.at < 600_000) return calendarCache.events;
  const today = todayET();
  const end = new Date(Date.parse(today) + 45 * 86_400_000).toISOString().slice(0, 10);
  const [rel, fomc] = await Promise.all([
    apiClient.get('/Data/Fred/ReleaseDates', { params: { From: today, To: end, ReleaseIds: '50,10,46,53,54,9' }, timeout: LONG }),
    apiClient.get('/Data/Fed/FomcMeetings', { params: { Years: `${today.slice(0, 4)},${end.slice(0, 4)}` }, timeout: LONG }),
  ]);
  const r = ((rel.data?.data ?? []) as { date: string; releaseName: string }[]).map((x) => ({ date: x.date.slice(0, 10), name: x.releaseName }));
  const f = ((fomc.data?.data ?? []) as { end?: string }[]).filter((m) => m.end && m.end >= today && m.end.slice(0, 10) <= end)
    .map((m) => ({ date: m.end!.slice(0, 10), name: 'Decisión de la Fed' }));
  const events = [...r, ...f].sort((a, b) => a.date.localeCompare(b.date));
  calendarCache = { at: Date.now(), events };
  return events;
}

const NAMES: Record<string, string> = {
  'Consumer Price Index': 'Inflación (CPI)', 'Producer Price Index': 'Precios al productor (PPI)',
  'Advance Monthly Sales for Retail and Food Services': 'Ventas minoristas', 'Gross Domestic Product': 'PIB',
  'Personal Income and Outlays': 'Gasto personal (PCE)', 'Employment Situation': 'Empleo (NFP)',
};

/** Calendario macro: fechas civiles de EE. UU., sin convertirlas al huso del navegador. */
export function Calendario({ page = false }: { page?: boolean }) {
  const [events, setEvents] = useState<CalEvent[] | null>();
  const [offset, setOffset] = useState(0);
  useEffect(() => { let active = true; readCalendar().then(e => { if (active) setEvents(e); }).catch(() => { if (active) setEvents(null); }); return () => { active = false; }; }, []);
  const [y, m] = etDateParts();
  const month = new Date(y, m - 1 + offset, 1, 12);
  const coverageEnd = new Date(Date.parse(todayET()) + 45 * 86_400_000).toISOString().slice(0, 10);
  const maxOffset = (Number(coverageEnd.slice(0, 4)) - y) * 12 + Number(coverageEnd.slice(5, 7)) - m;
  const start = new Date(month); start.setDate(1 - (month.getDay() + 6) % 7);
  const cells = Array.from({ length: Math.ceil(((month.getDay() + 6) % 7 + new Date(y, m + offset, 0).getDate()) / 7) * 7 }, (_, i) => {
    const date = new Date(start); date.setDate(start.getDate() + i);
    return { date, iso: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` };
  });
  return <section className={'rs-panel rs-calendar' + (page ? ' rs-page' : '')}>
    <div className="rs-head"><h2>Macro · Calendario</h2><div className="rs-month">
      <button aria-label="Mes anterior" disabled={offset === 0} onClick={() => setOffset(offset - 1)}><ChevronLeft size={18}/></button>
      <strong>{month.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</strong>
      <button aria-label="Mes siguiente" disabled={offset >= maxOffset} onClick={() => setOffset(offset + 1)}><ChevronRight size={18}/></button>
    </div></div>
    <p>Inflación · Empleo · Actividad · Fed</p>
    {events === undefined && <p className="rs-empty">Cargando calendario…</p>}
    {events === null && <p className="rs-alert" role="alert">No se pudo leer el calendario macro.</p>}
    {events && events.length === 0 && <p className="rs-empty">Sin eventos en los próximos 45 días.</p>}
    <div className="rs-calendar-scroll"><div className="rs-calendar-grid">
      {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => <div className="rs-weekday" key={d}>{d}</div>)}
      {cells.map(({ date, iso }) => <div key={iso} className={'rs-day' + (date.getMonth() !== month.getMonth() || iso < todayET() || iso > coverageEnd ? ' outside' : '') + (iso === todayET() ? ' today' : '')}>
        <time dateTime={iso}>{date.getDate()}</time>
        {(events ?? []).filter(e => e.date === iso).map((e, i) => <div className="rs-event" key={e.name + i}>{NAMES[e.name] ?? e.name}</div>)}
      </div>)}
    </div></div>
    <p>Fechas de EE. UU. · {todayET()} a {coverageEnd} · FRED / Fed</p>
  </section>;
}

export function Resumen(_: { onNavigate: (tab: Tab) => void }) {
  const { positions, loadingPositions, errorPositions, positionsReadAt } = useAccountStore();
  const tickers = useMarketStore(s => s.tickers);
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => fetchAccountOverview()
      .then(o => { if (active) { setOverview(o); setOverviewError(null); } })
      .catch(err => { if (active) setOverviewError(describeAccountError(err).message); });
    load();
    const timer = setInterval(load, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const rows = portfolioRows(positions, tickers);
  return <div className="rs">
    <header className="rs-top"><h1>Mi cuenta</h1><span>Tastytrade · USD</span></header>
    {overviewError && !overview && <p className="rs-alert urgent" role="alert">{overviewError}</p>}
    {!overview && !overviewError && <p className="rs-empty">Leyendo la cuenta…</p>}
    {overview && <Overview o={overview} />}
    <section className="rs-block rs-portfolio">
      <h2>Posiciones</h2>
      {loadingPositions ? <p className="rs-empty">Leyendo posiciones…</p>
        : errorPositions ? <p className="rs-alert urgent" role="alert">No se pudieron leer las posiciones de la cuenta.</p>
        : !positionsReadAt ? <p className="rs-empty">Sin lectura de posiciones disponible.</p>
        : rows.length === 0 ? <p className="rs-empty">Sin posiciones en la última lectura.</p>
        : <div className="rs-position-rows">{rows.map(row => <LivePositionRow key={row.id} position={{ structure: row.structure, symbol: row.ticker, expiration: row.expiry ?? null, dte: row.expiry ? daysTo(row.expiry) : null, legs: row.legs.flatMap(leg => { const option = parseOccSymbol(leg.symbol); return option ? [{ side: leg.quantityDirection === 'Short' ? 'SELL' : 'BUY', type: option.side === 'P' ? 'PUT' : 'CALL', strike: option.strike, expiration: option.expiration }] : []; }), entryAt: row.legs[0].createdAt ?? null, credit: row.legs.length === 1 && row.short ? row.legs[0].averageOpenPrice : null, currentValue: null, pnl: row.pnl, risk: null, reason: row.priceStatus }}><div className="position-account-context"><span>{row.short ? '−' : ''}{row.quantity} {row.unit}</span><span>{row.pct === null ? row.priceStatus : fmtPct(row.pct)}</span></div></LivePositionRow>)}</div>}

    </section>
  </div>;
}

const money = (n: number) => fmtCurrency(n);
const signed = (n: number, d = 2) => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(d)}`;
const tone = (n: number | null | undefined) => n == null ? undefined : n >= 0 ? 'pos' : 'neg';

/** Lo primero que se ve: cuánta plata hay, qué riesgo tenemos, a qué estamos expuestos y qué pide atención. */
function Overview({ o }: { o: AccountOverview }) {
  const over = o.maxRiskPct != null && o.maxRiskLimitPct != null && o.maxRiskPct > o.maxRiskLimitPct;
  const e = o.exposure;
  return <>
    <div className="rs-strip">
      <div><span>Valor de la cuenta</span><strong>{money(o.netLiq)}</strong></div>
      <div><span>Resultado de hoy</span><strong className={tone(o.dayPnl)}>{o.dayPnl == null ? '—' : fmtPnl(o.dayPnl)}</strong>
        {o.dayPnlPct != null && <em className={tone(o.dayPnlPct)}>{fmtPct(o.dayPnlPct)}</em>}</div>
      <div><span>Poder de compra</span><strong>{money(o.buyingPower)}</strong></div>
      <div><span>Riesgo máximo abierto</span><strong className={over ? 'neg' : undefined}>{money(o.maxRisk)}</strong>
        {o.maxRiskPct != null && <em className={over ? 'neg' : undefined}>{o.maxRiskPct.toFixed(0)} % de la cuenta{o.maxRiskLimitPct != null ? ` · límite ${o.maxRiskLimitPct} %` : ''}</em>}</div>
    </div>
    <div className="rs-two">
      <section className="rs-block">
        <h2>A qué estamos expuestos</h2>
        <div className="rs-row"><span>Acciones de EE. UU.</span><b>{e.spyEquivalentShares == null ? '—'
          : `${e.spyEquivalentShares.toFixed(1)} acciones de SPY${e.spyEquivalentDollars != null ? ` · ${money(e.spyEquivalentDollars)}` : ''}`}</b></div>
        <div className="rs-row"><span>Theta (paso del tiempo)</span><b className={tone(e.theta)}>{e.theta == null ? '—' : `${signed(e.theta)} por día`}</b></div>
        <div className="rs-row"><span>Vega (volatilidad)</span><b className={tone(e.vega)}>{e.vega == null ? '—' : `${signed(e.vega)} por punto`}</b></div>
        {e.byUnderlying.length > 1 && e.byUnderlying.map(u => <div className="rs-row" key={u.symbol}><span>{u.symbol}</span>
          <b>{u.dollarDelta == null ? '—' : money(u.dollarDelta)}{u.maxRisk > 0 ? ` · riesgo ${money(u.maxRisk)}` : ''}</b></div>)}
      </section>
      <section className="rs-block">
        <h2>Qué pide atención hoy</h2>
        {o.attention.length === 0 ? <p className="rs-empty">Nada para hoy.</p>
          : o.attention.map(a => <div className="rs-attention" key={a.title}><i className={a.kind}/>{a.title}</div>)}
      </section>
    </div>
  </>;
}
