import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Bot, ChevronDown, ChevronRight, Clock3, Copy, Eye, Plus, Radar, Sun, X, Zap } from 'lucide-react';
import './Agentes.css';
import { Markdown } from '../components/settings/Markdown';
import { fetchSpace, saveSpaceItem, SpaceItem } from '../api/space';

/**
 * Agentes (GC-0009): lo que corre solo con las instrucciones del trader — si está prendido, si su último
 * resultado está al día, cuándo corrió, qué encontró — y el botón para prenderlo o apagarlo.
 *
 * Los datos son las piezas `agent` del espacio del trader, que GaleCore-AI publica desde la PC donde corren
 * (cada 5 minutos y después de cada cambio). El monitor no llega a esa PC: prender o apagar escribe un pedido
 * en la pieza (`request`) y GaleCore-AI lo aplica en la próxima pasada. Hasta entonces se muestra como pedido.
 */

interface LastRun {
  at: string; result: string; invoked_by?: string; duration_s?: number; model?: string;
  reason?: string; error?: string; failed: boolean;
}
interface Agent {
  id: string; capability: string; status: 'active' | 'paused' | 'cancelled'; schedule: string;
  strategy?: string | null; objective: string; state: string; state_detail?: string;
  next_expected_at?: string | null; last_run?: LastRun | null; runs: number; findings?: string | null;
  result_ref?: string | null; request?: { status: 'active' | 'paused'; at?: string }; request_error?: string;
}

const REFRESH_MS = 60_000;

const WHAT: Record<string, string> = {
  supervisor: 'Supervisor de SHADOW', market_watch: 'Vigila el mercado', daily_attention: 'Briefing diario', strategy_followup: 'Seguimiento de estrategia',
};

// Estado del último resultado (freshness de GaleCore-AI) en palabras del trader.
const STATE: Record<string, { label: string; color: string; border: string }> = {
  CURRENT:      { label: 'Al día',              color: 'var(--green)',      border: 'var(--green-border)' },
  NOT_DUE_YET:  { label: 'Todavía no le tocó',  color: 'var(--text-muted)', border: 'var(--border-dark)' },
  DUE_NOW:      { label: 'Le toca ahora',       color: 'var(--text-secondary)', border: 'var(--border-dark)' },
  RUNNING:      { label: 'Corriendo',           color: 'var(--blue-gc)',    border: 'var(--blue-gc)' },
  MISSED:       { label: 'Se saltó una corrida', color: 'var(--yellow-gc)', border: 'var(--yellow-border)' },
  FAILED:       { label: 'Falló la última',     color: 'var(--red-gc)',     border: 'var(--red-border)' },
  PAUSED:       { label: 'Pausado',             color: 'var(--yellow-gc)',  border: 'var(--yellow-border)' },
};

// Qué significa un estado que pide atención (el detalle técnico queda en GaleCore-AI: `task status`).
const STATE_HELP: Record<string, string> = {
  MISSED: 'No corrió a la hora prevista (la PC estaba apagada o sin sesión iniciada): lo que ves es de la corrida anterior.',
  FAILED: 'La última corrida programada falló: lo que ves es el último resultado bueno.',
  DUE_NOW: 'Le tocaba hace poco y todavía no arrancó.',
};

const muted: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted)' };

const parse = (s: string): Agent | null => { try { return JSON.parse(s); } catch { return null; } };

function when(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function Pill({ text, color, border }: { text: string; color: string; border: string }) {
  return (
    <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 999, whiteSpace: 'nowrap', color, border: `1px solid ${border}` }}>
      {text}
    </span>
  );
}

// Margen para que una corrida programada arranque y se publique (GaleCore-AI publica cada 5 min).
const SILENCE_MS = 40 * 60_000;

/**
 * El estado lo calcula la PC al publicar: con la PC apagada no se publica nada y lo guardado se vuelve viejo
 * (un «Al día» del viernes sigue ahí el lunes). Si ya pasó la próxima corrida esperada y no llegó nada nuevo,
 * se dice eso en vez del estado guardado.
 */
function silent(a: Agent): boolean {
  if (a.status !== 'active' || !a.next_expected_at) return false;
  const next = new Date(a.next_expected_at).getTime();
  return !Number.isNaN(next) && Date.now() > next + SILENCE_MS;
}

