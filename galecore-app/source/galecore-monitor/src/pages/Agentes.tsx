import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Save, ArrowLeft, Bot, ChevronDown, ChevronRight, Clock3, Copy, ExternalLink, HelpCircle, Play, Plus, Trash2, X } from 'lucide-react';
import '../components/shadow/PerformancePanel.css';
import './Agentes.css';
import { Markdown } from '../components/settings/Markdown';
import { fetchSpace, saveSpaceItem, SpaceItem } from '../api/space';
import {
  AgentKeyStatus, AgentRun, FireTokenStatus, apiMessage, deleteFireToken, fetchAgentKey, fetchFireToken, fetchRuns, generateAgentKey,
  revokeAgentKey, runAgent, saveFireToken,
} from '../api/agents';

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
  id: string; capability: string; status: 'active' | 'paused' | 'cancelled' | 'pending'; schedule: string;
  runs_on?: string; trigger_id?: string | null; routine_url?: string | null;   // WS-0079: agente en la nube (rutina de claude.ai)
  strategy?: string | null; objective: string; state: string; state_detail?: string;
  next_expected_at?: string | null; last_run?: LastRun | null; runs: number; findings?: string | null;
  result_ref?: string | null; request?: AgentRequest; request_error?: string;
  history?: LastRun[]; history_total?: number; model?: string | null; model_default?: string; editable?: boolean; model_editable?: boolean;
  schedule_spec?: ScheduleSpec; delivery?: string[]; tools?: string[] | null; tools_available?: string[] | null;
  skill_scripts?: { skill: string; scripts: { script: string; last_run?: { at: string; ok: boolean; error?: string | null } | null }[] } | null;
}

interface ScheduleSpec { frequency: string; time?: string; days?: string[]; minutes?: number; timezone: string }
interface NewCloudAgentData { name: string; objective: string; schedule_spec: ScheduleSpec }

interface AgentSettingsChange { objective?: string; model?: string | null; schedule?: ScheduleSpec; schedule_spec?: ScheduleSpec; tools?: string[] | null; delivery?: string[] }
interface AgentRequest { status?: 'active' | 'paused'; settings?: AgentSettingsChange; create?: { id: string; objective: string; schedule_spec: ScheduleSpec }; run?: boolean; at?: string }

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
  if (a.runs_on === 'cloud') return a.id;
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
    const change: AgentSettingsChange = {};
    if (objective.trim() !== a.objective.trim()) change.objective = objective.trim();
    if (a.model_editable && model !== (a.model || '')) change.model = model || null;
    if (scheduleEditable && JSON.stringify(schedule) !== JSON.stringify(a.schedule_spec)) change.schedule = schedule;
    if (a.tools_available && !sameList(tools, a.tools ?? [])) change.tools = sameList(tools, a.tools_available) ? null : tools;
    if (a.delivery && !sameList(delivery, a.delivery)) change.delivery = delivery;
    if (!Object.keys(change).length) { setEditing(false); return; }
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
      {a.skill_scripts && <div className="agents-secondary"><p>Método: {humanize(a.skill_scripts.skill)}</p>{a.skill_scripts.scripts.map(sc => <p key={sc.script}>{sc.script} · {sc.last_run ? `${sc.last_run.ok ? 'OK' : 'Falló'} · ${when(sc.last_run.at)}${sc.last_run.ok ? '' : sc.last_run.error ? ` · ${sc.last_run.error.split('\n').pop()?.slice(0, 120)}` : ''}` : 'Sin corridas'}</p>)}</div>}
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

const isCloud = (a: Agent) => a.runs_on === 'cloud';

/** La frecuencia de una especificación, para mostrarla mientras la rutina todavía no se creó. */
function specText(sp: ScheduleSpec): string {
  const days = (sp.days ?? []).map(d => DAY_LABELS.find(x => x[0] === d)?.[1] ?? d).join(', ');
  const cadence = sp.frequency === 'weekdays' ? 'De lunes a viernes' : sp.frequency === 'days' ? days : 'Todos los días';
  return `${cadence}, ${sp.time ?? '09:00'} ${ZONES.find(z => z[0] === sp.timezone)?.[1] ?? sp.timezone}`;
}

