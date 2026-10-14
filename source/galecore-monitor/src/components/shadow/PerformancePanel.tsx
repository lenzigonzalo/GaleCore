import React, { useEffect, useRef, useState } from 'react';
import type { IChartApi, UTCTimestamp } from 'lightweight-charts';
import { fetchPerformancePanel, fetchShadowStatus } from '../../api/shadow';
import { fetchSpace } from '../../api/space';
import { Metric, PerformanceGroup, PerformancePanelParams, PerformancePanelResponse, ShadowInstance } from '../../types/shadow';
import { fmtPnl, fmtPct, fmtPrice, fmtTime, MARKET_TZ } from '../../utils/formatters';
import './PerformancePanel.css';

const usd = (n: number) => fmtPnl(n).replace('-', '−');
const amount = (n: number) => usd(n).replace(/^\+/, '');
const lifecycleLabel: Record<string, string> = { RUNNING: 'corriendo', PAUSED: 'pausada', STOPPED: 'detenida' };
const pct = (n: number) => fmtPct(n, 1).replace('-', '−');
const rate = (n: number) => pct(n * 100);
const days = (n: number) => `${fmtPrice(n, 1)} d`;
const date = (iso: string | null) => iso ? `${new Date(iso).toLocaleDateString('es-AR', { timeZone: MARKET_TZ })} ${fmtTime(new Date(iso))} ET` : 'sin fecha registrada';

function MetricValue({ metric, format = fmtPrice, signed = false }: { metric: Metric; format?: (n: number) => string; signed?: boolean }) {
  return metric.value === null ? <span className="performance-reason">{metric.reason?.trim() || 'sin dato'}</span>
    : <span className="performance-number" style={signed ? { color: metric.value < 0 ? 'var(--red-gc)' : metric.value > 0 ? 'var(--green)' : undefined } : undefined}>{format(metric.value)}</span>;
}
function Stat({ label, metric, format, signed }: { label: string; metric: Metric; format?: (n: number) => string; signed?: boolean }) {
  return <div className="performance-stat"><div>{label}</div><MetricValue metric={metric} format={format} signed={signed} /></div>;
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="performance-block"><h3>{title}</h3>{children}</section>;
}
function Curve({ rows }: { rows: PerformancePanelResponse['curve'] }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!host.current || !rows.length) return;
    let chart: IChartApi | undefined;
    let active = true;
    setError(false);
    void import('lightweight-charts').then(({ createChart, LineSeries, AreaSeries, ColorType }) => {
      if (!active || !host.current) return;
      const css = getComputedStyle(host.current);
      const color = (token: string) => css.getPropertyValue(token).trim();
      chart = createChart(host.current, { autoSize: true, height: 360,
        layout: { background: { type: ColorType.Solid, color: color('--bg-secondary') }, textColor: color('--text-primary'), fontSize: 14, panes: { separatorColor: color('--border') } },
        grid: { vertLines: { visible: false }, horzLines: { color: color('--border-dark') } },
        timeScale: { timeVisible: true, secondsVisible: true },
        localization: { timeFormatter: (time: number) => date(new Date(time * 1000).toISOString()) } });
      const cumulative = chart.addSeries(LineSeries, { color: color('--green'), lineWidth: 3, title: 'Acumulado USD', priceFormat: { type: 'custom', formatter: usd } });
      const drawdown = chart.addSeries(AreaSeries, { lineColor: color('--red-gc'), topColor: color('--red-muted'), bottomColor: color('--bg-secondary'), title: 'Caída USD', priceFormat: { type: 'custom', formatter: amount } }, 1);
      // Preserve every exit, including sub-second timestamps; no aggregation in the UI.
      const time = (at: string) => (new Date(at).getTime() / 1000) as UTCTimestamp;
      cumulative.setData(rows.map(r => ({ time: time(r.at), value: r.cumulative })));
      drawdown.setData(rows.map(r => ({ time: time(r.at), value: r.drawdown })));
      chart.timeScale().fitContent();
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; chart?.remove(); };
  }, [rows]);
  return !rows.length ? <p>Sin operaciones cerradas para la curva.</p> : <>
    <div ref={host} style={{ height: 360, width: '100%' }} role="img" aria-label="Resultado acumulado y caída en USD" />
    {error && <p role="alert">No se pudo mostrar la curva.</p>}
    <details><summary>Datos de la curva</summary><table><thead><tr><th>Salida</th><th>Resultado</th><th>Acumulado</th><th>Caída</th></tr></thead><tbody>{rows.map(r => <tr key={r.at}><td>{date(r.at)}</td><td>{usd(r.pnl)}</td><td>{usd(r.cumulative)}</td><td>{amount(r.drawdown)}</td></tr>)}</tbody></table></details>
  </>;
}
function Groups({ title, rows, exit = false }: { title: string; rows: PerformanceGroup[]; exit?: boolean }) {
  return <div className="performance-groups"><h4>{title}</h4>{rows.length ? <div className="performance-table"><table><thead><tr>{['Grupo', 'Operaciones', 'Acierto', 'Promedio USD', 'Realizado USD', ...(exit ? ['Desvío al plan USD'] : [])].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.key}><td>{r.key}</td><td>{r.trades}</td><td>{r.winRate === null ? 'sin dato' : rate(r.winRate)}</td><td>{r.avgPnl === null ? 'sin dato' : usd(r.avgPnl)}</td><td>{usd(r.realizedPnl)}</td>{exit && <td>{r.avgGapToPlan === null ? 'sin dato' : amount(r.avgGapToPlan)}</td>}</tr>)}</tbody></table></div> : <p>Sin operaciones con este contexto.</p>}</div>;
}
function readError(error: unknown): string {
  const e = error as { response?: { status?: number }; message?: string };
  if (e.response?.status === 404) return 'Esta estrategia todavía no tiene posiciones SHADOW';
  if (e.response?.status === 503) return 'SHADOW no tiene persistencia disponible';
  if (/timeout|aborted/i.test(e.message || '')) return 'El panel tardó demasiado en responder. No pudimos comprobar su estado; reintentá la lectura.';
  return e.message || 'No se pudo leer el panel de rendimiento.';
}

