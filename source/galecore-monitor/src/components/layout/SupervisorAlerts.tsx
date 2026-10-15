import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSpace, SpaceItem } from '../../api/space';

/**
 * Avisos del supervisor de SHADOW (WS-0007): está en todas las pestañas y suena cuando llega un aviso nuevo.
 *
 * GaleCore-AI publica la pieza `agent/supervisor` cada 5 minutos desde la PC donde corre, con los avisos de hoy ya
 * legibles: tipo, hora y un título que se entiende solo. Acá sólo se muestra. Desde el 15/10 (owner) no hay
 * explicación aparte, botones ni desplegable: las acciones se agregan cuando el uso las pida.
 */

type Category = 'eeuu' | 'empresa' | 'estrategia' | 'cuenta' | 'mercado';
interface Alert { id: string; kind: string; detected_at: string; motivo: string; decision: unknown; category?: Category; title?: string }
interface Piece { alerts?: Alert[]; last_run?: { at: string; result: string; failed: boolean }; state_detail?: string | null }

const KEY = 'supervisor';
const REFRESH_MS = 60_000;
const SEEN = 'galecore.supervisor.seen';

/** Color y rótulo por tipo, para leer el aviso en un segundo (WS-0036). */
const CATEGORY: Record<Category, { label: string; color: string }> = {
  eeuu: { label: 'EE. UU.', color: '#60a5fa' },
  empresa: { label: 'Empresa', color: '#c084fc' },
  estrategia: { label: 'Estrategia', color: '#34d399' },
  cuenta: { label: 'Cuenta', color: '#fb923c' },
  mercado: { label: 'Mercado', color: '#22d3ee' },
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

/** «jue 15/10, 11:21», como en Agentes. */
function when(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '');
  const date = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${day} ${date}, ${time}`;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function UsFlag() {
  return <svg width="16" height="11" viewBox="0 0 16 11" aria-hidden="true" style={{ borderRadius: 2, flex: '0 0 16px' }}>
    {[0, 2, 4, 6, 8, 10].map(y => <rect key={y} x="0" y={y} width="16" height="1" fill="#e5484d" />)}
    {[1, 3, 5, 7, 9].map(y => <rect key={y} x="0" y={y} width="16" height="1" fill="#f5f5f5" />)}
    <rect x="0" y="0" width="7" height="6" fill="#3b5bdb" />
  </svg>;
}

function CategoryTag({ category }: { category?: Category }) {
  const c = CATEGORY[category ?? 'estrategia'] ?? CATEGORY.estrategia;
  return <span className="alert-category" style={{ color: c.color }}>
    {category === 'eeuu' ? <UsFlag /> : <i style={{ background: c.color }} />}{c.label}
  </span>;
}

/** Un aviso: tipo y hora arriba, el título abajo. Nada más. */
function AlertCard({ alert }: { alert: Alert }) {
  return (
    <div className="alert-card">
      <div className="alert-meta"><CategoryTag category={alert.category} /><span>{hhmm(alert.detected_at)}</span></div>
      <div className="alert-title">{alert.title || alert.motivo}</div>
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
      const fresh = (p.alerts ?? []).filter(a => a.kind === 'watch' && !a.decision && !seen.current.has(a.id));  // todo aviso nuevo suena una vez
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

  // La campana es de la cartera real (owner 15/10): lo de SHADOW va por su camino (Estrategias), no acá.
  const alerts = (piece.alerts ?? []).filter(a => a.kind === 'watch');
  const failed = !!piece.last_run?.failed;          // lo decide GaleCore-AI: la última revisión no leyó todo
  const status = <p className="alert-status">Última revisión: {when(piece.last_run?.at)}
    {failed ? ` · falló: ${piece.state_detail || piece.last_run?.result}` : ''}</p>;
  const empty = <p className="alert-status">{item ? 'Sin avisos hoy.' : 'Todavía no hay avisos del supervisor en tu espacio.'}</p>;

  if (embedded) return <section className="supervisor-dock" aria-label="Avisos del supervisor">
    {loading ? <p role="status">Leyendo avisos…</p>
      : error ? <div role="alert"><p>{error}</p><button onClick={load}>Reintentar</button></div>
      : <>{status}{!alerts.length && empty}{alerts.map(a => <AlertCard key={a.id} alert={a} />)}</>}
  </section>;
  if (!item) return null;

  return (
    <div style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 50, maxWidth: 'calc(100% - 32px)' }}>
      {open && (
        <div className="supervisor-dock" style={{ width: 420, maxWidth: '100%', maxHeight: '70vh', overflow: 'auto', marginBottom: 8,
          backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>Avisos</span>
            <button onClick={() => setOpen(false)} aria-label="Cerrar"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
          {status}
          {error && <p style={{ color: 'var(--red-gc)' }}>{error}</p>}
          {!alerts.length && empty}
          {alerts.map(a => <AlertCard key={a.id} alert={a} />)}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => setOpen(o => !o)}
          style={{ fontSize: 13, padding: '8px 14px', borderRadius: 999, cursor: 'pointer', backgroundColor: 'var(--bg-secondary)',
            color: failed ? 'var(--red-gc)' : 'var(--text-secondary)',
            border: `1px solid ${failed ? 'var(--red-border)' : 'var(--border-dark)'}` }}>
          {alerts.length ? `Avisos (${alerts.length})` : 'Avisos'}{failed ? ' · la última revisión falló' : ''}
        </button>
      </div>
    </div>
  );
}