function NewCloudAgent({ existing, onCreate, onClose }: { existing: string[]; onCreate: (c: NewCloudAgentData) => Promise<boolean>; onClose: () => void }) {
  const [name, setName] = useState('');
  const [what, setWhat] = useState('');
  const [schedule, setSchedule] = useState<ScheduleSpec>({ frequency: 'daily', time: '09:00', timezone: 'America/New_York' });
  const [saving, setSaving] = useState(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const id = slug(name);
  const taken = !!id && existing.includes(id);
  const valid = !!id && !taken && !!what.trim() && (schedule.frequency !== 'days' || !!schedule.days?.length);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    void onCreate({ name: name.trim(), objective: what.trim(), schedule_spec: schedule }).then(ok => { setSaving(false); if (ok) onClose(); });
  };
  return <div className="agents-modal-backdrop" onClick={onClose}><div className="agents-modal" role="dialog" aria-modal="true" aria-labelledby="agent-new-title" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
    <div className="agents-modal-title"><h2 id="agent-new-title">Nuevo agente</h2><button ref={closeRef} aria-label="Cerrar" onClick={onClose}><X size={20} /></button></div>
    <form className="agents-edit-form" onSubmit={submit}>
      <label htmlFor="agent-name">Nombre</label><input id="agent-name" value={name} onChange={e => setName(e.target.value)} maxLength={60} required />
      {taken && <small className="agents-failed">Ya existe un agente con ese nombre.</small>}
      <label htmlFor="agent-new-objective">Qué hace</label><textarea id="agent-new-objective" value={what} onChange={e => setWhat(e.target.value)} rows={6} maxLength={12000} required />
      <ScheduleFields value={schedule} onChange={setSchedule} />
      <div className="agents-edit-actions"><button className="agents-primary" type="submit" disabled={!valid || saving}><Save size={14} />Crear</button><button className="agents-text-button" type="button" onClick={onClose}>Cancelar</button></div>
    </form>
  </div></div>;
}

const RUN_LABELS: Record<string, string> = { ok: 'Completada', error: 'No se completó', skipped: 'Omitida', requested: 'Pedida', no_report: 'No reportó' };

