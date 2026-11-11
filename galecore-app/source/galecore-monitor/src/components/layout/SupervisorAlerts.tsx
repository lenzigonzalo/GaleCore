import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSpace, SpaceItem } from '../../api/space';
import { fetchStrikeAlerts, StrikeAlert } from '../../api/account';
import { AgentAlert, fetchAgentAlerts } from '../../api/agents';
import { allWatches, removeWatch, watchText, Watch } from '../../api/watches';

/**
 * Avisos del supervisor de SHADOW (WS-0007): está en todas las pestañas y suena cuando llega un aviso nuevo.
 *
 * GaleCore-AI publica la pieza `agent/supervisor` cada 5 minutos desde la PC donde corre, con los avisos de hoy ya
 * legibles: tipo, hora y un título que se entiende solo. Acá sólo se muestra. Desde el 15/10 (owner) no hay
 * explicación aparte, botones ni desplegable: las acciones se agregan cuando el uso las pida.
 */

type Category = 'eeuu' | 'empresa' | 'estrategia' | 'cuenta' | 'mercado' | 'strike' | 'agente';
interface Alert { id: string; kind: string; detected_at: string; motivo: string; decision: unknown; category?: Category; title?: string }
interface Piece { watches?: Watch[]; alerts?: Alert[]; last_run?: { at: string; result: string; failed: boolean }; state_detail?: string | null }

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
  strike: { label: 'Strike', color: '#f87171' },
  agente: { label: 'Agente', color: '#facc15' },
};

function readSeen(key = SEEN): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
}
function writeSeen(ids: Set<string>, key = SEEN) {
  try { localStorage.setItem(key, JSON.stringify(Array.from(ids).slice(-200))); } catch { /* sin storage: suena de nuevo */ }
}

const STRIKE_MS = 30_000;
const STRIKE_FAILURES = 3;
const STRIKE_SEEN = 'galecore.strike.seen';

/**
 * Aviso cerca del strike vendido (WS-0036): lo evalúa la API con la preferencia del usuario; acá se consulta cada 30 s
 * desde cualquier pestaña y suena una vez por posición, lado y día. Sin cuenta vinculada calla; con la API caída o posiciones sin vigilar, lo dice (`notice`).
 */
export function useStrikeAlerts(active: boolean, onNew?: () => void): { alerts: StrikeAlert[]; notice: string | null } {
  const [alerts, setAlerts] = useState<StrikeAlert[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const seen = new Set<string>(readSeen(STRIKE_SEEN));
    let failures = 0;
    const load = async () => {
      try {
        const { alerts: list, unevaluated } = await fetchStrikeAlerts();
        if (!alive) return;
        failures = 0;
        setNotice(unevaluated.length ? `Aviso de strike sin evaluar: ${unevaluated.join('; ')}.` : null);
        setAlerts(list);
        const fresh = list.filter(a => !seen.has(a.id));
        if (fresh.length) {
          chime(); onNewRef.current?.();
          fresh.forEach(a => seen.add(a.id)); writeSeen(seen, STRIKE_SEEN);
        }
      } catch (err: any) {
        if (!alive) return;
        // Sin cuenta vinculada (409) no hay nada que vigilar; con la API caída varias veces seguidas, se avisa que no se está evaluando.
        failures = err?.response?.status === 409 ? 0 : failures + 1;
        if (failures >= STRIKE_FAILURES) setNotice('Aviso de strike sin evaluar: la API no responde.');
        else if (failures === 0) setNotice(null);
      }
    };
    load();
    const id = setInterval(load, STRIKE_MS);
    return () => { alive = false; clearInterval(id); };
  }, [active]);
  return { alerts, notice };
}

const AGENT_SEEN = 'galecore.agents.seen';

/**
 * Avisos de los agentes (WS-0099 C): los deja la corrida de un agente con skill, una vez por cambio. La API los guarda
 * 30 días y entrega los de los últimos 7; acá se consultan cada minuto y suenan una vez por aviso.
 */
