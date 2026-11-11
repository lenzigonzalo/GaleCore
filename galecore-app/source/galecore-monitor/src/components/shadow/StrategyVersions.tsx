import React, { useCallback, useEffect, useState } from 'react';
import { approveStrategyVersion, duplicateStrategy, fetchStrategyVersions, StrategyVersion } from '../../api/strategyVersions';
import { fetchShadowMetrics } from '../../api/shadow';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';
import { ShadowInstance, SpecVersionMetrics } from '../../types/shadow';
import { num, usdAr } from './ficha';
import { strategyName } from './panelPresentation';

const NAME_RE = /^[a-z][a-z0-9_]{2,59}$/;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dateAr = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }); };
const show = (v: unknown) => typeof v === 'string' ? v : JSON.stringify(v) ?? '—';
const verKey = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);
const newestFirst = (a: StrategyVersion, b: StrategyVersion) => {
  const x = verKey(a.version), y = verKey(b.version);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (y[i] ?? 0) - (x[i] ?? 0); if (d) return d; }
  return 0;
};

function diffLines(v: StrategyVersion): string[] {
  const d = v.diff_from_previous;
  if (!d) return [];
  const out: string[] = [];
  d.spec.forEach(s => out.push(`${s.path}: ${show(s.from)} → ${show(s.to)}`));
  d.rules.forEach(r => out.push(r.text || `${r.rule}: ${r.change}`));
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
  const current = sorted.find(v => v.version === selected) ?? sorted[0];
  const stateOf = (v: StrategyVersion) => instance?.versionHash && v.spec_hash === instance.versionHash ? 'activa' : v.approved ? 'aprobada' : 'borrador';
  const previous = sorted[sorted.indexOf(current) + 1];
  const row = metrics.find(m => m.specName === spec && m.contentHash === current.spec_hash);
  const lines = diffLines(current);
  const pick = (v: string) => { setSelected(v); setMode(''); setError(''); setDone(''); };

  const approve = async () => {
    setBusy(true); setError('');
    try { await approveStrategyVersion(spec, current.version, who); setMode(''); await load(); }
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
          : <span>¿Activás {strategyName(spec)} {current.version} en SHADOW (simulado, sin dinero real)? {current.factibilidad?.texto}</span>}{' '}
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