function CloudRuns({ runs, error }: { runs: AgentRun[] | null; error: string | null }) {
  return <section className="agents-history"><h2>Corridas</h2>
    {error && <p className="agents-error" role="alert">{error}</p>}
    {runs && !runs.length && <p className="agents-empty">Este agente todavía no corrió.</p>}
    {(runs ?? []).map(run => {
      const at = run.finished_at ?? run.requested_at ?? run.created_at;
      const tone = run.status === 'error' || run.status === 'no_report' ? 'agents-failed' : '';
      return <details className="agents-run-group" key={run.id}>
        <summary><span className="agents-run-time">{when(at)}</span><span className={`agents-run-copy ${tone}`}><strong>{RUN_LABELS[run.status] ?? run.status}</strong></span><ChevronDown size={17} /></summary>
        <div className="agents-result">
          {run.summary ? <Markdown text={run.summary} fontSize={15} /> : <p className="agents-secondary">{run.status === 'no_report' ? 'La corrida no reportó su resultado.' : run.status === 'requested' ? 'Esperando el reporte de la corrida.' : 'Sin resumen.'}</p>}
          {run.session_url && <p><a href={run.session_url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Ver la sesión en claude.ai</a></p>}
          <div className="agents-run-meta"><span>{run.origin === 'schedule' ? 'Programada' : 'Manual'}</span>{run.reason_code && <span>{run.reason_code}</span>}</div>
        </div>
      </details>;
    })}
  </section>;
}

function CloudSettings({ a, busy, onSave }: { a: Agent; busy: boolean; onSave: (settings: AgentSettingsChange) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [objective, setObjective] = useState(a.objective);
  const [schedule, setSchedule] = useState<ScheduleSpec>(a.schedule_spec ?? { frequency: 'daily', time: '09:00', timezone: 'America/New_York' });
  const pending = !!a.request;
  const edit = () => { setObjective(a.objective); if (a.schedule_spec) setSchedule(a.schedule_spec); setEditing(true); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const change: AgentSettingsChange = {};
    if (objective.trim() !== a.objective.trim()) change.objective = objective.trim();
    if (JSON.stringify(schedule) !== JSON.stringify(a.schedule_spec)) change.schedule_spec = schedule;
    if (!Object.keys(change).length) { setEditing(false); return; }
    void onSave(change).then(saved => { if (saved) setEditing(false); });
  };
  return <section><div className="agents-section-heading"><h2>Instrucciones y horario</h2>{!editing && <button className="agents-text-button" onClick={edit} disabled={busy || pending}><Pencil size={14} />Editar</button>}</div>
    {editing ? <form className="agents-edit-form" onSubmit={submit}>
      <label htmlFor="agent-objective">Qué hace</label><textarea id="agent-objective" value={objective} onChange={e => setObjective(e.target.value)} rows={7} maxLength={12000} required />
      <ScheduleFields value={schedule} onChange={setSchedule} />
      <div className="agents-edit-actions"><button className="agents-primary" type="submit" disabled={!objective.trim() || (schedule.frequency === 'days' && !(schedule.days?.length)) || busy || pending}><Save size={14} />Guardar cambios</button><button className="agents-text-button" type="button" onClick={() => setEditing(false)}>Cancelar</button></div>
    </form> : <p className="agents-objective">{a.objective || 'Sin instrucciones.'}</p>}
  </section>;
}

function FireTokenSection({ agentKey, a, token, onChange }: { agentKey: string; a: Agent; token: FireTokenStatus | null; onChange: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await work(); setValue(''); onChange(); } catch (e) { setError(apiMessage(e, 'No se pudo guardar el token.')); } finally { setBusy(false); }
  };
  return <section><h2>Ejecutar sin PC (opcional)</h2>
    {a.routine_url && <p><ExternalLink size={16} /><a href={a.routine_url} target="_blank" rel="noreferrer">Abrir la rutina en claude.ai</a></p>}
    {token?.exists
      ? <p>Token cargado …{token.token_hint}<button className="agents-text-button" disabled={busy} onClick={() => act(() => deleteFireToken(agentKey))}><Trash2 size={14} />Quitar</button></p>
      : a.trigger_id
        ? <form className="agents-edit-form" onSubmit={e => { e.preventDefault(); void act(() => saveFireToken(agentKey, a.trigger_id!, value.trim())); }}>
          <label htmlFor="agent-token">Token de la rutina</label>
          <input id="agent-token" type="password" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} />
          <small>En claude.ai: editá la rutina, Trigger, API, Generate token.</small>
          <div className="agents-edit-actions"><button className="agents-primary" type="submit" disabled={!value.trim() || busy}>Guardar token</button></div>
        </form>
        : <p>Disponible cuando se cree la rutina.</p>}
    {error && <p className="agents-error" role="alert">{error}</p>}
  </section>;
}

