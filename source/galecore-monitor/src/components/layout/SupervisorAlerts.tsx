import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSpace, saveSpaceItem, SpaceItem } from '../../api/space';
import { useTerminalStore } from '../../store/useTerminalStore';

/**
 * Avisos del supervisor de SHADOW (WS-0007): está en todas las pestañas, suena cuando llega un aviso nuevo y deja
 * responderlo.
 *
 * GaleCore-AI publica la pieza `agent/supervisor` cada 5 minutos desde la PC donde corre. Trae los últimos avisos
 * con el motivo, el dato, la regla, la propuesta, las opciones y la decisión, si ya la hay. Todo viene calculado:
 * acá sólo se muestra. Lo informativo es una línea (el detalle, con un click); sólo lo que pide decisión trae
 * botones, sin campos de texto (owner 06/10). Responder escribe `responses[<aviso>]` en la pieza y GaleCore-AI lo guarda como decisión en
 * el proyecto de la estrategia en la próxima pasada. En SHADOW no ejecuta nada.
 *
 * «Analizá este aviso» (U-70, P1-01c) abre Claude Code en el panel de la derecha con el pedido ya enviado: se sigue
 * por chat, sin esperar a la próxima pasada. La sesión arma el contexto con `supervise context <aviso>`. Los análisis
 * que dejó la corrida en segundo plano de WS-0008 (`analyses[<aviso>]`) se siguen mostrando.
 */

interface Decision { choice: string; words: string; expected: string; review_by: string | null; at: string }
interface Alert {
  id: string; kind: string; strategy: string; strategy_ref: string | null; detected_at: string; motivo: string;
  dato: Record<string, string | number | null>; regla: string; propuesta: string; options: string[];
  needs_decision: boolean; decision: Decision | null;
}
interface Response { choice: string; words: string; expected: string; review_by: string | null; at: string }
interface Analysis {
  status: 'running' | 'done' | 'failed'; at: string; summary?: string; detail?: string; missing?: string[];
  model?: string | null; tokens?: { output?: number } | null; duration_s?: number | null; error?: string | null;
}
interface Piece {
  alerts?: Alert[]; responses?: Record<string, Response>; response_errors?: Record<string, string>;
  analyses?: Record<string, Analysis>;
  last_run?: { at: string; result: string; failed: boolean }; state_detail?: string | null;
}

const KEY = 'supervisor';
const REFRESH_MS = 60_000;
const SEEN = 'galecore.supervisor.seen';

const DATO: Record<string, string> = {
  exit_reason: 'Motivo de salida', entry_credit: 'Crédito', exit_debit: 'Débito de salida',
  realized_pnl_usd: 'Resultado (USD)', dte: 'DTE', exit_at: 'Salida', spread_value: 'Valor del spread',
  loss_multiple: 'Pérdida / crédito', unrealized_pnl_usd: 'P&L abierto (USD)', valued_at: 'Valuado',
  last_valued_at: 'Última valuación', problems: 'Problemas', max_risk_usd: 'Riesgo máximo (USD)',
  limit_usd: 'Límite (USD)', event: 'Dato', event_date: 'Fecha', business_days: 'Días hábiles',
  symbol: 'Símbolo', metric: 'Medida', value: 'Valor', threshold: 'Umbral', condition: 'Condición',
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
const chip: React.CSSProperties = { fontSize: 12, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
  border: '1px solid var(--border-dark)', color: 'var(--text-secondary)', background: 'transparent' };

/** Un análisis anterior (corrida en segundo plano de WS-0008), tal cual. Una línea; el detalle, con un click. */
function AnalysisView({ analysis }: { analysis: Analysis }) {
  const [more, setMore] = useState(false);
  const meta = [analysis.model, analysis.tokens?.output != null ? `${analysis.tokens.output} tokens` : null,
    analysis.duration_s != null ? `${analysis.duration_s} s` : null].filter(Boolean).join(' · ');
  return (
    <div style={{ marginTop: 6, paddingLeft: 8, borderLeft: '2px solid var(--border-dark)' }}>
      <div onClick={() => setMore(m => !m)} style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
        {analysis.summary}
      </div>
      {more && (
        <div style={{ ...muted, whiteSpace: 'pre-wrap', marginTop: 4 }}>
          {analysis.detail}
          {analysis.missing && analysis.missing.length > 0 && <div>Faltó: {analysis.missing.join('; ')}</div>}
        </div>
      )}
      <div style={{ ...muted, fontSize: 11, marginTop: 2 }}>Análisis {when(analysis.at)}{meta ? ` · ${meta}` : ''}</div>
    </div>
  );
}

/** El pedido que recibe Claude Code: el aviso y de dónde sale su contexto. */
function analysisPrompt(alert: Alert): string {
  return `Analizá el aviso ${alert.id} del supervisor de SHADOW («${alert.motivo}»). `
    + `El contexto (aviso, posición, reglas de la estrategia, números de hoy) lo arma, desde GaleCore-AI, \`python -B -m galecore_ai.adapters.cli supervise context ${alert.id}\`.`;
}

/** Una línea: qué pasó. Click: el detalle. Sólo lo que pide decisión trae botones (un click, sin texto). */
function AlertCard({ alert, sent, error, analysis, onAnswer }: {
  alert: Alert; sent?: Response; error?: string; analysis?: Analysis;
  onAnswer: (r: Omit<Response, 'at'>) => Promise<void>;
}) {
  const startTerminal = useTerminalStore(t => t.start);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const done = alert.decision;
  const ask = alert.needs_decision && !done && !sent;

  return (
    <div style={{ borderTop: '1px solid var(--border-dark)', padding: '8px 0' }}>
      <div onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, color: ask ? 'var(--yellow-gc)' : 'var(--text-primary)', flex: 1 }}>{alert.motivo}</span>
        <span style={muted}>{when(alert.detected_at)}</span>
      </div>
      {open && (
        <div style={{ ...muted, margin: '4px 0' }}>
          {Object.entries(alert.dato).filter(([, v]) => v !== null && v !== '')
            .map(([k, v]) => `${DATO[k] ?? k}: ${k.endsWith('_at') ? when(String(v)) : String(v)}`).join(' · ')}
          <div>Regla: {alert.regla}</div>
        </div>
      )}
      {analysis?.status === 'done' && <AnalysisView analysis={analysis} />}
      {open && (
        <div style={{ marginTop: 6 }}>
          <button onClick={e => { e.stopPropagation(); startTerminal('galecore', analysisPrompt(alert)); }} style={chip}
            title="Abre Claude Code a la derecha con el pedido enviado">
            Analizá este aviso
          </button>
        </div>
      )}
      {ask && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {alert.options.map(o => (
            <button key={o} disabled={busy}
              onClick={async () => {
                setBusy(true);
                try { await onAnswer({ choice: o, words: '', expected: '', review_by: null }); } finally { setBusy(false); }
              }}
              style={chip}>
              {o}
            </button>
          ))}
        </div>
      )}
      {alert.needs_decision && (done || sent) && (
        <div style={{ ...muted, marginTop: 4 }}>
          {done ? `Decidido: ${done.choice}` : `Enviado: ${sent!.choice} (se guarda en ≤ 5 min)`}
        </div>
      )}
      {error && <div style={{ fontSize: 12, color: 'var(--red-gc)', marginTop: 4 }}>No se guardó: {error}</div>}
    </div>
  );
}

