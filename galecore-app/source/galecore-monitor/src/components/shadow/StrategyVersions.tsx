import React, { useCallback, useEffect, useState } from 'react';
import { activateStrategyVersion, duplicateStrategy, EditableField, fetchEditableFields, fetchStrategyVersions, reviseStrategyVersion, StrategyVersion, VersionDiff } from '../../api/strategyVersions';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';
import { ShadowInstance, SpecVersionMetrics } from '../../types/shadow';
import { num, usdAr } from './ficha';
import { strategyName } from './panelPresentation';

const NAME_RE = /^[a-z][a-z0-9_]{2,59}$/;
const dateAr = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }); };
const show = (v: unknown) => v === null || v === undefined ? 'sin definir' : typeof v === 'boolean' ? (v ? 'sí' : 'no') : typeof v === 'number' ? num(v) : typeof v === 'string' ? v : JSON.stringify(v);
const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  // fetch no da un mensaje legible cuando el Lab no responde o el pedido se corta.
  return /failed to fetch|networkerror|aborted|abort/i.test(m) ? 'No se pudo conectar con el Lab de esta PC: ¿está abierto?' : m;
};
const verKey = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);
const newestFirst = (a: StrategyVersion, b: StrategyVersion) => {
  const x = verKey(a.version), y = verKey(b.version);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (y[i] ?? 0) - (x[i] ?? 0); if (d) return d; }
  return 0;
};

// Lo que cambia en toda versión nueva (identidad, notas, fecha, hash del padre) no es un cambio de la estrategia: no se lista.
const HIDDEN_PATH = /^(identity|metadata)\./;
const PATH_LABELS: Record<string, string> = {
  'risk_limits.max_bet_pct': 'Tope por apuesta (% del riesgo abierto permitido)',
  'risk_limits.max_open_risk_pct': 'Riesgo abierto máximo (% del capital)',
  'risk_limits.max_risk_per_trade_pct': 'Riesgo máximo por operación (% del capital)',
  'risk_limits.max_loss_per_trade_usd': 'Pérdida máxima por operación (USD)',
  'risk_limits.max_concurrent_positions': 'Posiciones abiertas a la vez',
  'risk_limits.simulated_capital_usd': 'Capital simulado (USD)',
  'candidate_construction.constraints.min_credit': 'Crédito mínimo',
  'candidate_construction.constraints.max_bid_ask_spread_pct': 'Diferencia máxima entre compra y venta (%)',
  'candidate_construction.constraints.min_dte': 'Días mínimos al vencimiento',
  'candidate_construction.constraints.max_dte': 'Días máximos al vencimiento',
  'exits.deterministic.stop_loss.pct_of_credit': 'Corte de pérdida (% del crédito)',
  'exits.deterministic.time_exit.at': 'Salida por tiempo',
  'exits.deterministic.defensive_roll.enabled': 'Roll defensivo',
  'operational.entry_window.start': 'Ventana de entrada, desde',
  'operational.entry_window.end': 'Ventana de entrada, hasta',
  'operational.trade_limits.max_entries_per_day': 'Entradas por día',
};
const pathLabel = (path: string) => PATH_LABELS[path]
  ?? path.replace(/^entry_filters\.gate_layer\.gates\[(.+?)\]\.threshold\.value$/, 'Umbral de la regla $1');
const RULE_FIELDS: Record<string, string> = { block: 'bloque', text: 'texto', basis: 'fundamento', parameter: 'parámetro', rationale: 'justificación', sources: 'fuentes', runtime: 'ejecución' };

function linesOf(d: VersionDiff | null): string[] {
  if (!d) return [];
  const out: string[] = [];
  d.spec.filter(s => !HIDDEN_PATH.test(s.path)).forEach(s => out.push(`${pathLabel(s.path)}: ${show(s.from)} → ${show(s.to)}`));
  d.rules.forEach(r => out.push(r.text || `Regla ${r.rule} ${r.change === 'changed' ? 'modificada' : r.change === 'added' ? 'agregada' : r.change === 'removed' ? 'quitada' : r.change}${r.fields?.length ? ` (${r.fields.map(f => RULE_FIELDS[f] ?? f).join(', ')})` : ''}`));
  d.parameters.forEach(p => out.push(`${p.name}: ${show(p.from)} → ${show(p.to)}`));
  return out;
}

