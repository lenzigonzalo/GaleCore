import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Save, ArrowLeft, Bot, ChevronDown, ChevronRight, Clock3, Plus, X } from 'lucide-react';
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
  schedule_spec?: ScheduleSpec; delivery?: string[]; tools?: string[] | null; tools_available?: string[] | null;
}

interface ScheduleSpec { frequency: string; time?: string; days?: string[]; minutes?: number; timezone: string }
interface NewAgent { id: string; kind: string; objective: string; schedule: ScheduleSpec; model?: string; delivery?: string[] }

interface AgentSettingsChange { objective?: string; model?: string | null; schedule?: ScheduleSpec; tools?: string[] | null; delivery?: string[] }
interface AgentRequest { status?: 'active' | 'paused'; settings?: AgentSettingsChange; create?: NewAgent; at?: string }

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
  if (a.request?.create) return <span style={{ ...muted, color: 'var(--text-secondary)' }}>Creando…</span>;
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

const DAY_LABELS: [string, string][] = [['mon', 'Lun'], ['tue', 'Mar'], ['wed', 'Mié'], ['thu', 'Jue'], ['fri', 'Vie'], ['sat', 'Sáb'], ['sun', 'Dom']];
const ZONES: [string, string][] = [['America/New_York', 'Nueva York'], ['America/Argentina/Buenos_Aires', 'Buenos Aires']];
/** Las skills que corren con el modelo y se pueden programar (el seguimiento de una estrategia corre por código y se crea desde el chat). */
const KINDS: [string, string][] = [['scheduled_report', 'Informe con tus palabras'], ['market_watch', 'Vigilancia del mercado'], ['market_story', 'Resumen del mercado'], ['daily_attention', 'Atención diaria'], ['knowledge_curator', 'Revisión de memoria']];

const TEMPLATES = [
  { name: 'Briefing diario', description: 'Un resumen de lo que necesita tu atención antes de empezar.', frequency: 'Lun a vie, 09:00 NY', kind: 'scheduled_report', objective: 'Armame un briefing antes de la apertura: cómo está mi cuenta, qué cambió desde ayer y qué requiere mi atención hoy, con números de GaleCore y su fecha.' },
  { name: 'Vigilancia del mercado', description: 'Seguí los símbolos y las condiciones de mercado que te interesan.', frequency: 'Lun a vie, 10:00 NY', kind: 'market_watch', objective: 'Revisá SPY, QQQ e IWM: decime si alguno cumple las condiciones que me interesan, cuál queda cerca y qué condición falla, con los números y sus fuentes.' },
  { name: 'Resumen del mercado', description: 'Qué historia está priceando hoy el mercado y si cambió.', frequency: 'Lun a vie, 17:15 NY', kind: 'market_story', objective: '¿Qué historia está priceando hoy el mercado y cambió frente a la lectura anterior?' },
];

function slug(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 8).join('-').slice(0, 48).replace(/-+$/, '');
}

const FREQ_OPTIONS: [string, string][] = [['daily', 'Todos los días'], ['weekdays', 'De lunes a viernes'], ['days', 'Días elegidos']];
const isEditableSchedule = (sp?: ScheduleSpec) => !sp || ['daily', 'weekdays', 'days'].includes(sp.frequency);