function CloudDetail({ a, item, title, onChange, busy, onBack }: {
  a: Agent; item: SpaceItem; title: string; onChange: (r: AgentRequest) => Promise<boolean>; busy: boolean; onBack: () => void;
}) {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [token, setToken] = useState<FireTokenStatus | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [starting, setStarting] = useState(false);
  const loadRuns = useCallback(async () => {
    try { setRuns(await fetchRuns(item.key)); setRunsError(null); } catch (e) { setRunsError(apiMessage(e, 'No se pudieron leer las corridas.')); }
  }, [item.key]);
  const loadToken = useCallback(async () => { try { setToken(await fetchFireToken(item.key)); } catch { setToken(null); } }, [item.key]);
  useEffect(() => { void loadToken(); }, [loadToken]);
  useEffect(() => {
    void loadRuns();
    const id = setInterval(loadRuns, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadRuns]);
  const run = async () => {
    setStarting(true); setNotice(null);
    try {
      if (token?.exists) {
        await runAgent(item.key);
        setNotice({ text: 'Pedido enviado: la corrida aparece en la lista.' });
        await loadRuns();
      } else if (await onChange({ run: true })) {
        setNotice({ text: 'Se ejecuta cuando el Lab esté abierto.' });
      }
    } catch (e) {
      setNotice({ text: apiMessage(e, 'No se pudo ejecutar el agente.'), error: true });
    } finally { setStarting(false); }
  };
  const ready = !!a.trigger_id && a.status !== 'pending';
  return <>
    <div className="agents-breadcrumb"><button onClick={onBack}><ArrowLeft size={15} />Agentes</button><span>/</span><span>{title}</span></div>
    <header className="agents-detail-heading"><div><h1>{title}</h1><p>{scheduleText(a.schedule)}</p></div>
      <div className="agents-actions"><button className="agents-primary" onClick={run} disabled={!ready || starting || busy}><Play size={14} />Ejecutar</button><Toggle a={a} busy={busy} onRequest={status => { void onChange({ status }); }} /></div></header>
    {a.request && <p className="agents-notice" role="status">{a.request.create ? 'Creando la rutina.' : a.request.run ? 'Ejecución pedida.' : 'Cambios enviados.'} Se aplica cuando el Lab esté abierto.</p>}
    {a.request_error && <p className="agents-error" role="alert">No se pudo aplicar: {a.request_error}</p>}
    {notice && <p className={notice.error ? 'agents-error' : 'agents-notice'} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    <div className="agents-detail-grid"><CloudRuns runs={runs} error={runsError} /><aside className="agents-settings">
      <CloudSettings a={a} busy={busy} onSave={settings => onChange({ settings })} />
      <FireTokenSection agentKey={item.key} a={a} token={token} onChange={loadToken} />
    </aside></div>
  </>;
}

const API_HOST = (() => { try { return new URL(process.env.REACT_APP_API_BASE_URL ?? '').host; } catch { return ''; } })();

/** La configuración de una sola vez: clave de agentes, entorno en claude.ai y el link para el Lab. */
function Help() {
  const [status, setStatus] = useState<AgentKeyStatus | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchAgentKey().then(setStatus).catch(() => setError('No se pudo leer el estado de tu clave.')); }, []);
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await work(); } catch (e) { setError(apiMessage(e, 'No se pudo completar la operación.')); } finally { setBusy(false); }
  };
  const generate = () => act(async () => { const k = await generateAgentKey(); setFresh(k.key); setStatus({ exists: true, hint: k.hint }); });
  const revoke = () => act(async () => { await revokeAgentKey(); setFresh(null); setStatus({ exists: false }); });
  return <section className="agents-help" aria-label="Ayuda"><h2>Configuración de una sola vez</h2>
    <ol>
      <li><strong>Clave de agentes.</strong> Identifica a tus agentes cuando reportan una corrida; no lee ni escribe nada más.
        <div className="agents-edit-actions">
          <button className="agents-primary" onClick={generate} disabled={busy}>{status?.exists ? 'Regenerar clave' : 'Generar clave'}</button>
          {status?.exists && <button className="agents-text-button" onClick={revoke} disabled={busy}>Revocar</button>}
        </div>
        {fresh && <p role="status"><code>{fresh}</code><button className="agents-text-button" onClick={() => navigator.clipboard?.writeText(fresh)}><Copy size={14} />Copiar</button><small>Se ve una sola vez: copiala ahora.</small></p>}
        {!fresh && status?.exists && <p>Clave activa …{status.hint}</p>}
      </li>
      <li><strong>Entorno en claude.ai.</strong> Creá un entorno propio con {API_HOST ? <code>{API_HOST}</code> : 'el dominio de la API'} entre los dominios permitidos y estas variables: <code>GALECORE_BASE_URL</code>, <code>GALECORE_ALLOWED_BASE_URL</code>, <code>GALECORE_API_KEY</code> y <code>GALECORE_AGENT_KEY</code> (la clave del paso 1).</li>
      <li><strong>Link para el Lab.</strong> Pegale al Lab el link de ese entorno la primera vez que te lo pida.</li>
    </ol>
    {error && <p className="agents-error" role="alert">{error}</p>}
  </section>;
}

