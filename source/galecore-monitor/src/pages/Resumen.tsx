import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import apiClient from '../api/client';
import { fmtCurrency, fmtPct, fmtPnl, etDateParts } from '../utils/formatters';
import { AccountOverview, PositionLine, describeAccountError, fetchAccountOverview } from '../api/account';
import type { Tab } from '../components/layout/TabNav';
import './Resumen.css';

/** Cuenta del operador y calendario real de GaleCore. */

const LONG = 45_000;

interface CalEvent { date: string; name: string; expiry?: boolean }
const todayET = () => { const [y, m, d] = etDateParts(); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };

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
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => fetchAccountOverview()
      .then(o => { if (active) { setOverview(o); setError(null); } })
      .catch(err => { if (active) setError(describeAccountError(err).message); });
    load();
    const timer = setInterval(load, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <div className="rs">
    {error && !overview && <p className="rs-alert urgent" role="alert">{error}</p>}
    {!overview && !error && <p className="rs-empty">Leyendo la cuenta…</p>}
    {overview && <Overview o={overview} />}
  </div>;
}

const money = (n: number) => fmtCurrency(n);
const signed = (n: number, d = 2) => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(d)}`;
const tone = (n: number | null | undefined) => n == null ? undefined : n >= 0 ? 'pos' : 'neg';
const STRUCTURE: Record<string, string> = { PUT_CS: 'Put spread', CALL_CS: 'Call spread', IC: 'Iron condor', EQUITY: 'Acciones' };

/** Tablero: la cuenta a la izquierda, exposición y lo de hoy al lado; abajo, una línea por posición. */
function Overview({ o }: { o: AccountOverview }) {
  const over = o.maxRiskPct != null && o.maxRiskLimitPct != null && o.maxRiskPct > o.maxRiskLimitPct;
  const e = o.exposure;
  return <>
    <div className="rs-board">
      <section className="rs-account">
        <span className="rs-label">Valor de la cuenta</span>
        <strong className="rs-big">{money(o.netLiq)}</strong>
        <div className="rs-row"><span>Hoy</span><b className={tone(o.dayPnl)}>{o.dayPnl == null ? '—' : fmtPnl(o.dayPnl)}
          {o.dayPnlPct != null && <em> {fmtPct(o.dayPnlPct)}</em>}</b></div>
        <div className="rs-row"><span>Poder de compra</span><b>{money(o.buyingPower)}</b></div>
        <div className="rs-row"><span>Riesgo máximo</span><b className={over ? 'neg' : undefined}>{money(o.maxRisk)}
          {o.maxRiskPct != null && <em> {o.maxRiskPct.toFixed(0)} %{o.maxRiskLimitPct != null ? ` (límite ${o.maxRiskLimitPct} %)` : ''}</em>}</b></div>
      </section>
      <section>
        <span className="rs-label">Exposición</span>
        <div className="rs-row"><span>Acciones EE. UU.</span><b>{e.spyEquivalentShares == null ? '—'
          : `${e.spyEquivalentShares.toFixed(1)} SPY${e.spyEquivalentDollars != null ? ` · ${money(e.spyEquivalentDollars)}` : ''}`}</b></div>
        <div className="rs-row"><span>Theta</span><b className={tone(e.theta)}>{e.theta == null ? '—' : `${signed(e.theta)}/día`}</b></div>
        <div className="rs-row"><span>Vega</span><b className={tone(e.vega)}>{e.vega == null ? '—' : `${signed(e.vega)}/punto`}</b></div>
        {e.byUnderlying.length > 1 && e.byUnderlying.map(u => <div className="rs-row" key={u.symbol}><span>{u.symbol}</span>
          <b>{u.dollarDelta == null ? '—' : money(u.dollarDelta)}</b></div>)}
      </section>
      <section>
        <span className="rs-label">Atención</span>
        {o.attention.length === 0 ? <div className="rs-row"><span>Nada que pida atención.</span></div>
          : o.attention.map(a => <div className="rs-attention" key={a.title}><i className={a.kind}/>{a.title}</div>)}
      </section>
    </div>
    <section className="rs-lines" aria-label="Posiciones">
      {o.positions.length === 0 ? <p className="rs-empty">Sin posiciones abiertas.</p> : <>
        <div className="rs-line rs-line-head"><span>Posición</span><span>Strikes</span><span>Vence</span><span>Resultado</span><span>Objetivo</span></div>
        {o.positions.map(p => <PositionLineRow key={p.id} p={p} />)}
      </>}
    </section>
  </>;
}

function Payoff({ structure }: { structure: string }) {
  const d = structure === 'IC' ? 'M2 20H6L11 5H19L24 20H28' : structure === 'CALL_CS' ? 'M2 6H11L19 20H28' : structure === 'EQUITY' ? 'M2 22L28 4' : 'M2 20H11L19 6H28';
  return <svg className="rs-payoff" viewBox="0 0 30 26" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>;
}

/** Escalera chica: patas vendidas en rojo, compradas en verde, precio actual en blanco. */
function MiniLadder({ p }: { p: PositionLine }) {
  const legs = [
    { k: p.longPutStrike, short: false }, { k: p.shortPutStrike, short: true },
    { k: p.shortCallStrike, short: true }, { k: p.longCallStrike, short: false },
  ].filter((l): l is { k: number; short: boolean } => l.k != null);
  if (legs.length === 0) return <span className="rs-muted">{p.quantity} acciones</span>;
  const values = [...legs.map(l => l.k), ...(p.spot != null ? [p.spot] : [])];
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const x = (v: number) => 8 + (v - min) / span * 164;
  return <svg className="rs-ladder" viewBox="0 0 180 30" role="img" aria-label={`Strikes ${legs.map(l => l.k).join(' / ')}${p.spot != null ? `, precio ${p.spot.toFixed(2)}` : ''}`}>
    <line x1="8" x2="172" y1="9" y2="9" stroke="var(--border-light)" strokeWidth="1.5"/>
    {legs.map(l => <g key={l.k}><circle cx={x(l.k)} cy="9" r="4" fill={l.short ? 'var(--red-gc)' : 'var(--green)'}/>
      <text x={x(l.k)} y="27" textAnchor="middle">{l.k}</text></g>)}
    {p.spot != null && <line x1={x(p.spot)} x2={x(p.spot)} y1="2" y2="16" stroke="var(--text-primary)" strokeWidth="2"/>}
  </svg>;
}

function PositionLineRow({ p }: { p: PositionLine }) {
  const exp = p.expiration ? `${p.expiration.slice(8, 10)}/${p.expiration.slice(5, 7)}` : '—';
  return <div className="rs-line">
    <span className="rs-pos"><Payoff structure={p.structure}/><b>{p.symbol}</b>{STRUCTURE[p.structure] ?? p.structure}
      {p.structure !== 'EQUITY' && p.quantity > 1 && <em>×{p.quantity}</em>}</span>
    <span><MiniLadder p={p}/></span>
    <span>{p.dte == null ? '—' : `${exp} · ${p.dte} d`}</span>
    <span className={tone(p.pnl)}>{p.pnl == null ? '—' : fmtPnl(p.pnl)}{p.pnlPct != null && <em> {fmtPct(p.pnlPct, 1)}</em>}</span>
    <span>{p.takeProfit == null ? '—' : <><span className="pos">{fmtPnl(p.takeProfit)}</span> / <span className="neg">{fmtPnl(p.stopLoss ?? 0)}</span></>}</span>
  </div>;
}
