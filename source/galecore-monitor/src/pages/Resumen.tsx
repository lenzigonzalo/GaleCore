import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import apiClient from '../api/client';
import { fetchSpace } from '../api/space';
import { fetchShadowPositions, fetchShadowStatus } from '../api/shadow';
import { Exposure, fetchExposure, limitsFromProfile, ProfileLimits } from '../api/exposure';
import { useTerminalStore } from '../store/useTerminalStore';
import type { ShadowInstance, ShadowPosition } from '../types/shadow';
import type { Tab } from '../components/layout/TabNav';
import './Resumen.css';

/**
 * Resumen (Monitor): lo que importa hoy sobre lo que tenés abierto. Exposición, resultado, qué pide atención y qué
 * viene. Todo sale de la API de GaleCore o de lo que publica GaleCore-AI; el front sólo muestra. Lo que no se pudo
 * leer se dice en su lugar. Las cifras de estrategia son SHADOW (simulación) sobre el capital de referencia del perfil.
 */

const SYMBOLS = ['SPY', 'QQQ', 'IWM'];
const REFRESH_MS = 60_000;
const LONG = 45_000;

interface Alert { id: string; kind: string; position_id?: string; strategy: string; motivo: string; detected_at: string; needs_decision: boolean; decision: unknown | null }
interface CalEvent { date: string; name: string; expiry?: boolean }
interface Quote { bid: number; ask: number }
type Row = ShadowPosition & { spec: string };

