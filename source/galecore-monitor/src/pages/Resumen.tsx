import React, { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import apiClient from '../api/client';
import { AccountSummary } from '../components/account/AccountSummary';
import { useAccountStore } from '../store/useAccountStore';
import { fmtPrice, fmtTime } from '../utils/formatters';
import type { Tab } from '../components/layout/TabNav';
import './Resumen.css';

/** Cuenta del operador y calendario real de GaleCore. */

const LONG = 45_000;

interface CalEvent { date: string; name: string; expiry?: boolean }
const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return { n: d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
    w: d.toLocaleDateString('es-AR', { weekday: 'short' }) };
};
const daysTo = (iso: string) => Math.round((new Date(`${iso}T12:00:00`).getTime() - Date.now()) / 86_400_000);

let calendarCache: { at: number; events: CalEvent[] } | null = null;
async function readCalendar(): Promise<CalEvent[]> {
  if (calendarCache && Date.now() - calendarCache.at < 600_000) return calendarCache.events;
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
  const [rel, fomc] = await Promise.all([
    apiClient.get('/Data/Fred/ReleaseDates', { params: { From: today, To: end, ReleaseIds: '50,10,46,53,54,9' }, timeout: LONG }),
    apiClient.get('/Data/Fed/FomcMeetings', { params: { Years: `${today.slice(0, 4)},${end.slice(0, 4)}` }, timeout: LONG }),
  ]);
  const r = ((rel.data?.data ?? []) as { date: string; releaseName: string }[]).map((x) => ({ date: x.date, name: x.releaseName }));
  const f = ((fomc.data?.data ?? []) as { end?: string }[]).filter((m) => m.end && m.end >= today)
    .map((m) => ({ date: m.end as string, name: 'Decisión de la Fed' }));
  const events = [...r, ...f].sort((a, b) => a.date.localeCompare(b.date));
  calendarCache = { at: Date.now(), events };
  return events;
}

const NAMES: Record<string, string> = {
  'Consumer Price Index': 'Inflación (CPI)', 'Producer Price Index': 'Precios al productor (PPI)',
  'Advance Monthly Sales for Retail and Food Services': 'Ventas minoristas', 'Gross Domestic Product': 'PIB',
  'Personal Income and Outlays': 'Gasto personal (PCE)', 'Employment Situation': 'Empleo (NFP)',
};

/** Calendario macro real de GaleCore. Como página (`page`) ocupa el ancho; dentro del Resumen es una columna. */
export function Calendario({ page = false, extra = [] as CalEvent[] }: { page?: boolean; extra?: CalEvent[] }) {
  const [events, setEvents] = useState<CalEvent[] | null | undefined>(undefined);
  useEffect(() => { readCalendar().then(setEvents).catch(() => setEvents(null)); }, []);
  const all = [...(events ?? []), ...extra].sort((a, b) => a.date.localeCompare(b.date)).slice(0, page ? 30 : 7);
  return (
    <section className={'rs-panel' + (page ? ' rs-page' : '')}>
      <h2>Agenda</h2>
      {events === undefined && <p className="rs-empty">Cargando…</p>}
      {events === null && <p className="rs-empty rs-warn">No se pudo leer el calendario.</p>}
      {events !== undefined && all.length === 0 && <p className="rs-empty">Sin eventos en los próximos 45 días.</p>}
      <ul className="rs-agenda">
        {all.map((e, i) => {
          const d = dayLabel(e.date); const n = daysTo(e.date);
          return (
            <li key={e.date + e.name + i} className={e.expiry ? 'expiry' : ''}>
              <span className="rs-date"><b>{d.n}</b><i>{d.w}</i></span>
              <span className="rs-what">{e.expiry ? e.name : NAMES[e.name] ?? e.name}</span>
              <span className="rs-in">{n <= 0 ? 'hoy' : n === 1 ? 'mañana' : `${n} d`}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Resumen({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { positions, loadingPositions, errorPositions, positionsReadAt } = useAccountStore();
  return <div className="rs">
    <header className="rs-top"><span className="rs-sub">Cuenta real · Tastytrade</span></header>
    <AccountSummary layout="strip" />
    <div className="rs-body" style={{ marginTop: 14 }}>
      <section className="rs-panel">
        <div className="rs-head"><h2>Posiciones de la cuenta</h2><button className="rs-link" onClick={() => onNavigate('monitor')}>Ver cartera<ArrowUpRight size={15} /></button></div>
        {loadingPositions ? <p className="rs-empty">Leyendo posiciones…</p>
          : errorPositions ? <p className="rs-empty rs-warn" role="alert">No se pudieron leer las posiciones de la cuenta.</p>
          : !positionsReadAt ? <p className="rs-empty">Sin lectura de posiciones disponible.</p>
          : positions.length === 0 ? <p className="rs-empty">Sin posiciones en la última lectura.</p>
          : <div style={{ overflowX: 'auto' }}><table className="rs-table">
              <thead><tr><th>Instrumento</th><th className="num">Cantidad</th><th>Dirección</th><th className="num">Precio informado</th></tr></thead>
              <tbody>{positions.map((p, i) => <tr key={p.symbol + i}>
                <td><b>{p.underlyingSymbol || p.symbol}</b><span>{p.symbol}</span></td>
                <td className="num">{p.quantity}</td><td>{p.quantityDirection}</td>
                <td className="num">{Number.isFinite(p.closePrice) ? fmtPrice(p.closePrice) : '—'}</td>
              </tr>)}</tbody>
            </table></div>}
        {positionsReadAt && !errorPositions && <p className="rs-empty">Lectura {fmtTime(positionsReadAt)} ET</p>}
      </section>
      <aside className="rs-rail"><Calendario /></aside>
    </div>
  </div>;
}