export function SupervisorAlerts({ embedded = false }: { embedded?: boolean }) {
  const [loading, setLoading] = useState(true);
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
      const fresh = (p.alerts ?? []).filter(a => !a.decision && !seen.current.has(a.id));  // todo aviso nuevo suena una vez
      if (fresh.length) {
        chime(); setOpen(true);
        fresh.forEach(a => seen.current.add(a.id)); writeSeen(seen.current);
      }
    } catch {
      setError('No se pudieron leer los avisos.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  /** Se relee la pieza justo antes de escribir: GaleCore-AI pudo publicar otra mientras el trader miraba. */
  const write = async (change: (current: Piece) => Piece, failure: string) => {
    if (!item) return;
    try {
      const { items } = await fetchSpace();
      const latest = items.find(i => i.kind === 'agent' && i.key === KEY) ?? item;
      let current: Piece = {};
      try { current = JSON.parse(latest.content); } catch { current = piece; }
      await saveSpaceItem('agent', KEY, {
        title: latest.title, format: 'json', visibility: latest.visibility, content: JSON.stringify(change(current)),
      });
      await load();
    } catch {
      setError(failure);
    }
  };

  const answer = (alertId: string, r: Omit<Response, 'at'>) => write(current => {
    const { response_errors: _drop, ...rest } = current;
    return { ...rest, responses: { ...(current.responses ?? {}), [alertId]: { ...r, at: new Date().toISOString() } } };
  }, 'No se pudo guardar la decisión. Probá de nuevo.');

  const alerts = piece.alerts ?? [];
  const pending = alerts.filter(a => a.needs_decision && !a.decision && !piece.responses?.[a.id]).length;
  const failed = !!piece.last_run?.failed;          // lo decide GaleCore-AI: la última revisión no leyó todo
  if (embedded) return <section className="supervisor-dock" aria-label="Avisos del supervisor">
    {loading ? <p role="status">Leyendo avisos…</p> : error ? <div role="alert"><p>{error}</p><button onClick={load}>Reintentar</button></div> : <><p>Última revisión: {when(piece.last_run?.at)}{failed ? ` · falló: ${piece.state_detail || piece.last_run?.result}` : ''}</p>{!alerts.length && <p>{item ? 'Sin avisos.' : 'Todavía no hay avisos del supervisor en tu espacio.'}</p>}{alerts.map(alert => <AlertCard key={alert.id} alert={alert} sent={piece.responses?.[alert.id]} error={piece.response_errors?.[alert.id]} analysis={piece.analyses?.[alert.id]} onAnswer={response => answer(alert.id, response)}/>)}</>}
  </section>;
  if (!item) return null;

  return (
    <div style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 50, maxWidth: 'calc(100% - 32px)' }}>
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
              analysis={piece.analyses?.[a.id]} onAnswer={r => answer(a.id, r)} />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => setOpen(o => !o)}
          style={{ fontSize: 13, padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
            backgroundColor: 'var(--bg-secondary)',
            color: failed ? 'var(--red-gc)' : pending ? 'var(--yellow-gc)' : 'var(--text-secondary)',
            border: `1px solid ${failed ? 'var(--red-border)' : pending ? 'var(--yellow-border)' : 'var(--border-dark)'}` }}>
          {pending ? `${pending} para decidir` : 'Avisos'}
          {failed ? ' · la última revisión falló' : ''}
        </button>
      </div>
    </div>
  );
}