export function Agentes() {
  const [items, setItems] = useState<SpaceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [help, setHelp] = useState(false);

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
    // El supervisor es de la plataforma (Configuración → Plataforma), no una tarea del usuario (WS-0057 A).
    .filter((x): x is { item: SpaceItem; a: Agent } => !!x.a && !!x.a.id && x.a.status !== 'cancelled' && x.a.capability !== 'supervisor')
    .sort((x, y) => (x.a.status === y.a.status ? x.a.id.localeCompare(y.a.id) : x.a.status === 'active' ? -1 : 1));
  const current = agents.find((x) => x.item.key === selected);

  const create = async (c: NewCloudAgentData) => {
    try {
      const at = new Date().toISOString();
      const content = {
        id: c.name, runs_on: 'cloud', capability: 'routine', status: 'pending', objective: c.objective, schedule_spec: c.schedule_spec,
        schedule: specText(c.schedule_spec), model: 'claude-sonnet-5', trigger_id: null, routine_url: null, created_at: at,
        request: { create: { id: c.name, objective: c.objective, schedule_spec: c.schedule_spec }, at },
      };
      await saveSpaceItem('agent', slug(c.name), { title: c.name, format: 'json', visibility: 'private', content: JSON.stringify(content) });
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
    {current && isCloud(current.a) ? <CloudDetail key={current.item.key} a={current.a} item={current.item} title={taskTitle(current.a, current.item.title)}
      busy={busy === current.item.key} onChange={change => request(current.item, current.a, change)} onBack={() => setSelected(null)} />
      : current ? <AgentDetail key={current.item.key} a={current.a} title={taskTitle(current.a, current.item.title)}
      publishedAt={current.item.updatedAt} busy={busy === current.item.key} onRequest={status => request(current.item, current.a, { status })} onSave={settings => request(current.item, current.a, { settings })} onBack={() => setSelected(null)} /> : <>
      <div className="strategy-list-heading"><h1 className="strategy-list-title">Agentes</h1>
        <div className="agents-actions"><button className="agents-text-button" aria-expanded={help} onClick={() => setHelp(h => !h)}><HelpCircle size={16} />Ayuda</button>
          <button className="agents-text-button agents-new" onClick={() => setCreating(true)}><Plus size={16} />Nuevo agente</button>
          </div></div>
      {help && <Help />}
      <>
        {items === null && !error && <p className="agents-empty" role="status">Cargando agentes…</p>}
        {items !== null && agents.length === 0 && <div className="agents-empty-state"><h2>Todavía no tenés agentes</h2><p>Un agente hace una tarea tuya a su hora, sin que tengas nada abierto.</p><button className="agents-text-button" onClick={() => setCreating(true)}>Nuevo agente <ChevronRight size={15} /></button></div>}
        {agents.length > 0 && <div className="performance-table strategy-list agents-table"><table>
          <thead><tr><th>Agente</th><th>Qué hace</th><th>Cuándo</th><th>Última corrida</th><th>Estado</th></tr></thead>
          <tbody>{agents.map(({ item, a }) => <tr className="strategy-row" key={item.key} onClick={() => setSelected(item.key)}>
            <td className="strategy-name"><button onClick={e => { e.stopPropagation(); setSelected(item.key); }}>{taskTitle(a, item.title)}</button></td>
            <td title={a.objective || undefined}><span className="agents-clip agents-what">{a.objective || WHAT[a.capability] || ''}</span></td>
            <td title={scheduleText(a.schedule)}><span className="agents-clip">{scheduleText(a.schedule)}</span></td>
            <td className={a.last_run?.failed ? 'agents-failed' : undefined}>{isCloud(a) ? (a.request?.create ? 'Creando…' : '—') : silent(a) ? 'Sin noticias de tu PC' : a.last_run ? `${when(a.last_run.at)}${a.last_run.failed ? ' · no se completó' : ''}` : 'Todavía no corrió'}{a.request_error && <span className="agents-failed"> · no se aplicó el cambio</span>}</td>
            <td onClick={e => e.stopPropagation()}><Toggle a={a} busy={busy === item.key} onRequest={status => request(item, a, { status })} /></td>
          </tr>)}</tbody>
        </table></div>}
      </>
    </>}
    {creating && <NewCloudAgent existing={(items ?? []).map(i => i.key)} onCreate={create} onClose={() => setCreating(false)} />}
  </div>;
}
