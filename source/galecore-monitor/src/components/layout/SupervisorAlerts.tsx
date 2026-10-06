import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSpace, saveSpaceItem, SpaceItem } from '../../api/space';

/**
 * Avisos del supervisor de SHADOW (WS-0007): está en todas las pestañas, suena cuando llega un aviso nuevo y deja
 * responderlo.
 *
 * GaleCore-AI publica la pieza `agent/supervisor` cada 5 minutos desde la PC donde corre. Trae los últimos avisos
 * con el motivo, el dato, la regla, la propuesta, las opciones y la decisión, si ya la hay. Todo viene calculado:
 * acá sólo se muestra. Responder escribe `responses[<aviso>]` en la pieza y GaleCore-AI lo guarda como decisión en
 * el proyecto de la estrategia en la próxima pasada. En SHADOW no ejecuta nada.
 */

interface Decision { choice: string; words: string; expected: string; review_by: string | null; at: string }
interface Alert {
  id: string; kind: string; strategy: string; strategy_ref: string | null; detected_at: string; motivo: string;
  dato: Record<string, string | number | null>; regla: string; propuesta: string; options: string[];
  decision: Decision | null;
}
interface Response { choice: string; words: string; expected: string; review_by: string | null; at: string }
interface Piece {
  alerts?: Alert[]; responses?: Record<string, Response>; response_errors?: Record<string, string>;
  last_run?: { at: string; result: string; failed: boolean }; state_detail?: string | null;
}

const KEY = 'supervisor';
const REFRESH_MS = 60_000;
const SEEN = 'galecore.supervisor.seen';

const KIND: Record<string, string> = {
  closed: 'Cierre de SHADOW', near_stop: 'Cerca del stop', no_price: 'Sin precio', risk_limit: 'Límite de riesgo',
};
const DATO: Record<string, string> = {
  exit_reason: 'Motivo de salida', entry_credit: 'Crédito', exit_debit: 'Débito de salida',
  realized_pnl_usd: 'Resultado (USD)', dte: 'DTE', exit_at: 'Salida', spread_value: 'Valor del spread',
  loss_multiple: 'Pérdida / crédito', unrealized_pnl_usd: 'P&L abierto (USD)', valued_at: 'Valuado',
  last_valued_at: 'Última valuación', problems: 'Problemas', max_risk_usd: 'Riesgo máximo (USD)',
  limit_usd: 'Límite (USD)',
};

function readSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN) || '[]')); } catch { return new Set(); }
}
function writeSeen(ids: Set<string>) {
  try { localStorage.setItem(SEEN, JSON.stringify(Array.from(ids).slice(-200))); } catch { /* sin storage: suena de nuevo */ }
}

/** Dos tonos cortos. Sin archivo de audio: Web Audio. Si el navegador lo bloquea, queda el aviso visual. */
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 660].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.start(t); o.stop(t + 0.21);
    });
    setTimeout(() => ctx.close(), 800);
  } catch { /* sin audio */ }
}

function when(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const muted: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)' };
const input: React.CSSProperties = {
  width: '100%', fontSize: 13, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-dark)',
  backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)',
};