function StatePill({ a }: { a: Agent }) {
  if (silent(a)) return <Pill text="Sin noticias de tu PC" color="var(--yellow-gc)" border="var(--yellow-border)" />;
  const s = STATE[a.state] ?? { label: a.state, color: 'var(--text-muted)', border: 'var(--border-dark)' };
  return <Pill text={s.label} color={s.color} border={s.border} />;
}

/** El botón de prender/apagar, o el pedido que espera aplicarse en la PC. */
function Toggle({ a, onRequest, busy }: { a: Agent; onRequest: (status: 'active' | 'paused') => void; busy: boolean }) {
  if (a.status === 'cancelled') return <span style={muted}>Cancelado</span>;
  // El supervisor (WS-0007) corre con la publicación de cada 5 minutos: no es una tarea que se prenda o apague.
  if (a.capability === 'supervisor') return <span style={muted}>Siempre activo</span>;
  const pending = a.request && a.request.status !== a.status ? a.request.status : null;
  if (pending) {
    return (
      <span style={{ ...muted, color: 'var(--text-secondary)' }}>
        {pending === 'active' ? 'Prendiendo…' : 'Apagando…'}
      </span>
    );
  }
  const on = a.status === 'active';
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={on ? 'Pausar tarea' : 'Activar tarea'}
      className="agents-toggle" disabled={busy}
      onClick={() => onRequest(on ? 'paused' : 'active')}>
      <span>{on ? 'Activa' : 'En pausa'}</span><i aria-hidden="true"><span /></i>
    </button>
  );
}

const TEMPLATES = [
  { name: 'Briefing diario', Icon: Sun, description: 'Un resumen de lo que necesita tu atención antes de empezar.', frequency: 'Frecuencia a definir', prompt: 'Quiero preparar un briefing de mi cuenta y mis estrategias. Ayudame a definir qué necesita mi atención, las fuentes, el horario y el costo antes de programarlo.' },
  { name: 'Vigilancia del mercado', Icon: Radar, description: 'Seguí los símbolos y las condiciones de mercado que te interesan.', frequency: 'Por condición o frecuencia', prompt: 'Quiero preparar un agente que vigile el mercado. Ayudame a elegir símbolos, condiciones y fuentes de GaleCore, y a definir la frecuencia y el costo antes de programarlo.' },
  { name: 'Seguimiento de estrategia', Icon: Eye, description: 'Revisá cómo avanza una estrategia y qué requiere una decisión.', frequency: 'Frecuencia a definir', prompt: 'Quiero preparar un seguimiento de una estrategia. Ayudame a elegir la estrategia, qué cambios observar y cuándo avisarme, con fuentes y costo definidos antes de programarlo.' },
];

function AgentIcon({ capability }: { capability: string }) {
  const Icon = capability === 'daily_attention' ? Sun : capability === 'market_watch' ? Radar : capability === 'strategy_followup' ? Eye : Bot;
  return <span className="agents-icon"><Icon size={21} strokeWidth={1.5} /></span>;
}

