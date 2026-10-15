import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Save, ArrowLeft, Bot, ChevronDown, ChevronRight, Clock3, Copy, Plus, X } from 'lucide-react';
import '../components/shadow/PerformancePanel.css';
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
  reason?: string; error?: string; failed: boolean; findings?: string | null; truncated?: boolean;
}
interface Agent {
  id: string; capability: string; status: 'active' | 'paused' | 'cancelled'; schedule: string;
  strategy?: string | null; objective: string; state: string; state_detail?: string;
  next_expected_at?: string | null; last_run?: LastRun | null; runs: number; findings?: string | null;
  result_ref?: string | null; request?: AgentRequest; request_error?: string;
  history?: LastRun[]; history_total?: number; model?: string | null; model_default?: string; editable?: boolean; model_editable?: boolean;
}

interface AgentRequest { status?: 'active' | 'paused'; settings?: { objective?: string; model?: string | null }; at?: string }

const REFRESH_MS = 60_000;

const WHAT: Record<string, string> = {
  supervisor: 'Avisos de estrategias', market_watch: 'Vigilancia del mercado', daily_attention: 'Atención diaria', strategy_followup: 'Seguimiento de estrategia', market_story: 'Resumen del mercado', knowledge_curator: 'Revisión de memoria',
};

const TICKERS = new Set(['spy', 'qqq', 'iwm', 'tlt', 'gex', 'vix', 'pcs', 'rpf']);

