import React, { useEffect, useRef, useState } from 'react';
import { fetchMacro } from '../api/macroData';
import type { MacroSnapshot, MacroDefinition, MacroObservation } from '../types/macroTypes';
import { MacroCurve } from '../components/macro/MacroCurve';
import { MacroCalendar, eventName } from '../components/macro/MacroCalendar';
import { MacroChart } from '../components/macro/MacroChart';
import './Macro.css';

const tabs = [ ['panorama', 'Panorama'], ['drivers', 'Expectativas y drivers'], ['markets', 'Mercados y regiones'],
  ['volatility', 'Volatilidad y posicionamiento'], ['events', 'Eventos'] ];
const families = [['rates', 'Tasas'], ['equities', 'Acciones'], ['credit', 'Crédito'], ['currencies', 'Monedas'], ['commodities', 'Materias primas'], ['volatility', 'Volatilidad']];
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
    setRoute(next);
  }
  useEffect(() => { const pop = () => setRoute(readRoute()); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('macro')) {
      url.searchParams.set('macro', 'panorama');
      url.searchParams.set('horizon', readRoute().horizon);
      url.searchParams.set('region', readRoute().region);
      window.history.replaceState(null, '', url);
    }
  }, []);
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

  const descriptions: Record<string, string> = {
    UST2: 'Rendimiento de bonos del Tesoro de EE. UU. a 2 años.', UST5: 'Rendimiento de bonos del Tesoro de EE. UU. a 5 años.',
    UST10: 'Rendimiento de bonos del Tesoro de EE. UU. a 10 años.', UST30: 'Rendimiento de bonos del Tesoro de EE. UU. a 30 años.',
    DFII10: 'Tasa de los bonos a 10 años protegidos contra la inflación.', T10YIE: 'Diferencia entre tasa nominal y real a 10 años. Incluye compensación por inflación y otras primas.',
    SLOPE2_10: 'Diferencia entre el rendimiento a 10 años y a 2 años.', SLOPE5_30: 'Diferencia entre el rendimiento a 30 años y a 5 años.',
    BAMLH0A0HYM2: 'Prima de rendimiento del crédito de mayor riesgo frente a una referencia libre de riesgo.', BAMLC0A0CM: 'Prima de rendimiento del crédito con grado de inversión.',
    VIX: 'Volatilidad esperada del S&P 500 a 30 días, derivada de opciones. Es un índice, no un precio de futuro.',
    VVIX: 'Volatilidad esperada del propio VIX.', SKEW: 'Índice que describe cómo se paga el riesgo de movimientos extremos en opciones del S&P 500.',
  };
  const name = (d: MacroDefinition) => d.id === 'COMMODITIES' ? 'Oro, petróleo y otras materias primas' : d.name;
  const date = (value?: string | null) => value ? new Date(value.slice(0,10) + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Sin fecha';
  const radar = (defs: MacroDefinition[]) => <div className="macro-table-wrap"><table className="macro-radar"><thead><tr><th>Mercado</th><th>Indicador</th><th>Valor</th><th>Cambio en 1 mes</th></tr></thead><tbody>{families.map(([id, label]) => {
    const group = defs.filter(d => d.family === id && d.id !== 'POLICY');
    return group.map((d, index) => { const last = lastFor(d.id); const metric = metricFor(d.id);
      return <tr key={d.id}>{index === 0 && <th className="macro-family" rowSpan={group.length}>{label}</th>}<th>
        <button disabled={!last} onClick={e => open(d.id, e.currentTarget)}>{name(d)} <span className="macro-unit">{d.unit}</span></button>
      </th><td className="font-mono tabular-nums">{format(last?.value)}{sourceFailure(d) && <span className="macro-data-warning">Sin actualización</span>}</td>
        <td className="font-mono tabular-nums">{format(metric?.value)}{metric?.value != null ? ` ${metric.unit}` : ''}</td></tr>;
    });
  })}</tbody></table></div>;
  const calendar = <MacroCalendar events={data?.events || []} onSelect={(e, target) => open(e.id, target)} />;
  const upcoming = <section className="macro-upcoming"><h2>Próximos eventos</h2><ol>{data?.events.slice(0,5).map(e => <li key={e.id}><time>{date(e.date)}</time><button onClick={click => open(e.id, click.currentTarget)}>{eventName(e.name)}</button></li>)}</ol><button className="macro-link" onClick={() => navigate({ tab: 'events' })}>Ver calendario →</button></section>;
  const chart = (id: string) => { const d = data?.seriesDefinitions.find(def => def.id === id); if (!d) return null;
    const rows = rowsFor(id); const last = lastFor(id); const metric = metricFor(id);
    return <section className="macro-chart-panel" key={id}><header><button disabled={!last} onClick={e => open(id,e.currentTarget)}>{d.name}</button><div><strong>{format(last?.value)} <span>{d.unit}</span></strong><span className="macro-chart-change">{metric?.value == null ? 'Cambio no disponible' : `${format(metric.value)} ${metric.unit} en 1 mes`}</span></div></header>
      {rows.some(r => r.value != null) ? <MacroChart rows={rows} unit={d.unit} label={d.name} /> : <div className="macro-missing"><strong>No disponible</strong><p>No pudimos obtener esta serie.</p></div>}
      {sourceFailure(d) && <p className="macro-attention">{last ? 'No se pudo actualizar. Se muestra el último dato disponible.' : 'La fuente no respondió. No hay un dato disponible.'}</p>}</section>;
  };
  return <div className="macro-page">
    <nav className="macro-tabs" aria-label="Secciones Macro">{tabs.map(([id,label]) => <button key={id} aria-current={route.tab === id ? 'page' : undefined} onClick={() => navigate({ tab:id })}>{label}</button>)}</nav>
    <div className="macro-toolbar"><span><strong>Últimos valores</strong> · cambio frente a 1 mes</span><button disabled={loading} onClick={() => { if(route.snapshot) navigate({snapshot:undefined}); else setRefresh(v=>v+1); }}>Actualizar</button></div>
    {route.horizon !== 'month' && <p role="status" className="macro-attention">Este enlace usa un período que todavía no se puede comparar. <button onClick={() => navigate({horizon:'month',snapshot:undefined})}>Ver comparación de 1 mes</button></p>}
    {loading && <p role="status">Cargando datos de mercado…</p>}{error && <p role="alert" className="macro-attention">{error}</p>}
    {!loading && data && <>
      {route.tab === 'panorama' && <><div className="macro-panorama"><div className="macro-charts">{['UST10','DFII10','T10YIE','VIX'].map(chart)}</div>{upcoming}</div><h2 className="macro-section-title">Valores y cambios por mercado</h2>{radar(data.seriesDefinitions)}</>}
      {route.tab === 'drivers' && <><div className="macro-driver-layout"><MacroCurve observations={data.observations} />{chart('T10YIE')}</div><div className="macro-charts">{['UST2','UST10','DFII10','BAMLH0A0HYM2'].map(chart)}</div><h2 className="macro-section-title">Tasas y curva</h2>{radar(data.seriesDefinitions.filter(d=>d.family==='rates'))}</>}
      {route.tab === 'markets' && <><h2 className="macro-section-title">Mercados de EE. UU.</h2>{radar(data.seriesDefinitions.filter(d=>d.family!=='rates' && d.family!=='volatility'))}<p className="macro-coverage">Todavía no hay series de acciones, monedas y materias primas. No se muestran sustitutos.</p><div className="macro-charts">{['BAMLH0A0HYM2','BAMLC0A0CM'].map(chart)}</div></>}
      {route.tab === 'volatility' && <><div className="macro-charts">{['VIX','VVIX','SKEW'].map(chart)}</div>{radar(data.seriesDefinitions.filter(d=>d.family==='volatility'))}</>}
      {route.tab === 'events' && calendar}
      {data.sourceStatuses.filter(s=>s.id.endsWith('calendar') && s.status==='source-error').map(s=><p key={s.id} role="status" className="macro-attention">No se pudo actualizar una fuente del calendario. Los demás eventos siguen disponibles.</p>)}
    </>}
    {route.detail && data && !selected && <p role="alert">El dato de este enlace no está disponible. <button onClick={close}>Cerrar detalle</button></p>}
    {selected && <div className="macro-detail-backdrop"><section className="macro-detail" role="dialog" aria-modal="true" aria-label="Detalle de evidencia" tabIndex={-1} ref={dialog}
      onKeyDown={e=>{ if(e.key==='Escape'){e.preventDefault();close();} if(e.key==='Tab'){const nodes=dialog.current?.querySelectorAll<HTMLElement>('button,a[href],summary');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}} }}>
      <button className="macro-close" onClick={close}>Cerrar · Esc</button><h2>{selected.name}</h2>
      {definition && <><p className="macro-description">{descriptions[definition.id] || 'Serie de referencia del mercado.'}</p><div className="macro-detail-values"><div><span>Último valor</span><strong>{format(lastFor(definition.id)?.value)} {definition.unit}</strong></div><div><span>Cambio en 1 mes</span><strong>{format(metricFor(definition.id)?.value)} {metricFor(definition.id)?.unit}</strong></div></div>
        <p>Dato del {date(lastFor(definition.id)?.observationTime)} · {statusFor(definition)}</p><MacroChart rows={rowsFor(definition.id)} unit={definition.unit} label={definition.name} />
        <p>Comparación: {date(metricFor(definition.id)?.actualFrom)} → {date(metricFor(definition.id)?.actualTo)}.</p>
        {lastFor(definition.id)?.sourceRef && <a href={lastFor(definition.id)!.sourceRef} target="_blank" rel="noreferrer">Ver fuente original ↗</a>}
        <details className="macro-method"><summary>Fuente, fechas y método</summary><p>{definition.source} · {definition.methodologyVersion}</p><p>{metricFor(definition.id)?.limitations.join(' ')}</p><p>Consultado: {lastFor(definition.id)?.retrievedAt || 'No disponible'}. Publicación exacta: {lastFor(definition.id)?.publishedAt || 'Desconocida'}.</p><p>{lastFor(definition.id)?.qualityReasons.join(' ')}</p>{definition.limitations.map(t=><p key={t}>{t}</p>)}<p>Referencia guardada: {data?.id}. Historia revisada; no reconstruye lo conocido en el pasado.</p></details></>}
      {event && <><p className="macro-event-date">{date(event.date)}</p><p>Publicación económica programada. El horario exacto aún no está disponible.</p><a href={event.sourceRef} target="_blank" rel="noreferrer">Ver publicación original ↗</a><details className="macro-method"><summary>Fuente y disponibilidad</summary><p>{event.source} · consulta {event.retrievedAt}</p>{event.limitations.map(t=><p key={t}>{t}</p>)}</details></>}
    </section></div>}
  </div>;
}