function AgentDetail({ a, title, publishedAt, onRequest, busy, onBack }: {
  a: Agent; title: string; publishedAt: string; onRequest: (s: 'active' | 'paused') => void; busy: boolean; onBack: () => void;
}) {
  const last = a.last_run;
  const [showResult, setShowResult] = useState(true);
  return <>
    <div className="agents-breadcrumb"><button onClick={onBack}><ArrowLeft size={15} />Tareas programadas</button><span>/</span><span>{title}</span></div>
    <header className="agents-detail-heading"><div><h1>{title}</h1><p>{a.status === 'paused' ? 'Esta tarea está en pausa' : WHAT[a.capability] || a.capability}</p></div><Toggle a={a} busy={busy} onRequest={onRequest} /></header>
    {a.request && a.request.status !== a.status && <p className="agents-notice" role="status">El pedido se aplicará en tu PC en hasta 5 minutos; tiene que estar encendida.</p>}
    {a.request_error && <p className="agents-error" role="alert">No se pudo aplicar: {a.request_error}</p>}
    {silent(a) && <p className="agents-notice">Sin noticias de tu PC desde {when(publishedAt)}. La próxima corrida ya tendría que haber pasado; el resultado guardado es anterior.</p>}
    <div className="agents-detail-grid">
      <section className="agents-history"><h2>Historial</h2>
        {last ? <><button className="agents-run" aria-expanded={showResult} onClick={() => setShowResult(v => !v)}><Zap size={17} /><span><strong>{title}</strong><small>{when(last.at)} · {last.failed ? 'Falló' : last.result}</small></span><ChevronDown size={16} className={showResult ? 'expanded' : ''} /></button>
          {showResult && <div className="agents-result"><div className="agents-result-heading"><h3>Último resultado</h3><StatePill a={a} /></div>
            {(last.error || last.reason) && <p className={last.failed ? 'agents-error' : ''}>{last.error || last.reason}</p>}
            {STATE_HELP[a.state] && <p className="agents-secondary">{STATE_HELP[a.state]}</p>}
            {a.findings ? <Markdown text={a.findings} /> : <p className="agents-secondary">Todavía no hay un resultado guardado.</p>}
            <div className="agents-run-meta"><span>{last.invoked_by === 'scheduler' ? 'Programada' : last.invoked_by ? 'A mano' : 'Origen no informado'}</span>{last.duration_s != null && <span>{Math.round(last.duration_s)} s</span>}</div>
          </div>}</> : <p className="agents-empty">Esta tarea todavía no corrió.</p>}
        <p className="agents-history-note">{a.runs} corridas registradas. GaleCore publica únicamente la última corrida.</p>
      </section>
      <aside className="agents-settings">
        <section><h2>Instrucciones</h2><p>{a.objective || 'Sin instrucciones publicadas.'}</p></section>
        <section><h2>Frecuencia</h2><p><Clock3 size={16} />{a.schedule || 'Sin frecuencia publicada'}</p>{a.status === 'active' && !silent(a) && a.next_expected_at && <small>Próxima: {when(a.next_expected_at)}</small>}</section>
        <section><h2>Se ejecuta con</h2><p><Bot size={18} />GaleCore-AI · tu PC</p>{a.strategy && <p><Eye size={18} />{a.strategy}</p>}{last?.model && <p><Zap size={18} />{last.model}</p>}</section>
        <section><h2>Detalles</h2><StatePill a={a} /><small>Publicado {when(publishedAt)}</small>{a.result_ref && <small>Resultado: {a.result_ref}</small>}<small>Identificador: {a.id}</small></section>
      </aside>
    </div>
  </>;
}

function TaskDraft({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(draft); setCopied(true); setError(false); }
    catch { setError(true); }
  };
  return <div className="agents-modal-backdrop" onClick={onClose}><div ref={dialogRef} className="agents-modal" role="dialog" aria-modal="true" aria-labelledby="agent-draft-title" onClick={e => e.stopPropagation()} onKeyDown={e => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Tab') {
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }}><div className="agents-modal-title"><h2 id="agent-draft-title">Preparar una tarea</h2><button ref={closeRef} aria-label="Cerrar" onClick={onClose}><X size={20} /></button></div>
    <p>Definí el pedido y copialo al chat de GaleCore-AI para acordar las instrucciones y la frecuencia. La tarea aparecerá en «Tuyos» cuando se publique desde tu PC.</p>
    <label htmlFor="agent-draft">Tu pedido</label><textarea id="agent-draft" value={draft} onChange={e => { setDraft(e.target.value); setCopied(false); }} rows={6} />
    {error && <p role="alert">No se pudo copiar. Seleccioná el texto y copialo manualmente.</p>}
    <button className="agents-primary" onClick={copy} disabled={!draft.trim()}><Copy size={15} />{copied ? 'Pedido copiado' : 'Copiar pedido para el chat'}</button><span role="status" className="agents-secondary">{copied ? 'Listo para pegar en el chat.' : 'Este paso prepara el pedido; todavía no programa la tarea.'}</span>
  </div></div>;
}

