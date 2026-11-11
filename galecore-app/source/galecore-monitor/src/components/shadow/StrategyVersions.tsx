import React, { useCallback, useEffect, useState } from 'react';
import { approveStrategyVersion, duplicateStrategy, fetchStrategyVersions, StrategyVersion } from '../../api/strategyVersions';
import { fetchShadowMetrics } from '../../api/shadow';
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

function diffLines(v: StrategyVersion): string[] {
  const d = v.diff_from_previous;
  if (!d) return [];
  const out: string[] = [];
  d.spec.filter(s => !HIDDEN_PATH.test(s.path)).forEach(s => out.push(`${pathLabel(s.path)}: ${show(s.from)} → ${show(s.to)}`));
  d.rules.forEach(r => out.push(r.text || `Regla ${r.rule} ${r.change === 'changed' ? 'modificada' : r.change === 'added' ? 'agregada' : r.change === 'removed' ? 'quitada' : r.change}${r.fields?.length ? ` (${r.fields.map(f => RULE_FIELDS[f] ?? f).join(', ')})` : ''}`));
  d.parameters.forEach(p => out.push(`${p.name}: ${show(p.from)} → ${show(p.to)}`));
  return out;
}

/** Versiones de la estrategia en el Lab: elegir una, ver qué cambió y sus resultados, aprobarla o duplicarla. */
export function StrategyVersions({ spec, instance }: { spec: string; instance: ShadowInstance | null }) {
  const [versions, setVersions] = useState<StrategyVersion[]>([]);
  const [metrics, setMetrics] = useState<SpecVersionMetrics[]>([]);
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState<'' | 'approve' | 'duplicate'>('');
  const [newName, setNewName] = useState(`${spec}_copia`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const user = useCurrentUserStore(s => s.user);
  const who = user?.username || user?.email?.split('@')[0] || '';

  const load = useCallback(async () => {
    try { setVersions(await fetchStrategyVersions(spec)); } catch { setVersions([]); }
  }, [spec]);
  useEffect(() => { setSelected(''); setMode(''); setError(''); setDone(''); setNewName(`${spec}_copia`); void load(); }, [spec, load]);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(fetchShadowMetrics).then(m => { if (active) setMetrics(m ?? []); }).catch(() => undefined);
    return () => { active = false; };
  }, [spec]);

  if (!versions.length) return null;
  const sorted = [...versions].sort(newestFirst);
  const stateOf = (v: StrategyVersion) => instance?.versionHash && v.spec_hash === instance.versionHash ? 'activa' : v.approved ? 'aprobada' : 'borrador';
  // Sin elegir otra, se muestra la que corre; si ninguna corre, la más nueva.
  const current = sorted.find(v => v.version === selected) ?? sorted.find(v => stateOf(v) === 'activa') ?? sorted[0];
  const previous = sorted[sorted.indexOf(current) + 1];
  const row = metrics.find(m => m.specName === spec && m.contentHash === current.spec_hash);
  const lines = diffLines(current);
  const pick = (v: string) => { setSelected(v); setMode(''); setError(''); setDone(''); };

  const approve = async () => {
    setBusy(true); setError('');
    try { await approveStrategyVersion(spec, current.version, who); setMode(''); setDone(`Aprobada la ${current.version} por ${who}. No se prendió.`); await load(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const nameError = NAME_RE.test(newName) ? '' : 'El nombre va en minúsculas, empieza con letra y usa solo letras, números y guion bajo (3 a 60 caracteres).';
  const duplicate = async () => {
    setBusy(true); setError('');
    try {
      const r = await duplicateStrategy(spec, current.version, newName, who);
      setDone(`Creada ${newName} en borrador, copiada de ${spec} ${current.version}. La original no cambió.${r?.projectId ? ` Proyecto: ${r.projectId}.` : ''}`);
      setMode('');
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return <section className="strategy-versions" aria-label="Versiones">
    <label><b>Versiones</b> <select value={current.version} onChange={e => pick(e.target.value)} aria-label="Versiones de la estrategia">
      {sorted.map(v => <option key={v.version} value={v.version}>{`${v.version} · ${dateAr(v.recorded_at)} · ${stateOf(v)}`}</option>)}
    </select></label>
    <div className="version-card" role="group" aria-label={`Versión ${current.version}`}>
      <p><b>Fecha</b> {dateAr(current.recorded_at)} · <b>Estado</b> {stateOf(current)}</p>
      {current.factibilidad?.texto && <p>{current.factibilidad.texto}</p>}
      {current.change?.reason && <p><b>Motivo del cambio</b> {current.change.reason}</p>}
      <p><b>Resultados propios de esta versión</b> {row && (row.positionsOpened > 0 || row.positionsClosed > 0)
        ? `${num(row.positionsOpened)} abiertas · ${num(row.positionsClosed)} cerradas · ${usdAr(row.realizedPnl)} realizado · ${row.winRate === null ? '—' : `${num(row.winRate * 100, 1)} %`} ganadoras`
        : 'sin operaciones'}</p>
      <div><b>{previous ? `Qué cambió frente a la ${previous.version}` : 'Qué cambió'}</b>
        {!current.diff_from_previous ? <p>primera versión</p> : lines.length ? <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : <p>sin cambios</p>}
      </div>
      {!current.approved && mode !== 'approve' && <button type="button" className="row-action" onClick={() => { setMode('approve'); setError(''); setDone(''); }}>Aprobar versión</button>}
      {!current.approved && mode === 'approve' && <div className="row-confirm">
        {!who ? <span role="alert">Iniciá sesión para aprobar</span>
          : <span>¿Aprobar {strategyName(spec)} {current.version} para SHADOW (simulado, sin dinero real)? Sólo queda aprobada: no se prende sola. {current.factibilidad?.texto}</span>}{' '}
        {who && <button type="button" className="row-action danger" disabled={busy || current.check === 'INVALID'} onClick={() => void approve()}>Sí</button>}{' '}
        <button type="button" className="row-action" disabled={busy} onClick={() => setMode('')}>No</button>
      </div>}
      {mode !== 'duplicate' && <button type="button" className="row-action" onClick={() => { setMode('duplicate'); setNewName(`${spec}_copia`); setError(''); setDone(''); }}>Duplicar como estrategia nueva</button>}
      {mode === 'duplicate' && <div className="row-confirm">
        <label>Nombre de la estrategia nueva <input value={newName} onChange={e => setNewName(e.target.value)} aria-label="Nombre de la estrategia nueva" /></label>
        {nameError && <p role="alert" className="status-bar-error">{nameError}</p>}{' '}
        {!who && <p role="alert" className="status-bar-error">Iniciá sesión para duplicar</p>}
        <button type="button" className="row-action danger" disabled={busy || !!nameError || !who} onClick={() => void duplicate()}>Sí</button>{' '}
        <button type="button" className="row-action" disabled={busy} onClick={() => setMode('')}>No</button>
      </div>}
      {done && <p role="status">{done}</p>}
      {error && <p role="alert" className="status-bar-error">{error}</p>}
    </div>
  </section>;
}
