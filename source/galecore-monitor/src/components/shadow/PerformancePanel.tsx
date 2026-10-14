import React, { useEffect, useRef, useState } from 'react';
import type { IChartApi, UTCTimestamp, Time, TickMarkType as ChartTickMarkType } from 'lightweight-charts';
import { fetchPerformancePanel } from '../../api/shadow';
import { Metric, PerformanceGroup, PerformancePanelParams, PerformancePanelResponse, ShadowInstance } from '../../types/shadow';
import { fmtPrice, fmtTime, MARKET_TZ } from '../../utils/formatters';
import { amount, date, days, exitLabel, metricText, pct, rate, readPanelError, usd } from './panelPresentation';
import { LivePositionRow } from '../positions/PositionRow';
import { PnlCalendar } from './PnlCalendar';
import { InstanceState } from './InstanceState';
import { StrategyDesign } from './StrategyDesign';
import { TradeLog } from './TradeLog';
import './PerformancePanel.css';

function Stat({ label, definition, metric, format = fmtPrice, signed = false }: { label: string; definition: string; metric: Metric; format?: (n: number) => string; signed?: boolean }) {
  return <div className="performance-stat" title={metric.value === null ? metric.reason || definition : definition}><div>{label}</div><span className="performance-number" style={signed && metric.value !== null ? { color: metric.value < 0 ? 'var(--red-gc)' : metric.value > 0 ? 'var(--green)' : undefined } : undefined}>{metricText(metric, format)}</span></div>;
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="performance-block"><h3>{title}</h3>{children}</section>;
}
function Table({ headers, children, className = '' }: { headers: string[]; children: React.ReactNode; className?: string }) {
  return <div className={`performance-table ${className}`}><table><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
const value = (n: number | null, format: (n: number) => string = amount) => n === null ? '—' : format(n);
function Groups({ title, rows }: { title: string; rows: PerformanceGroup[] }) {
  return <div><h4>{title}</h4><Table headers={['Grupo', 'Operaciones', 'Acierto', 'Promedio USD', 'Realizado USD']}>
    {rows.map(row => <tr key={row.key}><td>{row.key}</td><td>{row.trades}</td><td>{value(row.winRate, rate)}</td><td>{value(row.avgPnl, usd)}</td><td>{value(row.realizedPnl, usd)}</td></tr>)}
    {!rows.length && <tr><td colSpan={5}>Sin operaciones</td></tr>}
  </Table></div>;
}
function Curve({ rows }: { rows: PerformancePanelResponse['curve'] }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!host.current || !rows.length) return;
    let chart: IChartApi | undefined;
    let active = true;
    setError(false);
    void import('lightweight-charts').then(({ createChart, LineSeries, AreaSeries, ColorType, TickMarkType }) => {
      if (!active || !host.current) return;
      const css = getComputedStyle(host.current);
      const color = (token: string) => css.getPropertyValue(token).trim();
      chart = createChart(host.current, { autoSize: true, height: 360,
        layout: { background: { type: ColorType.Solid, color: color('--bg-secondary') }, textColor: color('--text-primary'), fontFamily: color('--font-sans'), fontSize: 14, panes: { separatorColor: color('--border') } },
        grid: { vertLines: { visible: false }, horzLines: { color: color('--border-dark') } },
        handleScroll: { mouseWheel: false }, handleScale: { mouseWheel: false },
        timeScale: { timeVisible: true, secondsVisible: true, tickMarkFormatter: (time: Time, type: ChartTickMarkType) => {
          if (typeof time !== 'number') return null;
          const at = new Date(time * 1000);
          if (type === TickMarkType.Time) return `${fmtTime(at).slice(0, 5)} ET`;
          if (type === TickMarkType.TimeWithSeconds) return `${fmtTime(at)} ET`;
          return at.toLocaleDateString('es-AR', { timeZone: MARKET_TZ,
            ...(type === TickMarkType.Year ? { year: 'numeric' } : type === TickMarkType.Month ? { month: 'short' } : { day: 'numeric', month: 'short' }) });
        } },
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
export function PerformancePanel({ spec, instance = null, referenceCapital, runtime }: { spec: string; instance?: ShadowInstance | null; referenceCapital?: number; runtime?: React.ReactNode }) {
  const [panel, setPanel] = useState<PerformancePanelResponse | null>(null);
  const [versions, setVersions] = useState<string[]>([]);
  const [version, setVersion] = useState('');
  const [period, setPeriod] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Resumen');
  const [designOpened, setDesignOpened] = useState(false);
  const request = useRef<{ key: string; promise: Promise<PerformancePanelResponse> } | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setError(''); setLoading(true);
    const params: PerformancePanelParams = { spec, ...(referenceCapital !== undefined ? { referenceCapital } : {}) };
    if (version) params.version = version;
    if (period === 'custom') {
      if (from && to && from > to) { setError('La fecha desde debe ser anterior a la fecha hasta.'); setLoading(false); return; }
      if (from) params.from = `${from}T00:00:00.000Z`;
      if (to) params.to = `${to}T23:59:59.999Z`;
    } else if (period !== 'all') {
      const end = new Date(); params.to = end.toISOString();
      params.from = new Date(end.getTime() - Number(period) * 86400000).toISOString();
    }
    const key = JSON.stringify([spec, referenceCapital, version, period, from, to, retry]);
    if (request.current?.key !== key) request.current = { key, promise: fetchPerformancePanel(params) };
    request.current.promise.then(data => {
      if (active) { setPanel(data); if (!version && period === 'all') setVersions(data.byVersion.map(v => v.key)); }
    }).catch(e => { if (active) setError(readPanelError(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [spec, referenceCapital, version, period, from, to, retry]);
  const count = (n: number): Metric => ({ value: n, reason: null });
  const integer = (n: number) => `${n}`;
  const stat = (label: string, definition: string, metric: Metric, format: (n: number) => string = fmtPrice, signed = false) => <Stat key={label} label={label} definition={definition} metric={metric} format={format} signed={signed} />;
  const minimum = panel?.notes.map(note => /mínimo (\d+)/i.exec(note)?.[1]).find(Boolean);
  return <div className="performance-panel" aria-label="Panel de rendimiento">
    <header className="performance-heading"><div><h2>{spec}</h2><InstanceState instance={instance} /></div><div className="performance-filters">
      <label>Versión<select value={version} onChange={e => setVersion(e.target.value)}><option value="">Todas las versiones</option>{versions.map(v => <option key={v}>{v}</option>)}</select></label>
      <label>Período<select value={period} onChange={e => setPeriod(e.target.value)}><option value="all">Desde el inicio</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="custom">Elegir fechas</option></select></label>
      {period === 'custom' && <><label>Desde<input title="Fecha inicial en UTC" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Hasta<input title="Fecha final en UTC" type="date" value={to} onChange={e => setTo(e.target.value)} /></label></>}
    </div></header>
    <div className="performance-tabs" role="tablist" aria-label="Seguimiento de la estrategia">{['Resumen', 'Operaciones', 'Diseño'].map(name => <button key={name} id={`tab-${name}`} role="tab" aria-selected={tab === name} aria-controls={`pane-${name}`} onClick={() => { setTab(name); if (name === 'Diseño') setDesignOpened(true); }}>{name}</button>)}</div>
    {tab !== 'Diseño' && loading && <div role="status" aria-label="Cargando rendimiento" className="performance-loading"><div className="performance-metrics">{Array.from({ length: 12 }, (_, i) => <div key={i} className="performance-skeleton metric-skeleton" />)}</div><div className="performance-skeleton chart-skeleton" /></div>}
    {tab !== 'Diseño' && error && <div role="alert"><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>Reintentar</button></div>}
    {panel && !loading && !error && tab === 'Resumen' && <div role="tabpanel" id="pane-Resumen" aria-labelledby="tab-Resumen">
      {panel.smallSample && <p className="sample-notice">{minimum ? `Pocas operaciones: ${panel.tradesClosed} de ${minimum} para que Sharpe y Sortino sean confiables` : panel.notes.join(' ')}</p>}
      <div className="metric-overview" aria-label="Métricas de rendimiento">
        <div className="performance-highlights">
          {stat('Ganancia total', 'Resultado acumulado de las operaciones cerradas.', panel.realizedPnl, usd, true)}
          {stat('% ganadoras', 'Proporción de operaciones cerradas que ganaron.', panel.winRate, rate)}
          {stat('Promedio por operación', 'Resultado promedio de todas las operaciones cerradas.', panel.expectancy, usd, true)}
          {stat('Máxima caída', 'Mayor caída del resultado acumulado desde su máximo anterior.', panel.maxDrawdown, amount)}
        </div>
        <div className="metric-columns">
        <section><h3>Resultado</h3><div className="metric-rows">
          {stat('Resultado de las abiertas', 'Ganancia o pérdida de las posiciones que siguen abiertas.', panel.unrealizedPnl, usd, true)}
          {stat('Ganancia bruta', 'Suma de los resultados positivos de las operaciones cerradas.', panel.grossProfit, amount)}
          {stat('Pérdida bruta', 'Suma de las pérdidas de las operaciones cerradas.', panel.grossLoss, amount)}
          {stat('Retorno sobre capital', 'Resultado cerrado dividido por el capital de referencia.', panel.references.strategyReturnPct, pct, true)}
        </div></section>
        <section><h3>Operaciones</h3><div className="metric-rows">
          {stat('Cerradas', 'Cantidad de operaciones que ya terminaron.', count(panel.tradesClosed), integer)}
          {stat('Abiertas', 'Cantidad de posiciones que siguen abiertas.', count(panel.tradesOpen), integer)}
          {stat('Ganadoras', 'Operaciones cerradas con resultado positivo.', count(panel.tradesWon), integer)}
          {stat('Perdedoras', 'Operaciones cerradas con resultado negativo.', count(panel.tradesLost), integer)}
          {stat('Días promedio', 'Tiempo promedio entre la entrada y la salida.', panel.avgDaysHeld, days)}
          {panel.byExitRule.map(rule => stat(exitLabel(rule.key), `Operaciones cerradas por ${exitLabel(rule.key)}.`, count(rule.trades), integer))}
        </div></section>
        <section><h3>Por operación</h3><div className="metric-rows">
          {stat('Ganancia promedio', 'Resultado promedio de las operaciones ganadoras.', panel.avgWin, usd, true)}
          {stat('Pérdida promedio', 'Resultado promedio de las operaciones perdedoras.', panel.avgLoss, usd, true)}
          {stat('Mayor ganancia', 'Mejor resultado de una operación cerrada.', panel.largestWin, usd, true)}
          {stat('Peor operación', 'Peor resultado de una operación cerrada.', panel.worstTrade, usd, true)}
          {stat('Ganancia/pérdida promedio', 'Relación entre la ganancia promedio y la pérdida promedio.', panel.winLossRatio)}
        </div></section>
        <section><h3>Riesgo y calidad</h3><div className="metric-rows">
          {stat('Factor de ganancia', 'Ganancia bruta dividida por la pérdida bruta.', panel.profitFactor)}
          {stat('Sharpe', 'Resultado por operación ajustado por su variabilidad.', panel.sharpe)}
          {stat('Sortino', 'Resultado por operación ajustado por la variabilidad de las pérdidas.', panel.sortino)}
          {stat('Racha de pérdidas', 'Mayor cantidad de operaciones perdedoras consecutivas.', panel.lossStreak, integer)}
          {stat('Riesgo abierto', 'Riesgo máximo de las posiciones abiertas.', count(panel.openMaxRisk), amount)}
        </div></section>
        </div>
      </div>
      <div className="performance-visuals"><Block title="Evolución"><Curve rows={panel.curve} /></Block><Block title="Calendario"><PnlCalendar daily={panel.daily} asOf={panel.asOf} /></Block></div>
      <Block title="Posiciones abiertas">{panel.openPositions.map(position => <LivePositionRow key={position.positionId} position={{ structure: position.structure, symbol: position.symbol, expiration: position.legList[0]?.expiration ?? null, dte: position.currentDte, legs: position.legList, entryAt: position.entryAt, credit: position.entryCredit, currentValue: position.lastSpreadValue, pnl: position.unrealizedPnl, risk: position.maxRisk, reason: position.valuationProblems?.join(' · ') }} />)}{!panel.openPositions.length && <p>Sin posiciones abiertas</p>}</Block>
    </div>}
    {panel && !loading && !error && tab === 'Operaciones' && <div role="tabpanel" id="pane-Operaciones" aria-labelledby="tab-Operaciones">
      <Block title="Salidas"><div className="exit-bars">{panel.byExitRule.map(rule => <div className="exit-bar" key={rule.key}><strong>{exitLabel(rule.key)}</strong><meter min={0} max={Math.max(1, ...panel.byExitRule.map(row => row.trades))} value={rule.trades} aria-label={`Salidas ${exitLabel(rule.key)}`} /><span>{rule.trades} operaciones</span><span className="font-mono">{value(rule.realizedPnl, usd)}</span></div>)}</div></Block>
      <TradeLog trades={panel.closedTrades} spec={spec} />
      <Block title="Régimen y versión"><Groups title="VIX" rows={panel.regime.byVix} /><Groups title="IV Rank" rows={panel.regime.byIvRank} /><Groups title="Gamma" rows={panel.regime.byGamma} />{panel.regime.tradesWithoutContext > 0 && <p>{panel.regime.tradesWithoutContext} cerradas sin contexto de régimen</p>}<Groups title="Versión" rows={panel.byVersion} /></Block>
      {runtime}
    </div>}
    {designOpened && <div role="tabpanel" id="pane-Diseño" aria-labelledby="tab-Diseño" hidden={tab !== 'Diseño'}><StrategyDesign spec={spec} /></div>}
  </div>;
}
