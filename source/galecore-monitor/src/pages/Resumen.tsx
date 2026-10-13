import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import apiClient from '../api/client';
import { AccountSummary } from '../components/account/AccountSummary';
import { useAccountStore } from '../store/useAccountStore';
import { fmtCurrency, fmtPct, fmtTime, etDateParts } from '../utils/formatters';
import type { Tab } from '../components/layout/TabNav';
import { portfolioRows } from '../utils/portfolioSummary';
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
    <p className="rs-caption">Inflación · Empleo · Actividad · Fed</p>
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
    <p className="rs-caption">Fechas de EE. UU. · {todayET()} a {coverageEnd} · FRED / Fed</p>
  </section>;
}

export function Resumen(_: { onNavigate: (tab: Tab) => void }) {
  const { positions, balances, loadingPositions, errorPositions, positionsReadAt } = useAccountStore();
  const rows = portfolioRows(positions);
  const ready = !!positionsReadAt && !errorPositions && !loadingPositions;
  const gross = ready && rows.every(r => r.gross !== null) ? rows.reduce((s, r) => s + r.gross!, 0) : null;
  const exposure = gross !== null && balances && balances.netLiquidatingValue > 0 ? gross / balances.netLiquidatingValue * 100 : null;
  const expiring = ready ? rows.filter(r => r.expiry && daysTo(r.expiry) <= 7) : [];
  const money = (n: number | null) => n === null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  return <div className="rs">
    <header className="rs-top"><h1>Mi portfolio</h1><span>Cuenta real · USD</span></header>
    <div className="rs-capital"><AccountSummary layout="strip" />
      <section className="rs-exposure"><span title="Suma del valor absoluto de las posiciones; no equivale a riesgo máximo">Exposición bruta</span><strong>{exposure === null ? '—' : `${exposure.toFixed(1)}%`}</strong><span>{gross === null ? 'Sin valoración completa' : `${fmtCurrency(gross)} en posiciones`}</span></section>
    </div>
    {expiring.length > 0 && <div className={'rs-alert' + (expiring.some(r => daysTo(r.expiry!) <= 2) ? ' urgent' : '')} role="status"><AlertTriangle size={20}/><strong>Vencimientos próximos</strong><span>{expiring.map(r => `${r.ticker} · ${daysTo(r.expiry!) < 0 ? 'vencida' : daysTo(r.expiry!) === 0 ? 'hoy' : `${daysTo(r.expiry!)} días`}`).join(' / ')}</span></div>}
    <section className="rs-panel rs-portfolio">
      <div className="rs-head"><h2>Portfolio</h2><span>{ready ? `${rows.length} posiciones` : 'Cuenta'}{positionsReadAt && !errorPositions ? ` · Lectura ${fmtTime(positionsReadAt)} ET` : ''}</span></div>
      {loadingPositions ? <p className="rs-empty">Leyendo posiciones…</p>
        : errorPositions ? <p className="rs-alert urgent" role="alert">No se pudieron leer las posiciones de la cuenta.</p>
        : !positionsReadAt ? <p className="rs-empty">Sin lectura de posiciones disponible.</p>
        : rows.length === 0 ? <p className="rs-empty">Sin posiciones en la última lectura.</p>
        : <div className="rs-table-scroll"><table className="rs-table">
          <thead><tr><th>Ticker</th><th className="num">Cantidad</th><th>Estructura</th><th>Estrategia</th><th className="num">P&amp;L total</th><th className="num">P&amp;L %</th><th>Venc.</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}>
            <td><b title={r.id}>{r.ticker}</b></td><td className="num">{r.short ? '−' : ''}{r.quantity} <span>{r.unit}</span></td>
            <td><span className="rs-structure">{r.structure}</span></td><td title="La cuenta no informa una estrategia vinculada">—</td>
            <td className={'num ' + (r.pnl === null || r.pnl === 0 ? '' : r.pnl > 0 ? 'pos' : 'neg')}>{money(r.pnl)}</td>
            <td className={'num ' + (r.pct === null || r.pct === 0 ? '' : r.pct > 0 ? 'pos' : 'neg')}>{r.pct === null ? '—' : fmtPct(r.pct)}</td>
            <td>{r.expiry ? <span className={'rs-expiry ' + (daysTo(r.expiry) <= 2 ? 'danger' : daysTo(r.expiry) <= 7 ? 'warning' : '')}>{new Date(`${r.expiry}T12:00:00`).toLocaleDateString('es-AR')} · {daysTo(r.expiry) < 0 ? 'vencida' : daysTo(r.expiry) === 0 ? 'hoy' : `${daysTo(r.expiry)} d`}</span> : '—'}</td>
          </tr>)}</tbody>
        </table></div>}
      <p className="rs-caption">P&amp;L abierto a precios informados · % sobre débito o crédito neto inicial</p>
    </section>
  </div>;
}