/** Cuándo corre: todos los días, de lunes a viernes o días elegidos, a una hora y zona. */
function ScheduleFields({ value, onChange }: { value: ScheduleSpec; onChange: (v: ScheduleSpec) => void }) {
  const days = value.days ?? [];
  const toggle = (d: string) => onChange({ ...value, days: days.includes(d) ? days.filter(x => x !== d) : [...days, d] });
  return <fieldset className="agents-fieldset"><legend>Cuándo corre</legend>
    <select aria-label="Frecuencia" value={value.frequency} onChange={e => onChange({ ...value, frequency: e.target.value, days: e.target.value === 'days' ? (days.length ? days : ['mon']) : undefined })}>
      {FREQ_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    {value.frequency === 'days' && <div className="agents-days" role="group" aria-label="Días">{DAY_LABELS.map(([d, l]) => <label key={d} className={days.includes(d) ? 'on' : ''}><input type="checkbox" checked={days.includes(d)} onChange={() => toggle(d)} />{l}</label>)}</div>}
    <div className="agents-when"><label>Hora<input type="time" value={value.time ?? '09:00'} onChange={e => onChange({ ...value, time: e.target.value })} required /></label>
      <label>Zona<select value={value.timezone} onChange={e => onChange({ ...value, timezone: e.target.value })}>{ZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label></div>
  </fieldset>;
}

function DeliveryFields({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const lib = value.includes('biblioteca');
  return <fieldset className="agents-fieldset"><legend>Dónde deja el resultado</legend>
    <label className="agents-check"><input type="checkbox" checked disabled />Historial de corridas</label>
    <label className="agents-check"><input type="checkbox" checked={lib} onChange={() => onChange(lib ? ['historial'] : ['historial', 'biblioteca'])} />Informe en la Biblioteca</label>
  </fieldset>;
}

const toolLabel = (rule: string) => rule.replace(/^Bash\(python -B -m galecore_ai\.adapters\.cli /, '').replace(/:\*\)$/, '').replace(/^Bash\(python -B /, 'script ');

/** Las herramientas de lectura de la skill: se pueden quitar, nunca sumar. */
function ToolFields({ available, value, onChange }: { available: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const rules = available.filter(r => r !== 'Read');
  return <fieldset className="agents-fieldset"><legend>Herramientas que usa</legend>
    {rules.map(r => <label className="agents-check" key={r}><input type="checkbox" checked={value.includes(r)} onChange={() => onChange(value.includes(r) ? value.filter(x => x !== r) : [...value, r])} /><code>{toolLabel(r)}</code></label>)}
    <small>Sólo lectura. Podés quitar herramientas; no se suman fuera de la skill.</small>
  </fieldset>;
}

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

const sameList = (x: string[], y: string[]) => x.length === y.length && x.every(v => y.includes(v));

function AgentSettings({ a, busy, onSave }: { a: Agent; busy: boolean; onSave: (settings: AgentSettingsChange) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [objective, setObjective] = useState(a.objective);
  const [model, setModel] = useState(a.model || '');
  const [schedule, setSchedule] = useState<ScheduleSpec>(a.schedule_spec ?? { frequency: 'daily', time: '09:00', timezone: 'America/New_York' });
  const [tools, setTools] = useState<string[]>(a.tools ?? []);
  const [delivery, setDelivery] = useState<string[]>(a.delivery ?? ['historial']);
  const pending = !!a.request;
  const scheduleEditable = a.editable && a.capability !== 'supervisor' && isEditableSchedule(a.schedule_spec) && !!a.schedule_spec;
  const edit = () => { setObjective(a.objective); setModel(a.model || ''); if (a.schedule_spec) setSchedule(a.schedule_spec); setTools(a.tools ?? []); setDelivery(a.delivery ?? ['historial']); setEditing(true); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const change: AgentSettingsChange = { objective: objective.trim() };
    if (a.model_editable) change.model = model || null;
    if (scheduleEditable && JSON.stringify(schedule) !== JSON.stringify(a.schedule_spec)) change.schedule = schedule;
    if (a.tools_available && !sameList(tools, a.tools ?? [])) change.tools = sameList(tools, a.tools_available) ? null : tools;
    if (a.delivery && !sameList(delivery, a.delivery)) change.delivery = delivery;
    void onSave(change).then(saved => { if (saved) setEditing(false); });
  };
  return <section><div className="agents-section-heading"><h2>Instrucciones y modelo</h2>{!editing && a.editable && <button className="agents-text-button" onClick={edit} disabled={busy || pending}><Pencil size={14} />Editar</button>}</div>
    {editing ? <form className="agents-edit-form" onSubmit={submit}>
      <label htmlFor="agent-objective">Qué debe hacer</label><textarea id="agent-objective" value={objective} onChange={e => setObjective(e.target.value)} rows={7} maxLength={12000} required />
      {scheduleEditable && <ScheduleFields value={schedule} onChange={setSchedule} />}
      {a.tools_available && a.tools_available.length > 1 && <ToolFields available={a.tools_available} value={tools} onChange={setTools} />}
      {a.delivery && <DeliveryFields value={delivery} onChange={setDelivery} />}
      {a.model_editable && <><label htmlFor="agent-model">Modelo</label><select id="agent-model" value={model} onChange={e => setModel(e.target.value)}><option value="">Automático ({a.model_default || 'según la tarea'})</option><option value="haiku">Haiku</option><option value="sonnet">Sonnet</option><option value="opus">Opus</option></select><small>Los cambios se aplican en las próximas corridas.</small></>}
      <div className="agents-edit-actions"><button className="agents-primary" type="submit" disabled={!objective.trim() || (schedule.frequency === 'days' && !(schedule.days?.length)) || busy || pending}><Save size={14} />Guardar cambios</button><button className="agents-text-button" type="button" onClick={() => setEditing(false)}>Cancelar</button></div>
    </form> : <><p className="agents-objective">{a.objective || 'Sin instrucciones publicadas.'}</p><p><Bot size={18} />{a.model_editable ? a.model || `Automático · ${a.model_default || 'según la tarea'}` : a.capability === 'supervisor' || a.model_editable === false ? 'Ejecución por código' : a.last_run?.model || 'Modelo no publicado'}</p>
      {a.tools_available && <p className="agents-secondary">Herramientas: {(a.tools ?? a.tools_available).filter(r => r !== 'Read').map(toolLabel).join(', ') || 'ninguna'}</p>}
      {a.delivery?.includes('biblioteca') && <p className="agents-secondary">Deja un informe en la Biblioteca.</p>}</>}
    {!a.editable && a.capability !== 'supervisor' && <small>La edición estará disponible cuando tu PC publique la configuración de esta tarea.</small>}
  </section>;
}

function AgentDetail({ a, title, publishedAt, onRequest, onSave, busy, onBack }: {
  a: Agent; title: string; publishedAt: string; onRequest: (s: 'active' | 'paused') => void; onSave: (settings: AgentSettingsChange) => Promise<boolean>; busy: boolean; onBack: () => void;
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

function NewAgentForm({ initial, existing, onCreate, onClose }: { initial: { kind: string; objective: string }; existing: string[]; onCreate: (c: NewAgent) => Promise<boolean>; onClose: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState(initial.kind);
  const [objective, setObjective] = useState(initial.objective);
  const [model, setModel] = useState('');
  const [schedule, setSchedule] = useState<ScheduleSpec>({ frequency: 'weekdays', time: '09:00', timezone: 'America/New_York' });
  const [delivery, setDelivery] = useState<string[]>(['historial']);
  const [saving, setSaving] = useState(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const id = slug(name);
  const taken = !!id && existing.includes(id);
  const valid = !!id && !taken && !!objective.trim() && (schedule.frequency !== 'days' || !!schedule.days?.length);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    void onCreate({ id, kind, objective: objective.trim(), schedule, ...(model ? { model } : {}), delivery }).then(ok => { setSaving(false); if (ok) onClose(); });
  };
  return <div className="agents-modal-backdrop" onClick={onClose}><div className="agents-modal" role="dialog" aria-modal="true" aria-labelledby="agent-new-title" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
    <div className="agents-modal-title"><h2 id="agent-new-title">Nueva tarea</h2><button ref={closeRef} aria-label="Cerrar" onClick={onClose}><X size={20} /></button></div>
    <form className="agents-edit-form" onSubmit={submit}>
      <label htmlFor="agent-name">Nombre</label><input id="agent-name" value={name} onChange={e => setName(e.target.value)} maxLength={60} required />
      {taken && <small className="agents-failed">Ya existe una tarea con ese nombre.</small>}
      <label htmlFor="agent-kind">Qué tipo de tarea</label><select id="agent-kind" value={kind} onChange={e => setKind(e.target.value)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <label htmlFor="agent-new-objective">Qué debe hacer</label><textarea id="agent-new-objective" value={objective} onChange={e => setObjective(e.target.value)} rows={6} maxLength={12000} required />
      <ScheduleFields value={schedule} onChange={setSchedule} />
      <DeliveryFields value={delivery} onChange={setDelivery} />
      <label htmlFor="agent-new-model">Modelo</label><select id="agent-new-model" value={model} onChange={e => setModel(e.target.value)}><option value="">Automático</option><option value="haiku">Haiku</option><option value="sonnet">Sonnet</option><option value="opus">Opus</option></select>
      <small>Las herramientas de lectura de la skill quedan activas; las podés quitar después de crearla. Tu PC la crea en hasta 5 minutos y tiene que estar encendida.</small>
      <div className="agents-edit-actions"><button className="agents-primary" type="submit" disabled={!valid || saving}><Save size={14} />Crear tarea</button><button className="agents-text-button" type="button" onClick={onClose}>Cancelar</button></div>
    </form>
  </div></div>;
}

export function Agentes() {
  const [items, setItems] = useState<SpaceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<'own' | 'templates'>('own');
  const [draft, setDraft] = useState<{ kind: string; objective: string } | null>(null);

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

  const create = async (c: NewAgent) => {
    try {
      const content = { id: c.id, capability: c.kind, status: 'paused', schedule: '', objective: c.objective, state: 'PENDING', runs: 0, request: { create: c, at: new Date().toISOString() } };
      await saveSpaceItem('agent', c.id, { title: c.id, format: 'json', visibility: 'private', content: JSON.stringify(content) });
      await load();
      return true;
    } catch {
      setError('No se pudo guardar el pedido. Probá de nuevo.');
      return false;
    }
  };

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
        <div className="agents-actions"><button className="agents-text-button agents-new" onClick={() => setDraft({ kind: 'scheduled_report', objective: '' })}><Plus size={16} />Nueva tarea</button>
          <div className="stage-switch" role="group" aria-label="Vista de tareas"><button aria-pressed={view === 'own'} onClick={() => setView('own')}>Tuyos</button><button aria-pressed={view === 'templates'} onClick={() => setView('templates')}>Plantillas</button></div></div></div>
      {view === 'templates' ? <div className="performance-table strategy-list agents-table"><table>
        <thead><tr><th>Plantilla</th><th>Para qué</th><th>Cuándo</th></tr></thead>
        <tbody>{TEMPLATES.map(t => <tr className="strategy-row" key={t.name} onClick={() => setDraft({ kind: t.kind, objective: t.objective })}><td className="strategy-name"><button onClick={e => { e.stopPropagation(); setDraft({ kind: t.kind, objective: t.objective }); }}>{t.name}</button></td><td className="agents-what">{t.description}</td><td>{t.frequency}</td></tr>)}</tbody>
      </table></div> : <>
        {items === null && !error && <p className="agents-empty" role="status">Cargando tareas…</p>}
        {items !== null && agents.length === 0 && <div className="agents-empty-state"><h2>Todavía no tenés tareas programadas</h2><p>Creá una tarea con tus instrucciones o elegí una plantilla para empezar.</p><button className="agents-text-button" onClick={() => setView('templates')}>Ver plantillas <ChevronRight size={15} /></button></div>}
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
    {draft !== null && <NewAgentForm initial={draft} existing={(items ?? []).map(i => i.key)} onCreate={create} onClose={() => setDraft(null)} />}
  </div>;
}
