import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../api/client';
import { fetchSpace } from '../api/space';
import { fetchShadowMetrics, fetchShadowStatus } from '../api/shadow';
import { fetchQuote } from '../api/marketdata';
import { SectionTitle } from '../components/common/SectionTitle';
import { useTerminalStore } from '../store/useTerminalStore';
import type { ShadowInstance, SpecVersionMetrics } from '../types/shadow';
import type { QuoteResponse } from '../types/api';

/**
 * Hoy (P1-10a): lo primero que se mira. Qué pide una decisión, cómo están las estrategias SHADOW, qué datos macro
 * vienen y a qué precio está el mercado. Todo sale de la API o de las piezas que publica GaleCore-AI; el front
 * sólo muestra (sin sumas ni promedios). Cada bloque dice de cuándo es su dato y, si no pudo leerse, lo declara:
 * nunca se rellena con ejemplos. SHADOW es simulación: ninguna cifra de acá es dinero real.
 */

const SYMBOLS = ['SPY', 'QQQ', 'IWM'];
const REFRESH_MS = 60_000;

interface Alert { id: string; kind: string; strategy: string; motivo: string; detected_at: string;
  needs_decision: boolean; decision: unknown | null; propuesta: string }
interface Piece { alerts?: Alert[]; responses?: Record<string, unknown> }
interface CalEvent { date: string; name: string }

const muted: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)' };
const card: React.CSSProperties = { backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)',
  borderRadius: 8, padding: '12px 14px' };
const th: React.CSSProperties = { ...muted, textAlign: 'left', fontWeight: 500, padding: '4px 8px 4px 0' };
const td: React.CSSProperties = { fontSize: 13, color: 'var(--text-primary)', padding: '5px 8px 5px 0' };