/** «gamma-spy-diaria» → «Gamma SPY diaria»: el id es lo único legible cuando la tarea no tiene un tipo conocido. */
function humanize(id: string): string {
  const words = id.split(/[-_]+/).filter(Boolean).map(w => (TICKERS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** La frecuencia como la publica la PC, en castellano: «(America/New_York)» → «, hora de Nueva York». */
function scheduleText(schedule?: string): string {
  if (!schedule) return 'Sin frecuencia publicada';
  const text = schedule
    .replace(/^de lunes a viernes/i, 'lun a vie').replace(/ a las /, ', ')
    .replace(/\s*\(America\/New_York\)/, ' NY').replace(/\s*\(America\/Argentina\/Buenos_Aires\)/, ' ARG').replace(/ Nueva York\)/, ' NY)');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const muted: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted)' };

const parse = (s: string): Agent | null => { try { return JSON.parse(s); } catch { return null; } };

function when(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const weekday = d.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '');
  return `${weekday} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}, ${hhmm(d)}`;
}

function hhmm(d: Date): string {
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
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

/** El botón de prender/apagar, o el pedido que espera aplicarse en la PC. */
function Toggle({ a, onRequest, busy }: { a: Agent; onRequest: (status: 'active' | 'paused') => void; busy: boolean }) {
  if (a.status === 'cancelled') return <span style={muted}>Cancelado</span>;
  // El supervisor (WS-0007) corre con la publicación de cada 5 minutos: no es una tarea que se prenda o apague.
  if (a.capability === 'supervisor') return <span style={muted}>Siempre activo</span>;
  const pending = a.request && a.request.status !== a.status ? a.request.status : null;
  if (pending || a.request?.settings) {
    return (
      <span style={{ ...muted, color: 'var(--text-secondary)' }}>
        {a.request?.settings ? 'Guardando cambios…' : pending === 'active' ? 'Activando…' : 'Pausando…'}
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
  { name: 'Briefing diario', description: 'Un resumen de lo que necesita tu atención antes de empezar.', frequency: 'A definir', prompt: 'Quiero preparar un briefing de mi cuenta y mis estrategias. Ayudame a definir qué necesita mi atención, las fuentes, el horario y el costo antes de programarlo.' },
  { name: 'Vigilancia del mercado', description: 'Seguí los símbolos y las condiciones de mercado que te interesan.', frequency: 'Por condición o frecuencia', prompt: 'Quiero preparar un agente que vigile el mercado. Ayudame a elegir símbolos, condiciones y fuentes de GaleCore, y a definir la frecuencia y el costo antes de programarlo.' },
  { name: 'Seguimiento de estrategia', description: 'Revisá cómo avanza una estrategia y qué requiere una decisión.', frequency: 'A definir', prompt: 'Quiero preparar un seguimiento de una estrategia. Ayudame a elegir la estrategia, qué cambios observar y cuándo avisarme, con fuentes y costo definidos antes de programarlo.' },
];

function taskTitle(a: Agent, title: string): string {
  if (title && title !== a.id && !title.startsWith(a.id + ' (') && !title.includes('_')) return title.replace(/\s*\([^)]*\)$/, '');
  return WHAT[a.capability] ? `${WHAT[a.capability]}${a.strategy ? ' · ' + a.strategy.split('_')[0].toUpperCase() : ''}` : humanize(a.id);
}

function resultLabel(run: LastRun): string {
  if (run.failed || run.result === 'FAILED' || run.result === 'ERROR') return 'No se completó';
  if (run.result === 'INCOMPLETE') return 'Análisis incompleto';
  if (run.result === 'DEGRADED') return 'Requiere atención';
  return 'Completada';
}

function resultTone(run: LastRun): string {
  const label = resultLabel(run);
  return label === 'Completada' ? '' : label === 'Requiere atención' ? 'agents-warn' : 'agents-failed';
}

function RunHistory({ a }: { a: Agent }) {
  // Old publishers only expose last_run. Never attach the prior good report to an incomplete attempt.
  const rows = a.history ?? (a.last_run ? [{ ...a.last_run, findings: a.last_run.failed || ['INCOMPLETE', 'FAILED', 'ERROR'].includes(a.last_run.result) ? null : a.findings }] : []);
  const groups = new Map<string, LastRun[]>();
  rows.forEach(run => {
    const date = new Date(run.at);
    const long = Number.isNaN(date.getTime()) ? 'Fecha no informada' : date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    const day = long.charAt(0).toUpperCase() + long.slice(1);
    groups.set(day, [...(groups.get(day) || []), run]);
  });
  return <section className="agents-history"><h2>Corridas</h2>
    {!rows.length && <p className="agents-empty">Esta tarea todavía no corrió.</p>}
    {Array.from(groups, ([day, runs]) => <section className="agents-day" key={day}><h3>{day}</h3>{runs.map((run, i) => <details className="agents-run-group" key={run.at + i}>
      <summary><span className="agents-run-time">{Number.isNaN(new Date(run.at).getTime()) ? '' : hhmm(new Date(run.at))}</span><span className={`agents-run-copy ${resultTone(run)}`}><strong>{resultLabel(run)}</strong></span>{run.model && <span className="agents-run-model">{run.model}</span>}<ChevronDown size={17} /></summary>
      <div className="agents-result">
        {run.findings ? <Markdown text={run.findings} fontSize={15} /> : <p className="agents-secondary">{run.result === 'INCOMPLETE' ? 'Se guardaron los datos de la corrida, pero no se pudo generar un análisis válido.' : 'Esta corrida no tiene un informe disponible.'}</p>}
        {run.truncated && <p className="agents-secondary">Vista resumida. El informe completo queda guardado en GaleCore-AI.</p>}
        {(run.error || run.reason) && <details className="agents-technical"><summary>Detalles de la corrida</summary><p>{run.error || run.reason}</p></details>}
        <div className="agents-run-meta"><span>{run.invoked_by === 'scheduler' ? 'Programada' : run.invoked_by ? 'Manual' : 'Origen no informado'}</span>{run.duration_s != null && <span>{Math.round(run.duration_s)} s</span>}</div>
      </div>
    </details>)}</section>)}
    <p className="agents-history-note">{a.history_total ?? a.runs} corridas registradas.{a.history && (a.history_total ?? a.runs) > rows.length ? ` Mostrando las últimas ${rows.length}.` : ''}{!a.history && a.runs > 1 ? ' El historial anterior todavía no se publicó desde tu PC.' : ''}</p>
  </section>;
}

function AgentSettings({ a, busy, onSave }: { a: Agent; busy: boolean; onSave: (settings: NonNullable<AgentRequest['settings']>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [objective, setObjective] = useState(a.objective);
  const [model, setModel] = useState(a.model || '');
  const pending = !!a.request;
  const edit = () => { setObjective(a.objective); setModel(a.model || ''); setEditing(true); };
  return <section><div className="agents-section-heading"><h2>Instrucciones y modelo</h2>{!editing && a.editable && <button className="agents-text-button" onClick={edit} disabled={busy || pending}><Pencil size={14} />Editar</button>}</div>
    {editing ? <form className="agents-edit-form" onSubmit={e => { e.preventDefault(); void onSave({ objective: objective.trim(), ...(a.model_editable ? { model: model || null } : {}) }).then(saved => { if (saved) setEditing(false); }); }}>
      <label htmlFor="agent-objective">Qué debe hacer</label><textarea id="agent-objective" value={objective} onChange={e => setObjective(e.target.value)} rows={7} maxLength={12000} required />
      {a.model_editable && <><label htmlFor="agent-model">Modelo</label><select id="agent-model" value={model} onChange={e => setModel(e.target.value)}><option value="">Automático ({a.model_default || 'según la tarea'})</option><option value="haiku">Haiku</option><option value="sonnet">Sonnet</option><option value="opus">Opus</option></select><small>El cambio se aplica en las próximas corridas. Se conservan la frecuencia y los límites de la tarea.</small></>}
      <div className="agents-edit-actions"><button className="agents-primary" type="submit" disabled={!objective.trim() || busy || pending}><Save size={14} />Guardar cambios</button><button className="agents-text-button" type="button" onClick={() => setEditing(false)}>Cancelar</button></div>
    </form> : <><p className="agents-objective">{a.objective || 'Sin instrucciones publicadas.'}</p><p><Bot size={18} />{a.model_editable ? a.model || `Automático · ${a.model_default || 'según la tarea'}` : a.capability === 'supervisor' || a.model_editable === false ? 'Ejecución por código' : a.last_run?.model || 'Modelo no publicado'}</p></>}
    {!a.editable && a.capability !== 'supervisor' && <small>La edición estará disponible cuando tu PC publique la configuración de esta tarea.</small>}
  </section>;
}

function AgentDetail({ a, title, publishedAt, onRequest, onSave, busy, onBack }: {
  a: Agent; title: string; publishedAt: string; onRequest: (s: 'active' | 'paused') => void; onSave: (settings: NonNullable<AgentRequest['settings']>) => Promise<boolean>; busy: boolean; onBack: () => void;
}) {
  return <>
    <div className="agents-breadcrumb"><button onClick={onBack}><ArrowLeft size={15} />Agentes</button><span>/</span><span>{title}</span></div>
    <header className="agents-detail-heading"><div><h1>{title}</h1><p>{a.strategy ? humanize(a.strategy) : WHAT[a.capability] || humanize(a.id)}</p></div><Toggle a={a} busy={busy} onRequest={onRequest} /></header>
    {a.request && <p className="agents-notice" role="status">{a.request.settings ? 'Cambios enviados.' : 'Pedido enviado.'} Tu PC los aplicará en hasta 5 minutos; tiene que estar encendida.</p>}
    {a.request_error && <p className="agents-error" role="alert">No se pudo aplicar: {a.request_error}</p>}
    {silent(a) && <p className="agents-notice">Sin noticias de tu PC desde {when(publishedAt)}. El resultado guardado es anterior a la corrida esperada.</p>}
    <div className="agents-detail-grid"><RunHistory a={a} /><aside className="agents-settings">
      <section className="agents-schedule"><h2>Cuándo corre</h2><p><Clock3 size={18} />{scheduleText(a.schedule)}</p>{a.status === 'active' && !silent(a) && a.next_expected_at && <small>Próxima corrida: {when(a.next_expected_at)}</small>}</section>
      <AgentSettings a={a} busy={busy} onSave={onSave} />
    </aside></div>
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

  const request = async (item: SpaceItem, a: Agent, change: AgentRequest) => {
    setBusy(item.key);
    try {
      const { request_error: _drop, ...rest } = a;
      await saveSpaceItem('agent', item.key, {
        title: item.title, format: 'json', visibility: item.visibility,
        content: JSON.stringify({ ...rest, request: { ...change, at: new Date().toISOString() } }),
      });
      await load();
      return true;
    } catch {
      setError('No se pudo guardar el pedido. Probá de nuevo.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  return <div className="agents-page">
    {error && <div className="agents-error" role="alert">{error}<button className="agents-text-button" onClick={load}>Reintentar</button></div>}
    {current ? <AgentDetail key={current.item.key} a={current.a} title={taskTitle(current.a, current.item.title)}
      publishedAt={current.item.updatedAt} busy={busy === current.item.key} onRequest={status => request(current.item, current.a, { status })} onSave={settings => request(current.item, current.a, { settings })} onBack={() => setSelected(null)} /> : <>
      <div className="strategy-list-heading"><h1 className="strategy-list-title">Agentes</h1>
        <div className="agents-actions"><button className="agents-text-button agents-new" onClick={() => setDraft('Quiero preparar un agente que… Ayudame a definir las instrucciones, las fuentes, la frecuencia y el costo antes de programarlo.')}><Plus size={16} />Nueva tarea</button>
          <div className="stage-switch" role="group" aria-label="Vista de tareas"><button aria-pressed={view === 'own'} onClick={() => setView('own')}>Tuyos</button><button aria-pressed={view === 'templates'} onClick={() => setView('templates')}>Plantillas</button></div></div></div>
      {view === 'templates' ? <div className="performance-table strategy-list agents-table"><table>
        <thead><tr><th>Plantilla</th><th>Para qué</th><th>Cuándo</th></tr></thead>
        <tbody>{TEMPLATES.map(t => <tr className="strategy-row" key={t.name} onClick={() => setDraft(t.prompt)}><td className="strategy-name"><button onClick={e => { e.stopPropagation(); setDraft(t.prompt); }}>{t.name}</button></td><td className="agents-what">{t.description}</td><td>{t.frequency}</td></tr>)}</tbody>
      </table></div> : <>
        {items === null && !error && <p className="agents-empty" role="status">Cargando tareas…</p>}
        {items !== null && agents.length === 0 && <div className="agents-empty-state"><h2>Todavía no tenés tareas programadas</h2><p>Prepará una tarea con tus instrucciones o elegí una plantilla para empezar.</p><button className="agents-text-button" onClick={() => setView('templates')}>Ver plantillas <ChevronRight size={15} /></button></div>}
        {agents.length > 0 && <div className="performance-table strategy-list agents-table"><table>
          <thead><tr><th>Agente</th><th>Qué hace</th><th>Cuándo</th><th>Última corrida</th><th>Estado</th></tr></thead>
          <tbody>{agents.map(({ item, a }) => <tr className="strategy-row" key={item.key} onClick={() => setSelected(item.key)}>
            <td className="strategy-name"><button onClick={e => { e.stopPropagation(); setSelected(item.key); }}>{taskTitle(a, item.title)}</button></td>
            <td title={a.objective || undefined}><span className="agents-clip agents-what">{a.objective || WHAT[a.capability] || ''}</span></td>
            <td title={scheduleText(a.schedule)}><span className="agents-clip">{scheduleText(a.schedule)}</span></td>
            <td className={a.last_run?.failed ? 'agents-failed' : undefined}>{silent(a) ? 'Sin noticias de tu PC' : a.last_run ? `${when(a.last_run.at)}${a.last_run.failed ? ' · no se completó' : ''}` : 'Todavía no corrió'}{a.request_error && <span className="agents-failed"> · no se aplicó el cambio</span>}</td>
            <td onClick={e => e.stopPropagation()}><Toggle a={a} busy={busy === item.key} onRequest={status => request(item, a, { status })} /></td>
          </tr>)}</tbody>
        </table></div>}
      </>}
    </>}
    {draft !== null && <TaskDraft initial={draft} onClose={() => setDraft(null)} />}
  </div>;
}