const nf = (v: number, d = 0) => v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v: number, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), d);
const tone = (v: number) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const ET = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
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
  const startTerminal = useTerminalStore((t) => t.start);
  const [exposure, setExposure] = useState<Exposure | null | undefined>(undefined);
  const [profileMissing, setProfileMissing] = useState(false);
  const [rows, setRows] = useState<Row[] | null | undefined>(undefined);
  const [alerts, setAlerts] = useState<Alert[] | null | undefined>(undefined);
  const [quotes, setQuotes] = useState<Record<string, Quote | null> | undefined>(undefined);
  const [readAt, setReadAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    let limits: ProfileLimits | null = null;
    await fetchSpace().then(({ items }) => {
      const prof = items.find((i) => i.kind === 'profile');
      limits = prof ? limitsFromProfile(prof.content) : null;
      const sup = items.find((i) => i.kind === 'agent' && i.key === 'supervisor');
      setAlerts(sup ? (JSON.parse(sup.content).alerts ?? []) : []);
    }).catch(() => setAlerts(null));
    setProfileMissing(!limits);
    const tasks: Promise<unknown>[] = [
      Promise.all(SYMBOLS.map((s) => apiClient.get('/Data/Tastytrade/MarketData/Quote', { params: { Symbol: s }, timeout: LONG })
        .then((r) => { const q = r.data?.data?.[0]; return [s, q && typeof q.bidPrice === 'number' ? { bid: q.bidPrice, ask: q.askPrice } : null] as const; })
        .catch(() => [s, null] as const)))
        .then((r) => setQuotes(Object.fromEntries(r))),
      fetchShadowStatus().then(async (st) => {
        const open = await Promise.all(st.instances.filter((i: ShadowInstance) => i.lifecycleState === 'RUNNING' || i.lifecycleState === 'STOPPED')
          .map((i) => fetchShadowPositions(i.instanceId).then((p) => p.filter((x) => x.status === 'OPEN').map((x) => ({ ...x, spec: i.specName })))
            .catch(() => [] as Row[])));
        setRows(open.flat().sort((a, b) => (a.currentDte ?? 999) - (b.currentDte ?? 999)));
      }).catch(() => setRows(null)),
    ];
    if (limits) tasks.push(fetchExposure(limits).then(setExposure).catch(() => setExposure(null)));
    else setExposure(null);
    await Promise.all(tasks);
    setReadAt(new Date().toISOString());
  }, []);

  useEffect(() => { load(); const id = setInterval(load, REFRESH_MS); return () => clearInterval(id); }, [load]);

  // Un aviso sólo se muestra si su condición sigue siendo cierta con lo que se leyó ahora: el supervisor no cierra solo los viejos.
  const stillTrue = (a: Alert) => {
    const pos = (rows ?? []).find((r) => r.positionId === a.position_id);
    if (a.kind === 'no_price') return !!pos && (!pos.lastValuedAt || Date.now() - new Date(pos.lastValuedAt).getTime() > 10 * 60_000);
    if (a.kind === 'near_stop') return !!pos;
    if (a.kind === 'bet_limit') return !!exposure && exposure.bets.some((b) => b.maxRisk > exposure.limits.maxBetUsd);
    if (a.kind === 'watch') return Date.now() - new Date(a.detected_at).getTime() < 3 * 3_600_000;
    return true;
  };
  const attention = (alerts ?? [])
    .filter((a) => !a.decision && (a.needs_decision || ['near_stop', 'risk_limit', 'no_price', 'bet_limit', 'watch'].includes(a.kind)) && rows !== undefined && stillTrue(a))
    .sort((a, b) => Number(b.needs_decision) - Number(a.needs_decision) || b.detected_at.localeCompare(a.detected_at)).slice(0, 5);
  const expiries: CalEvent[] = Array.from(new Map((rows ?? []).flatMap((r) => {
    const exp = r.legs?.[0]?.expiration; return exp ? [[`${r.symbol}${exp}`, { date: String(exp).slice(0, 10), name: `Vence ${r.symbol}`, expiry: true }] as const] : [];
  })).values());
  const cap = exposure?.limits;

  return (
    <div className="rs">
      <header className="rs-top">
        <span className="rs-sub">SHADOW · capital de referencia {cap ? `${nf(cap.capital)} USD` : '—'}{readAt ? ` · leído ${ET(readAt)}` : ''}</span>
      </header>

      <section className="rs-kpis" aria-label="Cifras principales">
        {exposure === null || profileMissing ? (
          <p className="rs-empty rs-warn rs-wide">{profileMissing ? 'No se pudo leer el perfil (capital y límites).' : 'No se pudo leer la exposición.'}</p>
        ) : (
          <>
            <div className="rs-kpi"><span>Riesgo abierto</span><b>{exposure ? nf(exposure.openMaxRisk) : '—'}<small> USD</small></b>
              <em>{exposure ? `${nf(exposure.openRiskPctOfCapital, 1)} % del capital · tope ${nf(cap!.maxOpenRiskUsd)}` : ''}</em>
              {exposure && <i className="rs-bar"><u style={{ width: `${Math.min(100, exposure.openMaxRisk / cap!.maxOpenRiskUsd * 100)}%` }} /></i>}</div>
            <div className={'rs-kpi ' + (exposure ? tone(exposure.unrealizedPnl) : '')}><span>Resultado abierto</span><b>{exposure ? signed(exposure.unrealizedPnl, 1) : '—'}<small> USD</small></b>
              <em>{exposure ? `${exposure.positionsOpen} posiciones` : ''}</em></div>
            <div className="rs-kpi"><span>Disponible</span><b>{exposure ? nf(exposure.availableForNewRiskUsd) : '—'}<small> USD</small></b>
              <em>para riesgo nuevo</em></div>
            <div className="rs-kpi rs-market"><span>Mercado</span>
              <div>{SYMBOLS.map((s) => (<p key={s}><strong>{s}</strong>{quotes?.[s] ? <b>{nf(quotes[s]!.bid, 2)}</b> : <b className="rs-warn">—</b>}</p>))}</div></div>
          </>
        )}
      </section>

      {attention.length > 0 && (
        <section className="rs-attention" aria-label="Requiere atención">
          {attention.map((a) => (
            <div key={a.id} className={'rs-alert' + (a.needs_decision ? ' decide' : '')}>
              <span className="rs-alert-text">{a.motivo}</span>
              <button onClick={() => startTerminal('galecore', `Analizá el aviso ${a.id} del supervisor de SHADOW («${a.motivo}»). El contexto lo arma, desde GaleCore-AI, \`python -B -m galecore_ai.adapters.cli supervise context ${a.id}\`.`)}>Analizar</button>
            </div>
          ))}
        </section>
      )}
      {alerts === null && <p className="rs-empty rs-warn">No se pudieron leer los avisos del supervisor.</p>}

      <div className="rs-body">
        <div className="rs-main">
          <section className="rs-panel">
            <div className="rs-head"><h2>Posiciones abiertas</h2><button className="rs-link" onClick={() => onNavigate('monitor')}>Ver cartera<ArrowUpRight size={15} /></button></div>
            {rows === undefined && <p className="rs-empty">Cargando…</p>}
            {rows === null && <p className="rs-empty rs-warn">No se pudo leer el runtime SHADOW.</p>}
            {rows && rows.length === 0 && <p className="rs-empty">Sin posiciones abiertas.</p>}
            {rows && rows.length > 0 && (
              <table className="rs-table">
                <thead><tr><th>Posición</th><th className="num">DTE</th><th className="num">Resultado</th><th className="num">Riesgo máx.</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const strikes = (r.legs ?? []).map((l) => l.strike).join(' / ');
                    return (
                      <tr key={r.positionId}>
                        <td><b>{r.symbol}</b><span>{r.structure.replace(/_/g, ' ')} · {strikes}</span></td>
                        <td className={'num big' + ((r.currentDte ?? 99) <= 21 ? ' neg' : '')}>{r.currentDte ?? '—'}</td>
                        <td className={'num big ' + tone(r.unrealizedPnl ?? 0)}>{r.unrealizedPnl == null ? '—' : signed(r.unrealizedPnl, 1)}</td>
                        <td className="num">{nf(r.maxRisk)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {exposure && cap && exposure.bets.length > 0 && (
            <section className="rs-panel">
              <h2>Concentración</h2>
              <ul className="rs-bets">
                {exposure.bets.map((b) => {
                  const over = b.maxRisk > cap.maxBetUsd;
                  return (
                    <li key={b.key}>
                      <span className="rs-bet-name">{b.symbol} {b.direction === 'bullish' ? 'alcista' : b.direction === 'bearish' ? 'bajista' : 'neutral'}<i>{b.positions} pos. · vence {b.expirations[0]?.slice(5).split('-').reverse().join('/')}</i></span>
                      <span className="rs-bet-bar"><u className={over ? 'over' : ''} style={{ width: `${Math.min(100, b.maxRisk / cap.maxBetUsd * 100)}%` }} /></span>
                      <span className={'rs-bet-val' + (over ? ' neg' : '')}>{nf(b.maxRisk)}<small> / {nf(cap.maxBetUsd)}</small></span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
        <aside className="rs-rail"><Calendario extra={expiries} /></aside>
      </div>
    </div>
  );
}
