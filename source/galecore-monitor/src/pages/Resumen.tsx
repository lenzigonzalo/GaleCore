import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import apiClient from '../api/client';
import { fmtCurrency, fmtPct, fmtPnl, etDateParts } from '../utils/formatters';
import { AccountOverview, PositionLine, STRIKE_ALERT_KEY, StrikeAlertSettings, describeAccountError, fetchAccountOverview } from '../api/account';
import { fetchSpace } from '../api/space';
import { readStrikeSettings, saveStrikeSettings } from '../components/settings/StrikeAlertForm';
import { NetLiqChart } from '../components/account/NetLiqChart';
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
  const [strike, setStrike] = useState<StrikeAlertSettings | null>(null);
  useEffect(() => {
    let active = true;   // una lectura atrasada no pisa lo que el usuario acaba de cambiar
    fetchSpace().then(({ items }) => { if (active) setStrike(readStrikeSettings(items.find(i => i.kind === 'preference' && i.key === STRIKE_ALERT_KEY))); })
      .catch(() => { if (active) setStrike(null); });
    return () => { active = false; };
  }, []);
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
    {overview && <Overview o={overview} strike={strike} onStrike={setStrike} />}
  </div>;
}

const money = (n: number) => fmtCurrency(n);
const signed = (n: number, d = 2) => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(d)}`;
const tone = (n: number | null | undefined) => n == null ? undefined : n >= 0 ? 'pos' : 'neg';
const STRUCTURE: Record<string, string> = { PUT_CS: 'Put spread', CALL_CS: 'Call spread', IC: 'Iron condor', EQUITY: 'Acciones' };

/**
 * Inicio como el encabezado de Tastytrade o IBKR: una franja con los números de la cuenta, debajo lo que pide atención
 * y la tabla de posiciones a todo el ancho.
 */
function Overview({ o, strike, onStrike }: { o: AccountOverview; strike: StrikeAlertSettings | null; onStrike: (s: StrikeAlertSettings) => void }) {
  const over = o.maxRiskPct != null && o.maxRiskLimitPct != null && o.maxRiskPct > o.maxRiskLimitPct;
  const e = o.exposure;
  const periods = o.periods ?? [{ label: 'Hoy', pnl: o.dayPnl, pct: o.dayPnlPct }];
  const [period, setPeriod] = useState('Hoy');
  // El gráfico sólo recorta la serie de la API al período elegido y le suma el valor de ahora.
  const chartPoints = useMemo(() => {
    const now = { time: o.asOf, value: o.netLiq };
    if (period === 'Hoy') return [...(o.intraday ?? []), now];
    const d = new Date(o.asOf);
    const from = period === 'Semana' ? new Date(d.getTime() - 7 * 864e5)
      : period === 'Mes' ? new Date(d.getFullYear(), d.getMonth() - 1, d.getDate()) : new Date(d.getFullYear(), 0, 1);
    return [...(o.history ?? []).filter(p => new Date(p.time) >= from), now];
  }, [o, period]);
  return <>
    <section className="rs-card rs-hero" aria-label="Valor de la cuenta">
      <div className="rs-hero-side">
        <div className="rs-hero-value"><span>Valor de la cuenta</span><strong>{money(o.netLiq)}</strong></div>
        <div className="rs-periods" role="tablist" aria-label="Resultado por período">
          {periods.map(p => <button key={p.label} role="tab" aria-selected={period === p.label} onClick={() => setPeriod(p.label)}
            title={p.label === 'Hoy' ? undefined : 'Diferencia del valor de la cuenta: incluye depósitos y retiros'}>
            <span>{p.label}</span><strong className={tone(p.pnl)}>{p.pnl == null ? '—' : fmtPnl(p.pnl)}</strong>
            <em className={tone(p.pct)}>{p.pct == null ? '' : fmtPct(p.pct)}</em></button>)}
        </div>
      </div>
      <NetLiqChart points={chartPoints} up={(periods.find(p => p.label === period)?.pnl ?? 0) >= 0} label={`Valor de la cuenta, ${period.toLowerCase()}`} intraday={period === 'Hoy'} />
    </section>
    <div className="rs-cards">
      <section className="rs-card" aria-label="Capital">
        <h2>Capital</h2>
        <div className="rs-tiles">
          <Tile label="Poder de compra" value={money(o.buyingPower)} concept="Lo que queda para abrir posiciones" />
          <Tile label="Margen usado" value={o.marginUsed == null ? '—' : money(o.marginUsed)}
            concept={o.marginUsedPct == null ? 'Lo que el bróker retiene como garantía' : `${o.marginUsedPct.toFixed(0)} % de la cuenta retenido como garantía`}
            bar={o.marginUsedPct ?? undefined} />
          <Tile label="Riesgo máximo" value={money(o.maxRisk)} tone={over ? 'neg' : undefined}
            concept={o.maxRiskPct == null ? 'Lo máximo que pueden perder los spreads' : `${o.maxRiskPct.toFixed(0)} % de la cuenta${o.maxRiskLimitPct != null ? ` · límite ${o.maxRiskLimitPct} %` : ''}`}
            bar={o.maxRiskPct ?? undefined} limit={o.maxRiskLimitPct ?? undefined} />
        </div>
      </section>
      <section className="rs-card" aria-label="Griegas de la cartera">
        <h2>Griegas de la cartera</h2>
        <div className="rs-tiles">
          <Tile label="Delta" value={e.spyEquivalentShares == null ? '—' : `${e.spyEquivalentShares.toFixed(1)} SPY`} tone={tone(e.spyEquivalentShares)}
            concept={e.spyEquivalentShares == null ? 'Cuánto se mueve con el mercado' : `Si SPY sube $1, la cartera ${e.spyEquivalentShares >= 0 ? 'gana' : 'pierde'} ${signed(Math.abs(e.spyEquivalentShares))}`} />
          <Tile label="Theta" value={e.theta == null ? '—' : `${signed(e.theta)}/día`} tone={tone(e.theta)}
            concept="Lo que se cobra por cada día que pasa" />
          <Tile label="Vega" value={e.vega == null ? '—' : signed(e.vega)} tone={tone(e.vega)}
            concept="Si la volatilidad sube 1 punto" />
        </div>
      </section>
    </div>
    {o.attention.length > 0 && <section className="rs-card rs-attention-card" aria-label="Atención">
      <h2>Qué pide atención</h2>
      {o.attention.map(a => <div className="rs-attention" key={a.title}>
        <span className={'rs-tag ' + a.kind}>{a.kind === 'gestion' ? 'Posición' : 'EE. UU.'}</span>{a.title}</div>)}
    </section>}
    <section className="rs-card rs-lines" aria-label="Posiciones">
      <h2>Posiciones</h2>
      {o.positions.length === 0 ? <p className="rs-empty">Sin posiciones abiertas.</p> : <>
        <div className="rs-line rs-line-head"><span>Posición</span><span>Strikes</span><span>Vence</span><span>Resultado</span><span>Delta</span><span>Theta</span><span>Objetivo</span><span>Aviso strike</span></div>
        {Array.from(new Set(o.positions.map(p => p.symbol))).map(sym => {
          const rows = o.positions.filter(p => p.symbol === sym);
          const pnl = rows.every(r => r.pnl != null) ? rows.reduce((a, r) => a + (r.pnl ?? 0), 0) : null;
          const risk = o.exposure.byUnderlying.find(u => u.symbol === sym)?.maxRisk;
          return <div key={sym} className="rs-group" role="group" aria-label={`Posiciones en ${sym}`}>
            <div className="rs-group-head"><b>{sym}</b>{rows[0].spot != null && <span>{money(rows[0].spot)}</span>}
              {pnl != null && <span className={tone(pnl)}>{fmtPnl(pnl)}</span>}
              {risk != null && risk > 0 && <span>riesgo {money(risk)}</span>}</div>
            {rows.map(p => <PositionLineRow key={p.id} p={p} strike={strike} onStrike={onStrike} />)}
          </div>;
        })}
      </>}
    </section>
  </>;
}

/** Un número grande con su concepto escrito al lado (owner 15/10: «números grandes y conceptos visibles»). */
function Tile({ label, value, concept, tone: t, bar, limit }: { label: string; value: string; concept: string; tone?: string; bar?: number; limit?: number }) {
  return <div className="rs-tile"><span>{label}</span><strong className={t}>{value}</strong>
    {bar != null && <div className="rs-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} className={limit != null && bar > limit ? 'neg' : undefined}/>
      {limit != null && <b style={{ left: `${Math.min(100, limit)}%` }}/>}</div>}
    <p>{concept}</p></div>;
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
  const x = (v: number) => 10 + (v - min) / span * 200;
  return <svg className="rs-ladder" viewBox="0 0 220 34" role="img" aria-label={`Strikes ${legs.map(l => l.k).join(' / ')}${p.spot != null ? `, precio ${p.spot.toFixed(2)}` : ''}`}>
    <line x1="10" x2="210" y1="10" y2="10" stroke="var(--border-light)" strokeWidth="1.5"/>
    {legs.map(l => <g key={l.k}><circle cx={x(l.k)} cy="10" r="5" fill={l.short ? 'var(--red-gc)' : 'var(--green)'}/>
      <text x={x(l.k)} y="31" textAnchor="middle">{l.k}</text></g>)}
    {p.spot != null && <line x1={x(p.spot)} x2={x(p.spot)} y1="2" y2="18" stroke="var(--text-primary)" strokeWidth="2"/>}
  </svg>;
}

function PositionLineRow({ p, strike, onStrike }: { p: PositionLine; strike: StrikeAlertSettings | null; onStrike: (s: StrikeAlertSettings) => void }) {
  const exp = p.expiration ? `${p.expiration.slice(8, 10)}/${p.expiration.slice(5, 7)}` : '—';
  const [open, setOpen] = useState(false);
  return <div className={'rs-position' + (open ? ' open' : '')}>
  <div className="rs-line" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(v => !v)}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}>
    <span className="rs-pos"><ChevronDown size={16} className="rs-chevron"/><Payoff structure={p.structure}/>{STRUCTURE[p.structure] ?? p.structure}
      {p.structure !== 'EQUITY' && p.quantity > 1 && <em>×{p.quantity}</em>}</span>
    <span><MiniLadder p={p}/></span>
    <span>{p.dte == null ? '—' : `${exp} · ${p.dte} d`}</span>
    <span className={tone(p.pnl)}>{p.pnl == null ? '—' : fmtPnl(p.pnl)}{p.pnlPct != null && <em> {fmtPct(p.pnlPct, 1)}</em>}</span>
    <span>{p.delta == null ? '—' : p.delta.toFixed(1)}</span>
    <span className={tone(p.theta)}>{p.theta == null ? '—' : signed(p.theta)}</span>
    <span>{p.takeProfit == null ? '—' : <><span className="pos">{fmtPnl(p.takeProfit)}</span> / <span className="neg">{fmtPnl(p.stopLoss ?? 0)}</span></>}</span>
    <span onClick={e => e.stopPropagation()}>{p.structure === 'EQUITY' || !strike?.enabled ? '—' : <StrikeDistance id={p.id} s={strike} onSave={onStrike} />}</span>
  </div>
  {open && <PositionDetail p={p} />}
  </div>;
}

/** El detalle de la posición (lo que era Cartera), con los números de la API. */
function PositionDetail({ p }: { p: PositionLine }) {
  const items: [string, React.ReactNode][] = p.structure === 'EQUITY' ? [
    ['Cantidad', `${p.quantity} acciones`],
    ['Precio promedio', p.averageOpenPrice == null ? '—' : money(p.averageOpenPrice)],
    ['Precio actual', p.spot == null ? '—' : money(p.spot)],
    ['Valor de mercado', p.marketValue == null ? '—' : money(p.marketValue)],
  ] : [
    ['Crédito cobrado', p.credit == null ? '—' : `$${p.credit.toFixed(2)}`],
    ['Valor para cerrar', p.currentValue == null ? '—' : `$${p.currentValue.toFixed(2)}`],
    ['Riesgo máximo', p.maxLoss == null ? '—' : money(p.maxLoss)],
    ['Prob. de ganar (aprox.)', p.pop == null ? '—' : `${p.pop.toFixed(0)} %`],
    ['Al strike vendido', p.shortDistance == null ? '—' : <span className={p.shortDistance < 0 ? 'neg' : undefined}>{p.shortDistance.toFixed(1)} pts</span>],
    ['Delta', p.delta == null ? '—' : p.delta.toFixed(1)],
    ['Theta', p.theta == null ? '—' : <span className={tone(p.theta)}>{signed(p.theta)}/día</span>],
    ['Vega', p.vega == null ? '—' : signed(p.vega)],
  ];
  return <dl className="rs-detail">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

/**
 * Distancia del aviso cerca del strike para esta posición (WS-0036). Muestra la general o la propia; al tocarla se
 * edita, y vacía vuelve a la general. Se guarda en la misma preferencia que Configuración › Avisos.
 */
function StrikeDistance({ id, s, onSave }: { id: string; s: StrikeAlertSettings; onSave: (s: StrikeAlertSettings) => void }) {
  const own = s.by_position[id];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const unit = s.unit === 'pct' ? '%' : 'pts';
  const commit = async () => {
    setEditing(false);
    const value = Number(draft.replace(',', '.'));
    const by = { ...s.by_position };
    if (draft.trim() === '' || !(value > 0)) delete by[id]; else by[id] = value;
    const next = { ...s, by_position: by };
    onSave(next);
    try { await saveStrikeSettings(next); } catch { onSave(s); }
  };
  if (editing) return <input className="rs-strike-input" autoFocus inputMode="decimal" value={draft} aria-label="Distancia del aviso"
    placeholder={String(s.distance)} onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(false); }} />;
  return <button className="rs-strike" title="Cambiar la distancia de esta posición (vacío = la general)"
    onClick={() => { setDraft(own != null ? String(own) : ''); setEditing(true); }}>
    {own ?? s.distance} {unit}{own == null && <em> general</em>}
  </button>;
}
