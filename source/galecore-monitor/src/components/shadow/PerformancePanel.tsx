import React, { useEffect, useRef, useState } from 'react';
import type { IChartApi, UTCTimestamp } from 'lightweight-charts';
import { fetchPerformancePanel, fetchShadowStatus } from '../../api/shadow';
import { fetchReferenceCapital } from '../../api/space';
import { Metric, PerformanceGroup, PerformancePanelParams, PerformancePanelResponse, ShadowInstance } from '../../types/shadow';
import { fmtPrice } from '../../utils/formatters';
import { amount, date, days, metricText, missingReasons, pct, rate, readPanelError, stateLabel, usd } from './panelPresentation';
import { PnlCalendar } from './PnlCalendar';
import './PerformancePanel.css';

function MetricValue({ metric, format = fmtPrice, signed = false }: { metric: Metric; format?: (n: number) => string; signed?: boolean }) {
  return <span className="performance-number" style={signed && metric.value !== null ? { color: metric.value < 0 ? 'var(--red-gc)' : metric.value > 0 ? 'var(--green)' : undefined } : undefined}>{metricText(metric, format)}</span>;
}
function Stat({ label, metric, format, signed }: { label: string; metric: Metric; format?: (n: number) => string; signed?: boolean }) {
  return <div className="performance-stat"><div>{label}</div><MetricValue metric={metric} format={format} signed={signed} /></div>;
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="performance-block"><h3>{title}</h3>{children}</section>;
}
function Table({ headers, children, className = '' }: { headers: string[]; children: React.ReactNode; className?: string }) {
  return <div className={`performance-table ${className}`}><table><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
const value = (n: number | null, format: (n: number) => string = amount) => n === null ? 'n/d' : format(n);
function Groups({ title, rows }: { title: string; rows: PerformanceGroup[] }) {
  return <div><h4>{title}</h4><Table headers={['Grupo', 'Operaciones', 'Acierto', 'Promedio USD', 'Realizado USD']}>
    {rows.map(row => <tr key={row.key}><td>{row.key}</td><td>{row.trades}</td><td>{value(row.winRate, rate)}</td><td>{value(row.avgPnl, usd)}</td><td>{value(row.realizedPnl, usd)}</td></tr>)}
    {!rows.length && <tr><td colSpan={5}>Sin operaciones</td></tr>}
  </Table></div>;
}
function QualityRisk({ panel }: { panel: PerformancePanelResponse }) {
  const metrics: [string, Metric, ((n: number) => string)?][] = [
    ['Operaciones cerradas', { value: panel.tradesClosed, reason: null }, n => `${n}`],
    ['Operaciones abiertas', { value: panel.tradesOpen, reason: null }, n => `${n}`],
    ['Ganancia promedio', panel.avgWin, usd], ['Pérdida promedio', panel.avgLoss, usd],
    ['Factor de ganancia', panel.profitFactor], ['Sharpe por operación', panel.sharpe], ['Sortino por operación', panel.sortino],
    ['Duración promedio', panel.avgDaysHeld, days], ['Peor operación', panel.worstTrade, usd],
    ['Racha de pérdidas', panel.lossStreak, n => `${n}`], ['Riesgo máximo abierto', { value: panel.openMaxRisk, reason: null }, amount],
  ];
  const optional: [string, Metric, (n: number) => string][] = [
    ['Retorno SHADOW', panel.references.strategyReturnPct, pct], ['Efectivo', panel.references.cashReturnPct, pct],
    ['Bono 10 a', panel.references.bondReturnPct, pct], ['Objetivo', panel.references.targetReturnPct, pct],
    ['vs efectivo', panel.references.excessVsCashPct, pct], ['vs bono 10 a', panel.references.excessVsBondPct, pct],
    ['vs objetivo', panel.references.excessVsTargetPct, pct], ['Costo de cruce promedio', panel.execution.avgCrossingCost, amount],
    ['Costo de cruce total', panel.execution.totalCrossingCost, amount], ['Realizado medido', panel.execution.realizedMeasured, usd],
    ['Realizado después del cruce', panel.execution.realizedAfterCrossing, usd], ['Acierto después del cruce', panel.execution.winRateAfterCrossing, rate],
  ];
  return <Table className="quality-risk-table" headers={['Métrica', 'Valor']}>
    {[...metrics, ...optional.filter(([, metric]) => metric.value !== null)].map(([label, metric, format]) => <tr key={label}><td>{label}</td><td>{metricText(metric, format)}</td></tr>)}
    {panel.openRiskVsLimits?.map(limit => <tr key={limit.limit}><td>{limit.limit} · {limit.ok ? 'Dentro del límite' : 'Excede el límite'}</td><td><div>{amount(limit.used)} / {amount(limit.max)}</div><progress aria-label={limit.limit} value={limit.used} max={limit.max} /><div>Margen: {amount(limit.headroom)}</div></td></tr>)}
    {panel.hypothesis.tradesRequired !== null && <tr><td>Muestra · operaciones</td><td>{panel.hypothesis.tradesClosed} / {panel.hypothesis.tradesRequired}</td></tr>}
    {panel.hypothesis.daysRequired !== null && <tr><td>Muestra · período</td><td>{value(panel.hypothesis.daysElapsed, days)} / {days(panel.hypothesis.daysRequired)}</td></tr>}
  </Table>;
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
  </>;
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
    fetchReferenceCapital().then(value => { if (active) { setCapital(value); setProfileReady(true); } });
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
    }).catch(e => { if (active) setError(readPanelError(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [spec, capital, profileReady, version, period, from, to, retry]);

  return <div className="performance-panel" aria-label="Panel de rendimiento SHADOW">
    <header className="performance-heading">
      <div><h2>{spec}</h2><div className="performance-chips"><span className="performance-mode" title={panel?.source}>SHADOW · simulado</span>{instance && <span className="performance-chip" title={date(instance.updatedAt)}>{stateLabel(instance.lifecycleState)}</span>}{statusError && <span>{statusError}</span>}{panel?.smallSample && <span className="performance-chip warning" title={panel.notes.join(' · ')}>Muestra chica</span>}<time>{panel && date(panel.asOf)}</time></div></div>
      <div className="performance-filters">
        <label>Versión<select value={version} onChange={e => setVersion(e.target.value)}><option value="">Todas</option>{versions.map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Período<select value={period} onChange={e => setPeriod(e.target.value)}><option value="all">Todo</option><option value="30">30 d</option><option value="90">90 d</option><option value="custom">Personalizado</option></select></label>
        {period === 'custom' && <><label>Desde (UTC)<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Hasta (UTC)<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></>}
        <button onClick={() => setRetry(n => n + 1)}>Actualizar</button>
      </div>
    </header>
    {loading && <p role="status">Cargando rendimiento…</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>Reintentar</button></div>}
    {panel && !loading && !error && <>
      <div className="performance-key-numbers"><Stat label="Realizado" metric={panel.realizedPnl} format={usd} signed /><Stat label="Abierto" metric={panel.unrealizedPnl} format={usd} signed /><Stat label="Máx. caída" metric={panel.maxDrawdown} format={amount} /><Stat label="Acierto" metric={panel.winRate} format={rate} /><Stat label="Esperanza/op." metric={panel.expectancy} format={usd} signed /></div>
      <Block title="Evolución"><Curve rows={panel.curve} /></Block>
      <Block title="Calendario de P&L"><PnlCalendar daily={panel.daily ?? []} asOf={panel.asOf} /></Block>
      <Block title="Posiciones abiertas"><Table headers={['Estructura / strikes', 'Versión', 'Entrada', 'DTE entrada / actual', 'Crédito', 'Valor actual', 'P&L abierto', 'Riesgo']}>
        {(panel.openPositions ?? []).map(position => <tr key={position.positionId}><td><strong>{position.structure}</strong><div>{position.legs}</div></td><td>{position.version}</td><td>{date(position.entryAt)}</td><td>{position.entryDte} / {value(position.currentDte, n => `${n}`)}</td><td>{amount(position.entryCredit)}</td><td title={position.valuationProblems?.join(' · ') || `Valuado: ${date(position.lastValuedAt)}`}>{value(position.lastSpreadValue)}</td><td>{value(position.unrealizedPnl, usd)}</td><td>{amount(position.maxRisk)}</td></tr>)}
        {!panel.openPositions?.length && <tr><td colSpan={8}>Sin posiciones abiertas</td></tr>}
      </Table></Block>
      <Block title="Salidas"><div className="exit-bars">{panel.byExitRule.map(rule => <div className="exit-bar" key={rule.key}><strong>{rule.key}</strong><meter min={0} max={Math.max(1, ...panel.byExitRule.map(row => row.trades))} value={rule.trades} aria-label={`Salidas ${rule.key}`} /><span>{rule.trades} operaciones</span><span className="font-mono">{value(rule.realizedPnl, usd)}</span></div>)}</div>
        <Table headers={['Estructura / strikes', 'Versión', 'Entrada', 'Salida', 'Días', 'Motivo', 'Crédito / débito', 'P&L']}>
          {(panel.closedTrades ?? []).map(trade => <tr key={trade.positionId}><td><strong>{trade.structure}</strong><div>{trade.legs}</div></td><td>{trade.version}</td><td>{date(trade.entryAt)}</td><td>{date(trade.exitAt)}</td><td>{value(trade.daysHeld, days)}</td><td>{trade.exitReason || 'n/d'}</td><td>{amount(trade.entryCredit)} / {value(trade.exitDebit)}</td><td>{value(trade.realizedPnl, usd)}</td></tr>)}
          {!panel.closedTrades?.length && <tr><td colSpan={8}>Sin salidas en el período</td></tr>}
        </Table>
      </Block>
      <Block title="Calidad y riesgo"><QualityRisk panel={panel} /></Block>
      <Block title="Régimen y versión">{!panel.regime.byVix.length && !panel.regime.byIvRank.length && !panel.regime.byGamma.length ? <p>{panel.regime.tradesWithoutContext} cerradas sin contexto de régimen</p> : <><Groups title="VIX" rows={panel.regime.byVix} /><Groups title="IV Rank" rows={panel.regime.byIvRank} /><Groups title="Gamma" rows={panel.regime.byGamma} />{panel.regime.tradesWithoutContext > 0 && <p>{panel.regime.tradesWithoutContext} cerradas sin contexto de régimen</p>}</>}<Groups title="Versión" rows={panel.byVersion} /></Block>
      <Block title="Qué falta"><ul className="performance-missing">{missingReasons(panel).map(reason => <li key={reason}>{reason}</li>)}</ul></Block>
    </>}
  </div>;
}