// Lo que cambia entre dos versiones cualesquiera: se pliegan los diffs de las versiones del medio (desde → hasta, sin pasos intermedios).
function changesBetween(sorted: StrategyVersion[], from: StrategyVersion, to: StrategyVersion): string[] {
  const asc = [...sorted].reverse();   // más vieja primero
  const a = asc.indexOf(from), b = asc.indexOf(to);
  if (a < 0 || b < 0 || a === b) return [];
  const forward = b > a;
  const steps = forward ? asc.slice(a + 1, b + 1) : asc.slice(b + 1, a + 1).reverse();
  const spec = new Map<string, { from: unknown; to: unknown }>();
  const extra: string[] = [];
  for (const v of steps) {
    const d = v.diff_from_previous;
    if (!d) continue;
    d.spec.filter(s => !HIDDEN_PATH.test(s.path)).forEach(s => {
      const step = forward ? { from: s.from, to: s.to } : { from: s.to, to: s.from };
      const seen = spec.get(s.path);
      spec.set(s.path, seen ? { from: seen.from, to: step.to } : step);
    });
    if (forward) extra.push(...linesOf({ ...d, spec: [] }));
  }
  const out: string[] = [];
  spec.forEach((c, path) => { if (JSON.stringify(c.from) !== JSON.stringify(c.to)) out.push(`${pathLabel(path)}: ${show(c.from)} → ${show(c.to)}`); });
  return [...out, ...extra];
}
const fieldProblem = (f: EditableField, text: string): string => {
  const t = text.trim().replace(',', '.');
  if (f.kind === 'time') return /^([01]\d|2[0-3]):[0-5]\d$/.test(text.trim()) ? '' : 'Tiene que ser una hora HH:MM, por ejemplo 13:45.';
  if (f.kind === 'integer') return /^\d+$/.test(t) ? '' : 'Tiene que ser un número entero, 0 o más.';
  return /^\d+(\.\d+)?$/.test(t) ? '' : 'Tiene que ser un número, 0 o más.';
};
const usdText = (n: number | null | undefined) => n === null || n === undefined ? '—' : usdAr(n);

