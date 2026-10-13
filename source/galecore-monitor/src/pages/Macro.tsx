import React, { useEffect, useRef, useState } from 'react';
import { fetchMacro } from '../api/macroData';
import type { MacroSnapshot, MacroDefinition, MacroObservation } from '../types/macroTypes';
import { MacroCurve } from '../components/macro/MacroCurve';
import { MacroChart } from '../components/macro/MacroChart';
import './Macro.css';

const tabs = [ ['panorama', 'Panorama'], ['drivers', 'Expectativas y drivers'], ['markets', 'Mercados y regiones'],
  ['volatility', 'Volatilidad y posicionamiento'], ['events', 'Eventos'] ];
const families = [['rates', 'Tasas'], ['equities', 'Acciones'], ['credit', 'Crédito'], ['currencies', 'Monedas'], ['commodities', 'Commodities'], ['volatility', 'Volatilidad']];
const horizons = [['session', 'Sesión'], ['five-sessions', '5 sesiones'], ['month', '1 mes'], ['event', 'Desde evento']];
const format = (value: number | null | undefined) => value == null ? 'N/D' : value.toLocaleString('es-AR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const quality: Record<string, string> = { available: 'Disponible · diario', delayed: 'Retrasado', unavailable: 'No disponible', 'source-error': 'Error de fuente' };
function readRoute() {
  const q = new URLSearchParams(window.location.search);
  return { tab: tabs.some(t => t[0] === q.get('macro')) ? q.get('macro')! : 'panorama',
    horizon: horizons.some(h => h[0] === q.get('horizon')) ? q.get('horizon')! : 'month',
    region: q.get('region') === 'US' ? 'US' : 'Global', detail: q.get('detail'),
    snapshot: /^[a-f0-9]{64}$/.test(q.get('snapshot') || '') ? q.get('snapshot')! : undefined };
}
export function Macro() {
  const [route, setRoute] = useState(readRoute);
  const [data, setData] = useState<MacroSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  function navigate(change: Partial<typeof route>, replace = false) {
    const next = { ...route, ...change };
    const url = new URL(window.location.href);
    for (const key of ['macro', 'horizon', 'region', 'detail', 'snapshot']) url.searchParams.delete(key);
    url.searchParams.set('macro', next.tab); url.searchParams.set('horizon', next.horizon); url.searchParams.set('region', next.region);
    if (next.detail) url.searchParams.set('detail', next.detail);
    if (next.snapshot) url.searchParams.set('snapshot', next.snapshot);
    window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
    setRoute(next); setCopied(false);
  }
  useEffect(() => { const pop = () => setRoute(readRoute()); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setLoading(true); setError(''); setData(null);
    fetchMacro(route.horizon, route.region, controller.signal, route.snapshot).then(snapshot => {
      if (!alive) return;
      if (snapshot.horizon !== route.horizon || snapshot.region !== route.region) throw new Error('El snapshot del enlace no corresponde a estos filtros.');
      setData(snapshot);
    }).catch(e => { if (alive) setError(e.message || 'No se pudo leer Macro.'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [route.horizon, route.region, route.snapshot, refresh]);
  const definition = data?.seriesDefinitions.find(d => d.id === route.detail);
  const event = data?.events.find(e => e.id === route.detail);
  const selected = definition || event;
  useEffect(() => {
    if (selected) dialog.current?.focus();
    else opener.current?.focus();
  }, [selected]);
  const rowsFor = (id: string): MacroObservation[] => data?.observations.filter(o => o.seriesId === id).sort((a, b) => a.observationTime.localeCompare(b.observationTime)) || [];
  const metricFor = (id: string) => data?.metrics.find(m => m.seriesId === id);
  const lastFor = (id: string) => { const m = metricFor(id); return data?.observations.find(o => o.id === m?.levelRef); };
  const open = (id: string, target: HTMLElement) => { opener.current = target; navigate({ detail: id }); };
  const close = () => navigate({ detail: null });
  const sourceFailure = (d: MacroDefinition) => data?.sourceStatuses.find(s => s.id === d.id || s.id === d.source)?.status === 'source-error';
  const statusFor = (d: MacroDefinition) => sourceFailure(d) ? 'Error de fuente' : quality[lastFor(d.id)?.qualityStatus || 'unavailable'];
  async function copy() {
    if (!data) return;
    const url = new URL(window.location.href); url.searchParams.set('snapshot', data.id);
    try { await navigator.clipboard.writeText(url.toString()); setCopied(true); } catch { setError('No se pudo copiar el enlace.'); }
  }
  const radar = (defs: MacroDefinition[]) => <div className="macro-table-wrap"><table className="macro-radar"><caption>Datos observados y cálculos · sin interpretación de IA</caption><thead><tr><th>Indicador / unidad</th><th>Nivel</th><th>Cambio</th><th>Magnitud</th><th>Observación / calidad</th></tr></thead><tbody>{families.map(([id, label]) => {
    const group = defs.filter(d => d.family === id && d.id !== 'POLICY');
    return group.length === 0 ? null : <React.Fragment key={id}><tr className="macro-family"><th colSpan={5}>{label}</th></tr>{group.map(d => {
      const last = lastFor(d.id); const m = metricFor(d.id);
      return <tr key={d.id}><th><button onClick={e => open(d.id, e.currentTarget)}>{d.name}</button><span>{d.unit}</span></th>
        <td className="font-mono tabular-nums">{format(last?.value)}</td><td className="font-mono tabular-nums">{format(m?.value)} {m?.value == null ? '' : m.unit}<small>{m?.value == null ? 'Sin referencia compatible' : `${m.actualFrom} → ${m.actualTo}`}</small></td>
        <td>N/D<small>Sin método / muestra</small></td><td>{last?.observationTime || '—'}<small className={sourceFailure(d) ? 'macro-attention' : ''}>{statusFor(d)}</small></td></tr>;
    })}</React.Fragment>;
  })}</tbody></table></div>;
  const calendar = <section className="macro-section"><h2>Próximas pruebas</h2><p className="macro-note">Fechas programadas · sin hora exacta, consenso ni reacción intradía</p>
    {data?.events.length === 0 && <p>Sin eventos disponibles para los próximos 45 días.</p>}
    <ol className="macro-events">{data?.events.slice(0, route.tab === 'events' ? undefined : 5).map(e => <li key={e.id}><time>{e.date}</time><button onClick={click => open(e.id, click.currentTarget)}>{e.name}</button><small>{e.source.toUpperCase()}</small></li>)}</ol>
    {data?.sourceStatuses.filter(s => s.id.endsWith('calendar')).map(s => <p key={s.id} className={s.status === 'source-error' ? 'macro-attention' : 'macro-note'}>{s.id}: {quality[s.status]}{s.status === 'source-error' && ` · ${s.reasons.join(' ')}`}</p>)}
    {route.tab !== 'events' && <button className="macro-link" onClick={() => navigate({ tab: 'events' })}>Abrir calendario completo →</button>}
    <p className="macro-note">Noticias: fuente aún no incorporada.</p></section>;
  const chart = (id: string) => { const d = data?.seriesDefinitions.find(s => s.id === id); if (!d) return null;
    const rows = rowsFor(id); return <section className="macro-section" key={id}><button className="macro-chart-title" onClick={e => open(id, e.currentTarget)}>{d.name} <span>{d.unit}</span></button>
      {rows.some(r => r.value != null) ? <MacroChart rows={rows} unit={d.unit} label={`${d.name}, historia diaria revisada a hoy`} /> : <div className="macro-missing">{statusFor(d)}<p>Requiere fuente y método verificados.</p></div>}
      <p className="macro-note">{d.source} · {lastFor(id)?.observationTime || 'Sin observación'} · Historia revisada a hoy</p></section>;
  };
  return <div className="macro-page">
    <header className="macro-heading"><div><p>CONTEXTO DE MERCADO</p><h1>Macro</h1></div><span>Base determinística · cobertura EE. UU. parcial</span></header>
    <nav className="macro-tabs" aria-label="Secciones Macro">{tabs.map(([id, name]) => <button key={id} aria-current={route.tab === id ? 'page' : undefined} onClick={() => navigate({ tab: id })}>{name}</button>)}</nav>
    <div className="macro-filters"><label>Horizonte<select aria-label="Horizonte" value={route.horizon} onChange={e => navigate({ horizon: e.target.value, snapshot: undefined })}>{horizons.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Región<select aria-label="Región" value={route.region} onChange={e => navigate({ region: e.target.value, snapshot: undefined })}><option>Global</option><option value="US">EE. UU.</option></select></label>
      <span>Moneda Local · corte {route.snapshot ? 'guardado' : 'actual'}<small>Global muestra cobertura disponible: EE. UU.</small></span>
      <button disabled={loading} onClick={() => { if (route.snapshot) navigate({ snapshot: undefined }); else setRefresh(v => v + 1); }}>Actualizar datos</button>
      <button disabled={!data || loading} onClick={copy}>{copied ? 'Enlace copiado' : 'Copiar enlace'}</button></div>
    {route.horizon !== 'month' && <p role="status" className="macro-attention">Este horizonte requiere calendario de sesiones o evento verificable. Niveles disponibles; cambios N/D.</p>}
    <p className="macro-note">{data ? `Consulta ${data.generatedAt} · corte ${data.dataCutoff}` : 'Consulta pendiente'} · Lectura IA aún no generada</p>
    {loading && <p role="status">Consultando fuentes de Macro…</p>}{error && <p role="alert" className="macro-attention">{error}</p>}
    {!loading && data && <>
      {route.tab === 'panorama' && <div className="macro-panorama"><div><section className="macro-section macro-intro"><h2>Qué cambió</h2><p>Compará niveles y cambios con su fecha. Esta base reúne observaciones diarias; todavía no genera hipótesis ni explicaciones de IA.</p><p className="macro-note">Mes: última observación frente al mes calendario anterior. Sesión parcial, magnitud histórica y lectura global siguen pendientes.</p></section><div className="macro-charts">{['POLICY', 'DFII10', 'FX', 'EQUITIES'].map(chart)}</div><h2 className="macro-section-title">Radar de confirmación</h2>{radar(data.seriesDefinitions)}</div><aside>{calendar}</aside></div>}
      {route.tab === 'drivers' && <><h2 className="macro-section-title">Curva par · 2 / 5 / 10 / 30 años</h2><p className="macro-note">Rendimientos diarios, no trayectoria implícita de política monetaria. Pendientes calculadas en fechas comunes.</p><MacroCurve observations={data.observations} />{radar(data.seriesDefinitions.filter(d => d.family === 'rates'))}<div className="macro-charts">{['UST2', 'UST10', 'DFII10', 'T10YIE'].map(chart)}</div><p className="macro-note">Breakeven: compensación por inflación; no expectativa pura. Prima por plazo sin método habilitado.</p></>}
      {route.tab === 'markets' && <><h2 className="macro-section-title">Cobertura por mercado</h2><p>EE. UU.: tasas, crédito e índices de volatilidad diarios. Europa, China, Japón, emergentes y Argentina requieren inventario y fuentes verificadas.</p>{radar(data.seriesDefinitions.filter(d => d.family !== 'rates' && d.family !== 'volatility'))}</>}
      {route.tab === 'volatility' && <><h2 className="macro-section-title">Precio del riesgo · índices diarios</h2>{radar(data.seriesDefinitions.filter(d => d.family === 'volatility'))}<div className="macro-charts">{['VIX', 'VVIX', 'SKEW'].map(chart)}</div><p>Índices spot, no futuros. IV por plazo, COT, GEX/DEX y flujo clasificado quedan fuera de esta entrega.</p></>}
      {route.tab === 'events' && calendar}
      {data.sourceStatuses.some(s => s.status === 'source-error') && <p className="macro-attention" role="status">Cobertura parcial: una o más fuentes fallaron. Las demás observaciones se conservan.</p>}
    </>}
    {route.detail && data && !selected && <p role="alert">Referencia inexistente en este snapshot. <button onClick={close}>Cerrar detalle</button></p>}
    {selected && <div className="macro-detail-backdrop"><section className="macro-detail" role="dialog" aria-modal="true" aria-label="Detalle de evidencia" tabIndex={-1} ref={dialog}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); close(); } if (e.key === 'Tab') { const nodes = dialog.current?.querySelectorAll<HTMLElement>('button, a[href], select'); if (!nodes?.length) return; const first = nodes[0], last = nodes[nodes.length - 1]; if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } }}>
      <button className="macro-close" onClick={close}>Cerrar · Esc</button><h2>{selected.name}</h2>
      {definition && <><p>{definition.region} · {definition.unit} · {definition.frequency} · {definition.methodologyVersion}</p><p>Nivel {format(lastFor(definition.id)?.value)} · {lastFor(definition.id)?.observationTime || 'Sin observación'} · {statusFor(definition)}</p>
        <MacroChart rows={rowsFor(definition.id)} unit={definition.unit} label={definition.name} />
        <h3>Método y referencia</h3><p>{metricFor(definition.id)?.limitations.join(' ')}</p><p>{metricFor(definition.id)?.actualFrom || 'N/D'} → {metricFor(definition.id)?.actualTo || 'N/D'} · {metricFor(definition.id)?.formulaVersion}</p>
        <p>Publicación: {lastFor(definition.id)?.publishedAt || 'Desconocida'} · disponible desde: {lastFor(definition.id)?.availableAt || 'Desconocido'}</p><p>Consulta: {lastFor(definition.id)?.retrievedAt || 'N/D'}</p>
        {lastFor(definition.id)?.sourceRef && <a href={lastFor(definition.id)!.sourceRef} target="_blank" rel="noreferrer">Abrir fuente original ↗</a>}
        <p>{lastFor(definition.id)?.qualityReasons.join(' ')}</p>{definition.limitations.map(t => <p key={t} className="macro-note">{t}</p>)}
        <h3>Observaciones</h3><table><thead><tr><th>Fecha</th><th>Valor / {definition.unit}</th></tr></thead><tbody>{rowsFor(definition.id).map(r => <tr key={r.id}><td>{r.observationTime}</td><td>{format(r.value)}</td></tr>)}</tbody></table></>}
      {event && <><p>{event.date} · precisión: día · {event.source}</p><p>Consulta {event.retrievedAt}</p>{event.limitations.map(t => <p key={t}>{t}</p>)}<a href={event.sourceRef} target="_blank" rel="noreferrer">Abrir fuente original ↗</a></>}
      <p className="macro-note">Snapshot {data?.id} · histórico revisado; sin fidelidad retrospectiva.</p><button onClick={copy}>{copied ? 'Enlace copiado' : 'Copiar enlace'}</button>
    </section></div>}
  </div>;
}