export function useAgentAlerts(active: boolean, onNew?: () => void): AgentAlert[] {
  const [alerts, setAlerts] = useState<AgentAlert[]>([]);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const seen = new Set<string>(readSeen(AGENT_SEEN));
    const load = async () => {
      try {
        const list = await fetchAgentAlerts();
        if (!alive) return;
        setAlerts(list);
        const fresh = list.filter(a => !seen.has(`${a.agent_key}:${a.id}`));
        if (fresh.length) {
          fresh.forEach(a => seen.add(`${a.agent_key}:${a.id}`)); writeSeen(seen, AGENT_SEEN);
          chime(); onNewRef.current?.();
        }
      } catch { /* sin avisos de agentes: la campana sigue con lo demás */ }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, [active]);
  return alerts;
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

/** Avisos armados (WS-0064 AC-6): todos los de la pieza, con × para borrar (se oculta al instante). Sin avisos, no se muestra. */
function ArmedWatches({ watches }: { watches: Watch[] }) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const remove = (id: string) => {
    setRemoved(prev => new Set(prev).add(id));
    removeWatch(id).catch(() => setRemoved(prev => { const n = new Set(prev); n.delete(id); return n; }));
  };
  const shown = watches.filter(w => !removed.has(w.id));
  if (!shown.length) return null;
  return <section className="armed-watches" aria-label="Avisos armados">
    <h3>Avisos armados</h3>
    {shown.map(w => <div key={w.id} className="armed-watch" title={w.words}>
      <span>{watchText(w)}</span>
      <button type="button" aria-label={`Borrar aviso ${watchText(w)}`} onClick={() => remove(w.id)}>×</button>
    </div>)}
  </section>;
}

export function SupervisorAlerts({ embedded = false, strike = [], strikeNotice = null, agents = [] }: { embedded?: boolean; strike?: StrikeAlert[]; strikeNotice?: string | null; agents?: AgentAlert[] }) {
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
  // Los del strike van primero: piden decidir ya (rolear o no). Se muestran mientras la API los siga viendo.
  const strikeCards: Alert[] = strike.map(a => ({ id: a.id, kind: 'watch', detected_at: new Date().toISOString(), motivo: a.title,
    decision: null, category: 'strike', title: a.title }));
  const noticeCard: Alert[] = strikeNotice ? [{ id: 'strike-notice', kind: 'watch', detected_at: new Date().toISOString(), motivo: strikeNotice,
    decision: null, category: 'strike', title: strikeNotice }] : [];
  const agentCards: Alert[] = agents.map(a => ({ id: `agent:${a.agent_key}:${a.id}`, kind: 'watch', detected_at: a.created_at, motivo: a.title,
    decision: null, category: 'agente', title: `${a.agent_key}: ${a.title}` }));
  const alerts = [...noticeCard, ...strikeCards, ...agentCards, ...(piece.alerts ?? []).filter(a => a.kind === 'watch')];
  // WS-0057 A (owner 21/10): una falla del sistema (p. ej. FRED caído) no es un aviso para el trader; se ve en
  // Configuración → Plataforma. Acá sólo la hora de la última revisión, discreta.
  const armed = allWatches(piece);
  const status = piece.last_run?.at ? <p className="alert-status">Revisado {when(piece.last_run.at)}</p> : null;
  const empty = <div className="alert-empty"><strong>{item ? 'Sin avisos de tu cuenta' : 'Todavía no hay avisos'}</strong>
    <span>{item ? 'Cuando una posición quede cerca de su strike o un evento la mueva fuerte, aparece acá.' : 'Se activan cuando tu PC publica la primera revisión.'}</span></div>;

  if (embedded) return <section className="supervisor-dock" aria-label="Avisos del supervisor">
    {loading ? <p role="status">Leyendo avisos…</p>
      : error ? <div role="alert"><p>{error}</p><button onClick={load}>Reintentar</button></div>
      : <>{status}{!alerts.length && empty}{alerts.map(a => <AlertCard key={a.id} alert={a} />)}<ArmedWatches watches={armed} /></>}
  </section>;
  if (!item) return null;

  return (
    <div style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 50, maxWidth: 'calc(100% - 32px)' }}>
      {open && (
        <div className="supervisor-dock" style={{ width: 420, maxWidth: '100%', maxHeight: 'calc(70 * var(--vh))', overflow: 'auto', marginBottom: 8,
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
          <ArmedWatches watches={armed} />
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => setOpen(o => !o)}
          style={{ fontSize: 13, padding: '8px 14px', borderRadius: 999, cursor: 'pointer', backgroundColor: 'var(--bg-secondary)',
            color: alerts.length ? 'var(--text-primary)' : 'var(--text-secondary)',
            border: `1px solid ${alerts.length ? 'var(--yellow-gc)' : 'var(--border-dark)'}` }}>
          {alerts.length ? `Avisos (${alerts.length})` : 'Avisos'}
        </button>
      </div>
    </div>
  );
}