/** Versiones de la estrategia en el Lab (plegado): ver qué cambió y sus resultados, activar una, editar (= versión nueva) o duplicar. */
export function StrategyVersions({ spec, instance, metrics = [], onChanged }: {
  spec: string; instance: ShadowInstance | null; metrics?: SpecVersionMetrics[]; onChanged?: () => Promise<void> | void;
}) {
  const [versions, setVersions] = useState<StrategyVersion[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [menu, setMenu] = useState(false);
  const [mode, setMode] = useState<'' | 'activate' | 'edit' | 'duplicate'>('');
  const [newName, setNewName] = useState(`${spec}_copia`);
  const [fields, setFields] = useState<EditableField[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const user = useCurrentUserStore(s => s.user);
  const who = user?.username || user?.email?.split('@')[0] || '';

  const load = useCallback(async () => {
    try { setVersions(await fetchStrategyVersions(spec)); } catch { setVersions([]); }
  }, [spec]);
  useEffect(() => { setOpen(false); setSelected(''); setMode(''); setMenu(false); setError(''); setDone(''); setNewName(`${spec}_copia`); void load(); }, [spec, load]);
  // La instancia cambió (otra versión activa, pausa): se recarga la lista para que estados y aprobaciones sean los de ahora.
  useEffect(() => { void load(); }, [instance?.versionHash, instance?.lifecycleState, load]);

  if (!versions.length) return null;
  const sorted = [...versions].sort(newestFirst);
  const stateOf = (v: StrategyVersion) => instance?.versionHash && v.spec_hash === instance.versionHash ? 'activa' : v.approved ? 'aprobada' : 'borrador';
  const active = sorted.find(v => stateOf(v) === 'activa');
  // Sin elegir otra queda marcada la que corre; si ninguna corre, la más nueva.
  const current = sorted.find(v => v.version === selected) ?? active ?? sorted[0];
  const row = metrics.find(m => m.specName === spec && m.contentHash === current.spec_hash);
  const reset = () => { setMode(''); setMenu(false); setError(''); setDone(''); };
  const pick = (v: string) => { setSelected(v); reset(); };
  const name = strategyName(spec);

  const activate = async () => {
    setBusy(true); setError('');
    try {
      await activateStrategyVersion(spec, current.version, who);
      setMode(''); setDone(`Activada ${name} v${current.version} en SHADOW (simulado).`);
      await load(); await onChanged?.();
    } catch (e) { setError(errText(e)); await load(); } finally { setBusy(false); }
  };
  const startEdit = async () => {
    reset(); setMode('edit'); setFields(null); setReason('');
    try {
      const list = await fetchEditableFields(spec, current.version);
      setFields(list); setValues(Object.fromEntries(list.map(f => [f.path, f.value === null ? '' : String(f.value)])));
    } catch (e) { setError(errText(e)); }
  };
  const problems = fields ? Object.fromEntries(fields.map(f => [f.path, (values[f.path] ?? '') === (f.value === null ? '' : String(f.value)) ? '' : fieldProblem(f, values[f.path] ?? '')])) : {};
  const changed = fields ? fields.filter(f => (values[f.path] ?? '') !== (f.value === null ? '' : String(f.value))) : [];
  const save = async () => {
    setBusy(true); setError('');
    try {
      const changes = Object.fromEntries(changed.map(f => [f.path, f.kind === 'time' ? (values[f.path] ?? '').trim() : Number((values[f.path] ?? '').trim().replace(',', '.'))]));
      const r = await reviseStrategyVersion(spec, current.version, who, changes, reason.trim() || undefined);
      const made = r.ref.split('/').pop() ?? '';
      setMode(''); setDone(`Guardada v${made} (borrador). Para usarla, activala.`);
      await load(); setSelected(made); setOpen(true); await onChanged?.();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const nameError = NAME_RE.test(newName) ? '' : 'El nombre va en minúsculas, empieza con letra y usa solo letras, números y guion bajo (3 a 60 caracteres).';
  const duplicate = async () => {
    setBusy(true); setError('');
    try {
      const r = await duplicateStrategy(spec, current.version, newName, who);
      setDone(`Creada ${newName} en borrador, copiada de ${spec} ${current.version}. La original no cambió.${r?.projectId ? ` Proyecto: ${r.projectId}.` : ''}`);
      setMode(''); await onChanged?.();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const vs = changesBetween(sorted, active ?? current, current);
  const lim = current.factibilidad?.limites_usd;
  const critique = current.critique ? `Crítica del agente: ${current.critique}${current.critique_why_not?.length ? ` — ${current.critique_why_not.join('; ')}` : ''}.` : '';
  const isActive = current === active;
  return <section className="strategy-versions" aria-label="Versiones">
    <button type="button" className="versions-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      {active ? `Versión activa v${active.version}` : 'Sin versión activa'} · {versions.length} {versions.length === 1 ? 'versión' : 'versiones'}
    </button>
    {open && <>
      <ul className="version-list" aria-label="Versiones de la estrategia">
        {sorted.map(v => {
          const lines = linesOf(v.diff_from_previous);
          return <li key={v.version} className={v === current ? 'selected' : undefined}>
            <button type="button" aria-current={v === current ? 'true' : undefined} onClick={() => pick(v.version)}>
              <b>v{v.version}</b> · {dateAr(v.recorded_at)} · <span className={`version-state ${stateOf(v)}`}>{stateOf(v)}</span>
            </button>
            {!v.diff_from_previous ? <p className="version-change">primera versión</p>
              : lines.length ? <ul className="version-change">{lines.map((l, k) => <li key={k}>{l}</li>)}</ul> : <p className="version-change">sin cambios</p>}
          </li>;
        })}
      </ul>
      <div className="version-card" role="group" aria-label={`Versión ${current.version}`}>
        <p><b>Fecha</b> {dateAr(current.recorded_at)} · <b>Estado</b> {stateOf(current)}</p>
        {current.factibilidad?.texto && <p>{current.factibilidad.texto}</p>}
        {current.change?.reason && <p><b>Motivo del cambio</b> {current.change.reason}</p>}
        <p><b>Resultados propios de esta versión</b> {row && (row.positionsOpened > 0 || row.positionsClosed > 0)
          ? `${num(row.positionsOpened)} abiertas · ${num(row.positionsClosed)} cerradas · ${usdAr(row.realizedPnl)} realizado · ${row.winRate === null ? '—' : `${num(row.winRate * 100, 1)} %`} ganadoras`
          : 'sin operaciones'}</p>
        <div className="version-actions">
          {!isActive && current.check !== 'INVALID' && mode !== 'activate' && <button type="button" className="row-action primary" onClick={() => { reset(); setMode('activate'); }}>Activar esta versión</button>}
          {!isActive && current.check === 'INVALID' && <span>No se puede activar: la versión no pasó la verificación (INVALID).</span>}
          {mode !== 'edit' && <button type="button" className="row-action" onClick={() => void startEdit()}>Editar</button>}
          <span className="version-menu">
            <button type="button" className="row-action" aria-label="Más acciones" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(m => !m)}>⋯</button>
            {menu && <div role="menu" className="menu-items">
              <button type="button" role="menuitem" className="row-action" onClick={() => { reset(); setMode('duplicate'); setNewName(`${spec}_copia`); }}>Duplicar como estrategia nueva</button>
            </div>}
          </span>
        </div>
        {mode === 'activate' && <div className="row-confirm" role="group" aria-label="Confirmar activación">
          {!who ? <span role="alert">Iniciá sesión para activar</span> : <span>
            Vas a dejar activa {name} v{current.version} en SHADOW (simulado, sin dinero real).{' '}
            {active ? `Cambia frente a la activa (v${active.version}): ${vs.length ? vs.join('; ') : 'sin cambios en los parámetros'}.` : 'No hay una versión activa para comparar.'}{' '}
            Topes: por operación {usdText(lim?.por_operacion)} · riesgo abierto {usdText(lim?.riesgo_abierto)} · por apuesta {usdText(lim?.por_apuesta)}.{' '}
            {critique}
          </span>}{' '}
          {who && <button type="button" className="row-action danger" disabled={busy} onClick={() => void activate()}>Activar</button>}{' '}
          <button type="button" className="row-action" disabled={busy} onClick={() => setMode('')}>Cancelar</button>
        </div>}
        {mode === 'edit' && <div className="row-confirm version-edit" role="group" aria-label="Editar parámetros">
          <p>Se guarda como una versión nueva (borrador) a partir de v{current.version}; esta no cambia. Las patas y las reglas se cambian en el Lab.</p>
          {!fields ? (!error && <p role="status">Leyendo parámetros…</p>) : <>
            {fields.map(f => <label key={f.path} className="edit-field">
              <span>{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
              <input value={values[f.path] ?? ''} aria-label={f.label} aria-invalid={!!problems[f.path]} inputMode={f.kind === 'time' ? 'text' : 'decimal'}
                placeholder={f.value === null ? 'sin definir' : undefined} onChange={e => setValues(v => ({ ...v, [f.path]: e.target.value }))} />
              {problems[f.path] && <span role="alert" className="status-bar-error">{problems[f.path]}</span>}
            </label>)}
            <label className="edit-field"><span>Motivo (opcional)</span><input value={reason} aria-label="Motivo" maxLength={500} onChange={e => setReason(e.target.value)} /></label>
            {!who && <p role="alert" className="status-bar-error">Iniciá sesión para guardar</p>}
            <button type="button" className="row-action danger" disabled={busy || !who || !changed.length || Object.values(problems).some(Boolean)} onClick={() => void save()}>Guardar como versión nueva</button>{' '}
            <button type="button" className="row-action" disabled={busy} onClick={() => setMode('')}>Cancelar</button>
          </>}
        </div>}
        {mode === 'duplicate' && <div className="row-confirm">
          <label>Nombre de la estrategia nueva <input value={newName} onChange={e => setNewName(e.target.value)} aria-label="Nombre de la estrategia nueva" /></label>
          {nameError && <p role="alert" className="status-bar-error">{nameError}</p>}{' '}
          {!who && <p role="alert" className="status-bar-error">Iniciá sesión para duplicar</p>}
          <button type="button" className="row-action danger" disabled={busy || !!nameError || !who} onClick={() => void duplicate()}>Sí</button>{' '}
          <button type="button" className="row-action" disabled={busy} onClick={() => setMode('')}>No</button>
        </div>}
      </div>
    </>}
    {done && <p role="status">{done}</p>}
    {error && <p role="alert" className="status-bar-error">{error}</p>}
  </section>;
}