function hhmm(iso?: string | null): string {
  if (!iso) return 'sin hora';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function day(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}
const usd = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('es-AR', { maximumFractionDigits: 2 })} USD`);

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
        {note && <span style={muted}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

const Failed = ({ what }: { what: string }) => <div style={{ ...muted, color: 'var(--yellow-gc)' }}>No se pudo leer {what}.</div>;

export function Hoy() {
  const startTerminal = useTerminalStore((t) => t.start);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [instances, setInstances] = useState<ShadowInstance[] | null>(null);
  const [metrics, setMetrics] = useState<SpecVersionMetrics[] | null>(null);
  const [switchOn, setSwitchOn] = useState<boolean | null>(null);
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [quotes, setQuotes] = useState<Record<string, QuoteResponse | null> | null>(null);
  const [readAt, setReadAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await Promise.all([
      fetchSpace().then(({ items }) => {
        const it = items.find((i) => i.kind === 'agent' && i.key === 'supervisor');
        const p: Piece = it ? JSON.parse(it.content) : {};
        setAlerts(p.alerts ?? []);
      }).catch(() => setAlerts(null)),
      fetchShadowStatus().then((s) => { setInstances(s.instances); setSwitchOn(s.switch.enabled); })
        .catch(() => { setInstances(null); setSwitchOn(null); }),
      fetchShadowMetrics().then(setMetrics).catch(() => setMetrics(null)),
      Promise.all([
        apiClient.get('/Data/Fred/ReleaseDates', { params: { From: today, To: end, ReleaseIds: '50,10,46,53,54,9' } }),
        apiClient.get('/Data/Fed/FomcMeetings', { params: { Years: `${today.slice(0, 4)},${end.slice(0, 4)}` } }),
      ]).then(([rel, fomc]) => {
        const r = ((rel.data?.data ?? []) as { date: string; releaseName: string }[]).map((x) => ({ date: x.date, name: x.releaseName }));
        const f = ((fomc.data?.data ?? []) as { end?: string }[]).filter((m) => m.end && m.end >= today)
          .map((m) => ({ date: m.end as string, name: 'Decisión del FOMC' }));
        setEvents([...r, ...f].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8));
      }).catch(() => setEvents(null)),
      Promise.all(SYMBOLS.map((s) => fetchQuote(s).then((q) => [s, q] as const).catch(() => [s, null] as const)))
        .then((rows) => setQuotes(Object.fromEntries(rows))),
    ]);
    setReadAt(new Date());
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const pending = (alerts ?? []).filter((a) => a.needs_decision && !a.decision);
  const info = (alerts ?? []).filter((a) => !(a.needs_decision && !a.decision)).slice(0, 5);
  const live = (instances ?? []).filter((i) => i.lifecycleState === 'RUNNING' || (metrics ?? []).some(
    (m) => m.specName === i.specName && m.positionsOpen > 0));
  const seenSpec = new Set<string>();

  return (
    <div style={{ padding: '16px 18px 40px', fontFamily: 'var(--font-sans)' }}>
      <SectionTitle title="Hoy" badge="lo que pide atención" style={{ marginBottom: 6 }} />
      <div style={{ ...muted, marginBottom: 14 }}>
        Leído {readAt ? readAt.toLocaleTimeString('es-AR') : '…'} · se actualiza cada minuto · SHADOW es simulación, no dinero real
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}>
        <Block title="Necesita tu decisión" note={alerts ? `${pending.length} pendiente(s)` : undefined}>
          {alerts === null && <Failed what="los avisos del supervisor" />}
          {alerts !== null && pending.length === 0 && <div style={muted}>Nada pendiente.</div>}
          {pending.map((a) => (
            <div key={a.id} style={{ padding: '6px 0', borderTop: '1px solid var(--border-dark)' }}>
              <div style={{ fontSize: 13, color: 'var(--yellow-gc)' }}>{a.motivo}</div>
              <div style={muted}>{a.strategy} · {hhmm(a.detected_at)}</div>
              <button onClick={() => startTerminal('galecore', `Analizá el aviso ${a.id} del supervisor de SHADOW («${a.motivo}»). El contexto lo arma, desde GaleCore-AI, \`python -B -m galecore_ai.adapters.cli supervise context ${a.id}\`.`)}
                style={{ marginTop: 4, fontSize: 12, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                  border: '1px solid var(--border-dark)', color: 'var(--text-secondary)', background: 'transparent' }}>
                Analizá este aviso
              </button>
            </div>
          ))}
          {info.length > 0 && <div style={{ ...muted, marginTop: 8 }}>Últimos avisos informativos</div>}
          {info.map((a) => (
            <div key={a.id} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0' }}>
              {a.motivo} <span style={muted}>· {hhmm(a.detected_at)}</span>
            </div>
          ))}
        </Block>

        <Block title="Estrategias SHADOW" note={switchOn === null ? undefined : `switch ${switchOn ? 'encendido' : 'apagado'}`}>
          {instances === null && <Failed what="el runtime SHADOW" />}
          {instances !== null && live.length === 0 && <div style={muted}>Ninguna instancia corriendo ni con posiciones abiertas.</div>}
          {live.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Estrategia</th><th style={th}>Estado</th><th style={th}>Abiertas</th><th style={th}>P&L abierto</th><th style={th}>P&L cerrado</th></tr></thead>
              <tbody>
                {live.filter((i) => !seenSpec.has(i.specName) && seenSpec.add(i.specName)).map((i) => {
                  const m = (metrics ?? []).filter((x) => x.specName === i.specName);
                  return (
                    <tr key={i.instanceId} style={{ borderTop: '1px solid var(--border-dark)' }}>
                      <td style={td}>{i.specName}</td>
                      <td style={{ ...td, color: i.lifecycleState === 'RUNNING' ? 'var(--green)' : 'var(--text-muted)' }}>{i.lifecycleState === 'RUNNING' ? 'corriendo' : 'detenida'}</td>
                      <td style={td}>{metrics ? m.map((x) => x.positionsOpen).join(' + ') || '0' : '—'}</td>
                      <td style={td}>{metrics ? m.map((x) => usd(x.unrealizedPnl)).join(' + ') : '—'}</td>
                      <td style={td}>{metrics ? m.map((x) => usd(x.realizedPnl)).join(' + ') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {metrics === null && instances !== null && <div style={{ ...muted, marginTop: 6 }}>Resultados no disponibles (el runtime no persiste métricas).</div>}
        </Block>

        <Block title="Datos que vienen" note="próximos 30 días · calendario de GaleCore">
          {events === null && <Failed what="el calendario macro" />}
          {events !== null && events.length === 0 && <div style={muted}>Sin datos macro en la ventana.</div>}
          {(events ?? []).map((e, i) => (
            <div key={`${e.date}${e.name}${i}`} style={{ display: 'flex', gap: 10, padding: '3px 0', fontSize: 13 }}>
              <span style={{ width: 90, color: 'var(--text-secondary)' }}>{day(e.date)}</span>
              <span style={{ color: 'var(--text-primary)' }}>{e.name}</span>
            </div>
          ))}
        </Block>

        <Block title="Mercado" note="bid / ask de Tastytrade">
          {quotes === null && <div style={muted}>Cargando…</div>}
          {quotes !== null && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Símbolo</th><th style={th}>Bid</th><th style={th}>Ask</th><th style={th}>Hora del dato</th></tr></thead>
              <tbody>
                {SYMBOLS.map((s) => {
                  const q = quotes[s];
                  return (
                    <tr key={s} style={{ borderTop: '1px solid var(--border-dark)' }}>
                      <td style={td}>{s}</td>
                      <td style={td}>{q ? q.bid : '—'}</td>
                      <td style={td}>{q ? q.ask : '—'}</td>
                      <td style={{ ...td, color: q ? 'var(--text-secondary)' : 'var(--yellow-gc)' }}>{q ? hhmm(q.timestamp) : 'no se pudo leer'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Block>
      </div>
    </div>
  );
}