export function PerformancePanel({ spec }: { spec: string }) {
  const [panel, setPanel] = useState<PerformancePanelResponse | null>(null);
  const [instance, setInstance] = useState<ShadowInstance | null>(null);
  const [statusError, setStatusError] = useState('');
  const [capital, setCapital] = useState<number | undefined>();
  const [profileReady, setProfileReady] = useState(false);
  const [versions, setVersions] = useState<string[]>([]);
  const [version, setVersion] = useState('');
  const [period, setPeriod] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    fetchSpace().then(space => {
      const profile = space.items.find(i => i.kind === 'profile' && i.isOwn);
      if (!profile) return;
      try {
        const cap = JSON.parse(profile.content)?.reference_capital;
        if (active && cap?.currency === 'USD' && typeof cap.amount === 'number' && Number.isFinite(cap.amount)) setCapital(cap.amount);
      } catch { /* Invalid profile: the API provides the missing-capital reason. */ }
    }).catch(() => {}).finally(() => { if (active) setProfileReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setInstance(null); setStatusError('');
    fetchShadowStatus().then(status => {
      if (!active) return;
      const matches = status.instances.filter(i => i.specName === spec);
      setInstance(matches.find(i => i.lifecycleState === 'RUNNING') ?? matches[matches.length - 1] ?? null);
    }).catch(() => { if (active) setStatusError('No se pudo leer el estado de la instancia.'); });
    return () => { active = false; };
  }, [spec, retry]);
  useEffect(() => {
    if (!profileReady) return;
    let active = true;
    setPanel(null); setError(''); setLoading(true);
    const params: PerformancePanelParams = { spec, ...(capital !== undefined ? { referenceCapital: capital } : {}) };
    if (version) params.version = version;
    if (period === 'custom') {
      if (from && to && from > to) { setError('La fecha desde debe ser anterior a la fecha hasta.'); setLoading(false); return; }
      if (from) params.from = `${from}T00:00:00.000Z`;
      if (to) params.to = `${to}T23:59:59.999Z`;
    } else if (period !== 'all') {
      const end = new Date();
      params.to = end.toISOString();
      params.from = new Date(end.getTime() - Number(period) * 86400000).toISOString();
    }
    // Version choices always come from the unfiltered response.
    const choices = version || period !== 'all' ? fetchPerformancePanel({ spec, ...(capital !== undefined ? { referenceCapital: capital } : {}) }) : null;
    choices?.then(data => { if (active) setVersions(data.byVersion.map(v => v.key)); }).catch(() => {});
    fetchPerformancePanel(params).then(data => {
      if (active) { setPanel(data); if (!choices) setVersions(data.byVersion.map(v => v.key)); }
    }).catch(e => { if (active) setError(readError(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [spec, capital, profileReady, version, period, from, to, retry]);

  return <div className="performance-panel" aria-label="Panel de rendimiento SHADOW">
    <div className="performance-filters">
      <label>Versión<select value={version} onChange={e => setVersion(e.target.value)}><option value="">Todas</option>{versions.map(v => <option key={v}>{v}</option>)}</select></label>
      <label>Período<select value={period} onChange={e => setPeriod(e.target.value)}><option value="all">Todo</option><option value="30">30 d</option><option value="90">90 d</option><option value="custom">Personalizado</option></select></label>
      {period === 'custom' && <><label>Desde (UTC)<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Hasta (UTC)<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></>}
      <button onClick={() => setRetry(n => n + 1)}>Actualizar panel</button>
    </div>
    {loading && <p role="status">Cargando rendimiento…</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>Reintentar</button></div>}
    {panel && !loading && !error && <>
      <header><span className="performance-mode">SHADOW · simulado</span><h2>{panel.spec}</h2>
        <div className="performance-meta"><span>{panel.version ? `v${panel.version}` : 'Todas las versiones'}</span><span>{instance ? `${lifecycleLabel[instance.lifecycleState] ?? instance.lifecycleState} · ${date(instance.updatedAt)}` : statusError || 'Sin instancia registrada'}</span><span>Al {date(panel.asOf)}</span></div>
        <div className="performance-meta"><span>{panel.tradesClosed} cerradas · {panel.tradesOpen} abiertas</span><span>Primera salida: {date(panel.firstExitAt)}</span><span>Última salida: {date(panel.lastExitAt)}</span></div>
        <details><summary>Fuente</summary>{panel.source}</details>
      </header>
      {(panel.smallSample || panel.notes.length > 0) && <div className="performance-warning">{panel.smallSample && !panel.notes.length && <p>Muestra chica</p>}{panel.notes.map((n, i) => <p key={i}>{n}</p>)}</div>}
      <Block title="Resultado"><div className="performance-grid"><Stat label="Realizado" metric={panel.realizedPnl} format={usd} signed /><Stat label="No realizado" metric={panel.unrealizedPnl} format={usd} signed /><Stat label="Máxima caída" metric={panel.maxDrawdown} format={amount} /></div><Curve rows={panel.curve} />
        <h4>Referencias · {days(panel.references.periodDays)}</h4><div className="performance-grid"><Stat label="Retorno SHADOW" metric={panel.references.strategyReturnPct} format={pct} signed />
          <Stat label="Efectivo" metric={panel.references.cashReturnPct} format={pct} /><Stat label="Bono 10 a" metric={panel.references.bondReturnPct} format={pct} /><Stat label="Objetivo" metric={panel.references.targetReturnPct} format={pct} />
          <Stat label="vs efectivo" metric={panel.references.excessVsCashPct} format={pct} signed /><Stat label="vs bono 10 a" metric={panel.references.excessVsBondPct} format={pct} signed /><Stat label="vs objetivo" metric={panel.references.excessVsTargetPct} format={pct} signed /></div>
      </Block>
      <Block title="Calidad"><div className="performance-grid"><Stat label="Operaciones cerradas" metric={{ value: panel.tradesClosed, reason: null }} format={n => `${n}`} /><Stat label="Acierto" metric={panel.winRate} format={rate} /><Stat label="Ganancia promedio" metric={panel.avgWin} format={usd} signed /><Stat label="Pérdida promedio" metric={panel.avgLoss} format={usd} signed /><Stat label="Factor de ganancia" metric={panel.profitFactor} /><Stat label="Esperanza por operación" metric={panel.expectancy} format={usd} signed /><Stat label="Sharpe por operación" metric={panel.sharpe} /><Stat label="Sortino por operación" metric={panel.sortino} /><Stat label="Duración promedio" metric={panel.avgDaysHeld} format={days} /></div></Block>
      <Block title="Riesgo"><div className="performance-grid"><Stat label="Riesgo máximo abierto" metric={{ value: panel.openMaxRisk, reason: null }} format={amount} /><Stat label="Peor operación" metric={panel.worstTrade} format={usd} signed /><Stat label="Racha de pérdidas" metric={panel.lossStreak} format={n => `${n}`} /></div>
        {panel.openRiskVsLimits === null ? <p>{panel.openRiskVsLimitsReason || 'sin dato'}</p> : panel.openRiskVsLimits.map(l => <div className="performance-limit" key={l.limit}><strong>{l.limit} · {l.ok ? 'Dentro del límite' : 'Excede el límite'}</strong><div className="performance-number">{amount(l.used)} / {amount(l.max)}</div><progress aria-label={l.limit} value={l.used} max={l.max} style={{ accentColor: l.ok ? 'var(--green)' : 'var(--red-gc)' }} /><div>Margen: {amount(l.headroom)}</div></div>)}
      </Block>
      <Block title="Dónde gana y dónde pierde"><p>{panel.regime.edges}</p>{panel.regime.reason && <p>{panel.regime.reason}</p>}<p>{panel.regime.tradesWithoutContext} cerradas sin contexto</p><Groups title="VIX" rows={panel.regime.byVix} /><Groups title="IV Rank" rows={panel.regime.byIvRank} /><Groups title="Gamma" rows={panel.regime.byGamma} /><Groups title="Regla de salida" rows={panel.byExitRule} exit /><Groups title="Versión" rows={panel.byVersion} /></Block>
      <Block title="Hipótesis">{panel.hypothesis.reason ? <p>{panel.hypothesis.reason}</p> : <div className="performance-grid"><div className="performance-stat">Operaciones<div className="performance-number">{panel.hypothesis.tradesClosed} / {panel.hypothesis.tradesRequired ?? 'sin criterio'}</div></div><div className="performance-stat">Período<div className="performance-number">{days(panel.hypothesis.daysElapsed)} / {panel.hypothesis.daysRequired === null ? 'sin criterio' : days(panel.hypothesis.daysRequired)}</div></div><div className="performance-stat">Muestra<div>{panel.hypothesis.sampleReached === null ? 'sin criterio' : panel.hypothesis.sampleReached ? 'Alcanzada' : 'Pendiente'}</div></div></div>}<p>Mide la muestra, no dice si hay edge.</p></Block>
      <Block title="Ejecución"><div className="performance-meta"><span>{panel.execution.tradesMeasured} medidas</span><span>{panel.execution.tradesWithoutQuotes} cerradas sin cotizaciones</span></div><div className="performance-grid"><Stat label="Costo de cruce promedio" metric={panel.execution.avgCrossingCost} format={amount} /><Stat label="Costo de cruce total" metric={panel.execution.totalCrossingCost} format={amount} /><Stat label="Realizado medido" metric={panel.execution.realizedMeasured} format={usd} signed /><Stat label="Realizado después del cruce" metric={panel.execution.realizedAfterCrossing} format={usd} signed /><Stat label="Acierto después del cruce" metric={panel.execution.winRateAfterCrossing} format={rate} /></div><p>{panel.execution.notIncluded}</p></Block>
    </>}
  </div>;
}