function AlertCard({ alert, sent, error, onAnswer }: {
  alert: Alert; sent?: Response; error?: string; onAnswer: (r: Omit<Response, 'at'>) => Promise<void>;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [words, setWords] = useState('');
  const [expected, setExpected] = useState('');
  const [reviewBy, setReviewBy] = useState('');
  const [busy, setBusy] = useState(false);
  const done = alert.decision;

  return (
    <div style={{ borderTop: '1px solid var(--border-dark)', padding: '12px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--yellow-gc)' }}>{KIND[alert.kind] ?? alert.kind}</span>
        <span style={muted}>{when(alert.detected_at)}</span>
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-primary)', margin: '4px 0' }}>{alert.motivo}</div>
      <table style={{ fontSize: 12, borderCollapse: 'collapse', margin: '4px 0 6px' }}>
        <tbody>
          {Object.entries(alert.dato).filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
            <tr key={k}>
              <td style={{ color: 'var(--text-muted)', paddingRight: 12 }}>{DATO[k] ?? k}</td>
              <td style={{ color: 'var(--text-secondary)' }}>{k.endsWith('_at') ? when(String(v)) : String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={muted}>Regla: {alert.regla}</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>{alert.propuesta}</div>

      {done ? (
        <div style={{ fontSize: 13, color: 'var(--green)' }}>
          Decidido: <b>{done.choice}</b>{done.words && done.words !== done.choice ? ` — «${done.words}»` : ''}
          {done.review_by ? ` · revisar el ${done.review_by}` : ''}
        </div>
      ) : sent ? (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Respuesta enviada (<b>{sent.choice}</b>). Se guarda en el proyecto en la próxima pasada (hasta 5 min).
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {alert.options.map(o => (
              <button key={o} onClick={() => setChoice(o)}
                style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${choice === o ? 'var(--blue-gc)' : 'var(--border-dark)'}`,
                  color: choice === o ? 'var(--blue-gc)' : 'var(--text-secondary)', background: 'transparent' }}>
                {o}
              </button>
            ))}
          </div>
          {choice && (
            <div style={{ display: 'grid', gap: 6 }}>
              <input style={input} placeholder="Por qué (tus palabras)" value={words} onChange={e => setWords(e.target.value)} />
              <input style={input} placeholder="Qué esperás que pase" value={expected} onChange={e => setExpected(e.target.value)} />
              <label style={muted}>Revisar el
                <input type="date" style={{ ...input, width: 'auto', marginLeft: 8 }} value={reviewBy}
                  onChange={e => setReviewBy(e.target.value)} />
              </label>
              <button disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try { await onAnswer({ choice, words, expected, review_by: reviewBy || null }); } finally { setBusy(false); }
                }}
                style={{ justifySelf: 'start', fontSize: 13, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
                  border: '1px solid var(--blue-gc)', color: 'var(--blue-gc)', background: 'transparent' }}>
                {busy ? 'Guardando…' : 'Guardar decisión'}
              </button>
            </div>
          )}
        </>
      )}
      {error && <div style={{ fontSize: 12, color: 'var(--red-gc)', marginTop: 6 }}>No se guardó: {error}</div>}
    </div>
  );
}

export function SupervisorAlerts() {
  const [item, setItem] = useState<SpaceItem | null>(null);
  const [piece, setPiece] = useState<Piece>({});
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<string>>(readSeen());

  const load = useCallback(async () => {
    try {
      const { items } = await fetchSpace();
      const it = items.find(i => i.kind === 'agent' && i.key === KEY) ?? null;
      let p: Piece = {};
      try { p = it ? JSON.parse(it.content) : {}; } catch { p = {}; }
      setItem(it); setPiece(p); setError(null);
      const fresh = (p.alerts ?? []).filter(a => !a.decision && !seen.current.has(a.id));
      if (fresh.length) {
        chime(); setOpen(true);
        fresh.forEach(a => seen.current.add(a.id)); writeSeen(seen.current);
      }
    } catch {
      setError('No se pudieron leer los avisos.');
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const answer = async (alertId: string, r: Omit<Response, 'at'>) => {
    if (!item) return;
    // Se relee la pieza justo antes de escribir: GaleCore-AI pudo publicar otra mientras el trader escribía.
    const { items } = await fetchSpace();
    const latest = items.find(i => i.kind === 'agent' && i.key === KEY) ?? item;
    let current: Piece = {};
    try { current = JSON.parse(latest.content); } catch { current = piece; }
    const { response_errors: _drop, ...rest } = current;
    const responses = { ...(current.responses ?? {}), [alertId]: { ...r, at: new Date().toISOString() } };
    try {
      await saveSpaceItem('agent', KEY, {
        title: latest.title, format: 'json', visibility: latest.visibility,
        content: JSON.stringify({ ...rest, responses }),
      });
      await load();
    } catch {
      setError('No se pudo guardar la decisión. Probá de nuevo.');
    }
  };

  const alerts = piece.alerts ?? [];
  const pending = alerts.filter(a => !a.decision && !piece.responses?.[a.id]).length;
  const failed = !!piece.last_run?.failed;          // lo decide GaleCore-AI: la última revisión no leyó todo
  if (!item) return null;

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 50, maxWidth: 'calc(100vw - 32px)' }}>
      {open && (
        <div style={{ width: 420, maxWidth: '100%', maxHeight: '70vh', overflow: 'auto', marginBottom: 8,
          backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', borderRadius: 12,
          padding: '12px 16px', boxShadow: '0 8px 24px rgba(0,0,0,.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>Avisos de SHADOW</span>
            <button onClick={() => setOpen(false)} aria-label="Cerrar"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
          <div style={muted}>
            Última revisión: {when(piece.last_run?.at)}
            {failed ? ` · falló: ${piece.state_detail || piece.last_run?.result}` : ''}
          </div>
          {error && <div style={{ fontSize: 12, color: 'var(--red-gc)' }}>{error}</div>}
          {alerts.length === 0 && <div style={{ ...muted, padding: '12px 0' }}>Sin avisos.</div>}
          {alerts.map(a => (
            <AlertCard key={a.id} alert={a} sent={piece.responses?.[a.id]} error={piece.response_errors?.[a.id]}
              onAnswer={r => answer(a.id, r)} />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => setOpen(o => !o)}
          style={{ fontSize: 13, padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
            backgroundColor: 'var(--bg-secondary)',
            color: failed ? 'var(--red-gc)' : pending ? 'var(--yellow-gc)' : 'var(--text-secondary)',
            border: `1px solid ${failed ? 'var(--red-border)' : pending ? 'var(--yellow-border)' : 'var(--border-dark)'}` }}>
          {pending ? `${pending} aviso${pending > 1 ? 's' : ''} sin respuesta` : 'Avisos'}
          {failed ? ' · la última revisión falló' : ''}
        </button>
      </div>
    </div>
  );
}