export function Agentes() {
  const [items, setItems] = useState<SpaceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<'own' | 'templates'>('own');
  const [draft, setDraft] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { items: own } = await fetchSpace();
      setItems(own.filter((i) => i.kind === 'agent'));
      setError(null);
    } catch (e: any) {
      setError(e?.response?.status === 401 ? 'Tu sesión venció: volvé a entrar.' : 'No se pudo leer tus agentes de GaleCore.');
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const agents = (items ?? [])
    .map((i) => ({ item: i, a: parse(i.content) }))
    .filter((x): x is { item: SpaceItem; a: Agent } => !!x.a && !!x.a.id && x.a.status !== 'cancelled')
    .sort((x, y) => (x.a.status === y.a.status ? x.a.id.localeCompare(y.a.id) : x.a.status === 'active' ? -1 : 1));
  const current = agents.find((x) => x.item.key === selected);

  const request = async (item: SpaceItem, a: Agent, status: 'active' | 'paused') => {
    setBusy(item.key);
    try {
      const { request_error: _drop, ...rest } = a;
      await saveSpaceItem('agent', item.key, {
        title: item.title, format: 'json', visibility: item.visibility,
        content: JSON.stringify({ ...rest, request: { status, at: new Date().toISOString() } }),
      });
      await load();
    } catch {
      setError('No se pudo guardar el pedido. Probá de nuevo.');
    } finally {
      setBusy(null);
    }
  };

  return <div className="agents-page">
    {error && <div className="agents-error" role="alert">{error}<button className="agents-text-button" onClick={load}>Reintentar</button></div>}
    {current ? <AgentDetail key={current.item.key} a={current.a} title={current.item.title || WHAT[current.a.capability] || current.a.id}
      publishedAt={current.item.updatedAt} busy={busy === current.item.key} onRequest={s => request(current.item, current.a, s)} onBack={() => setSelected(null)} /> : <>
      <header className="agents-heading"><h1>Tareas programadas</h1></header>
      <div className="agents-toolbar"><div className="agents-tabs" role="group" aria-label="Vista de tareas"><button aria-pressed={view === 'own'} onClick={() => setView('own')}>Tuyos</button><button aria-pressed={view === 'templates'} onClick={() => setView('templates')}>Plantillas</button></div><button className="agents-primary" onClick={() => setDraft('Quiero preparar un agente que… Ayudame a definir las instrucciones, las fuentes, la frecuencia y el costo antes de programarlo.')}><Plus size={15} />Nueva tarea</button></div>
      {view === 'templates' ? <div className="agents-catalog">{TEMPLATES.map(t => <button className="agents-catalog-item" key={t.name} onClick={() => setDraft(t.prompt)}><span className="agents-icon"><t.Icon size={21} strokeWidth={1.5} /></span><span className="agents-item-copy"><strong>{t.name}</strong><span>{t.description}</span><small><Clock3 size={13} />{t.frequency}</small></span><ArrowUpRight className="agents-item-arrow" size={16} /></button>)}</div> : <>
        {items === null && !error && <p className="agents-empty" role="status">Cargando tareas…</p>}
        {items !== null && agents.length === 0 && <div className="agents-empty-state"><span className="agents-icon"><Bot size={24} /></span><h2>Todavía no tenés tareas programadas</h2><p>Prepará una tarea con tus instrucciones o elegí una plantilla para empezar.</p><button className="agents-text-button" onClick={() => setView('templates')}>Explorar plantillas <ChevronRight size={15} /></button></div>}
        <div className="agents-catalog">{agents.map(({ item, a }) => <button className="agents-catalog-item" key={item.key} onClick={() => setSelected(item.key)}><AgentIcon capability={a.capability} /><span className="agents-item-copy"><strong>{item.title || WHAT[a.capability] || a.id}</strong><span>{a.objective || WHAT[a.capability] || a.capability}</span><small><Clock3 size={13} />{a.schedule || 'Sin frecuencia publicada'}</small><span className="agents-item-status"><StatePill a={a} />{a.status === 'paused' && a.state !== 'PAUSED' && <small>En pausa</small>}{a.request && a.request.status !== a.status && <small>Cambio pendiente</small>}</span>{a.request_error && <small className="agents-error">No se pudo aplicar: {a.request_error}</small>}</span><ChevronRight className="agents-item-arrow" size={16} /></button>)}</div>
      </>}
    </>}
    {draft !== null && <TaskDraft initial={draft} onClose={() => setDraft(null)} />}
  </div>;
}
