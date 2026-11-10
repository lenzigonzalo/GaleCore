import React, { useEffect, useRef, useState } from 'react';
import type { IChartApi, UTCTimestamp, Time, TickMarkType as ChartTickMarkType } from 'lightweight-charts';
import { fetchPerformancePanel } from '../../api/shadow';
import { Metric, PerformancePanelParams, PerformancePanelResponse, ShadowInstance } from '../../types/shadow';
import { fmtPrice, fmtTime, MARKET_TZ } from '../../utils/formatters';
import { amount, date, days, exitLabel, metricText, pct, rate, readPanelError, usd, strategyName } from './panelPresentation';
import { LivePositionRow } from '../positions/PositionRow';
import { PnlCalendar } from './PnlCalendar';
import { InstanceState } from './InstanceState';
import { StrategyOverview } from './StrategyOverview';
import { StageModeChip, StrategyHeader } from './StrategyHeader';
import { StrategyData } from './StrategyData';
import type { AlgorithmSpec } from './CompactStrategyDesign';
import { StrategyDesign, useStrategyDesign } from './StrategyDesign';
import { TradeLog } from './TradeLog';
import { EntryEvaluations } from './EntryEvaluations';
import { StrategyStatusBar } from './StrategyStatusBar';
import { WhyNotOperating } from './WhyNotOperating';
import { RegistryLog } from './RegistryLog';
import './PerformancePanel.css';

function Stat({ label, definition, metric, format = fmtPrice, signed = false }: { label: string; definition: string; metric: Metric; format?: (n: number) => string; signed?: boolean }) {
  return <div className="performance-stat" title={metric.value === null ? metric.reason || definition : definition}><div>{label}</div><span className="performance-number" style={signed && metric.value !== null ? { color: metric.value < 0 ? 'var(--red-gc)' : metric.value > 0 ? 'var(--green)' : undefined } : undefined}>{metricText(metric, format)}</span></div>;
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
export function PerformancePanel({ spec, instance = null, instances, onInstanceChange, referenceCapital, runtime, onOpenChat, inDesign = false, onBack, stage, mode }: { instances?: ShadowInstance[]; onInstanceChange?: () => Promise<void> | void; onOpenChat?: (projectId: string) => void; inDesign?: boolean; onBack?: () => void; stage?: string; mode?: string; spec: string; instance?: ShadowInstance | null; referenceCapital?: number; runtime?: React.ReactNode }) {
  const [panel, setPanel] = useState<PerformancePanelResponse | null>(null);
  const [versions, setVersions] = useState<string[]>([]);
  const [version, setVersion] = useState('');
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(inDesign ? 'Reglas' : 'Resumen');
  const design = useStrategyDesign(spec);
  const request = useRef<{ key: string; promise: Promise<PerformancePanelResponse> } | undefined>(undefined);
  useEffect(() => {
    if (inDesign) { setLoading(false); return; }
    let active = true;
    setError(''); setLoading(true);
    const params: PerformancePanelParams = { spec, ...(referenceCapital !== undefined ? { referenceCapital } : {}) };
    if (version) params.version = version;
    const key = JSON.stringify([spec, referenceCapital, version, retry, inDesign]);
    if (request.current?.key !== key) request.current = { key, promise: fetchPerformancePanel(params) };
    request.current.promise.then(data => {
      if (active) { setPanel(data); if (!version) setVersions(data.byVersion.map(v => v.key)); }
    }).catch(e => { if (active) setError(readPanelError(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [spec, referenceCapital, version, retry, inDesign]);
  const count = (n: number): Metric => ({ value: n, reason: null });
  const integer = (n: number) => `${n}`;
  const stat = (label: string, definition: string, metric: Metric, format: (n: number) => string = fmtPrice, signed = false) => <Stat key={label} label={label} definition={definition} metric={metric} format={format} signed={signed} />;
  const minimum = panel?.notes.map(note => /mínimo (\d+)/i.exec(note)?.[1]).find(Boolean);
  return <div className="performance-panel" aria-label="Panel de rendimiento">
    <StrategyHeader title={strategyName(spec)} hint={spec} onBack={onBack}
      chips={<>{inDesign ? <span className="instance-state">En diseño</span> : <InstanceState instance={instance} />}<StageModeChip stage={inDesign ? undefined : stage} mode={mode} /></>}
      onOpenChat={design.projectId && onOpenChat ? () => onOpenChat(design.projectId!) : undefined}
      actions={<>{versions.length > 1 && <div className="performance-filters"><label>Versión<select value={version} onChange={e => setVersion(e.target.value)}><option value="">Todas</option>{versions.map(v => <option key={v}>{v}</option>)}</select></label></div>}</>} />
    {!inDesign && <StrategyStatusBar spec={spec} instance={instance} canControl={stage === 'SHADOW' && !!instance} openPositions={panel?.tradesOpen} onInstanceChange={onInstanceChange} />}
    <StrategyOverview strategy={design.strategy} />
    {!inDesign && <WhyNotOperating instanceId={instance?.instanceId} openPositions={panel ? panel.tradesOpen : error ? 0 : null} />}
    <div className="performance-tabs" role="tablist" aria-label="Seguimiento de la estrategia">{['Resumen', 'Posiciones', 'Reglas', 'Registro'].map(name => <button key={name} id={`tab-${name}`} role="tab" aria-selected={tab === name} aria-controls={`pane-${name}`} onClick={() => setTab(name)}>{name}</button>)}</div>
    {inDesign && (tab === 'Resumen' || tab === 'Posiciones') && <p>Esta estrategia está en diseño. Abrí su proyecto en el chat para prepararla para SHADOW.</p>}
    {(tab === 'Resumen' || tab === 'Posiciones') && loading && <div role="status" aria-label="Cargando rendimiento" className="performance-loading"><div className="performance-metrics">{Array.from({ length: 12 }, (_, i) => <div key={i} className="performance-skeleton metric-skeleton" />)}</div><div className="performance-skeleton chart-skeleton" /></div>}
    {(tab === 'Resumen' || tab === 'Posiciones') && error && <div role="alert"><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>Reintentar</button></div>}
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
          {panel.costsDeclared && panel.realizedGrossPnl && stat('Ganancia sin costos', 'Resultado de las operaciones cerradas antes de descontar los costos declarados.', panel.realizedGrossPnl, usd, true)}
          {panel.costsDeclared && panel.totalCosts && stat('Costos', 'Costos declarados descontados en las operaciones cerradas.', panel.totalCosts, amount)}
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
      <Block title="Posiciones abiertas">{panel.openPositions.map(position => <LivePositionRow key={position.positionId} position={{ structure: position.structure, symbol: position.symbol, expiration: position.legList[0]?.expiration ?? null, dte: position.currentDte, legs: position.legList, entryAt: position.entryAt, credit: position.entryAmount ?? position.entryCredit, debit: position.entryKind === 'debit', pending: position.pendingSettlement, currentValue: position.lastSpreadValue, pnl: position.unrealizedPnl, risk: position.maxRisk, reason: position.valuationProblems?.join(' · '), equity: position.structure === 'long_equity' ? { legs: position.legs, shares: position.shares ?? null, entryPrice: position.entryPrice ?? null, lastPrice: position.lastPrice ?? null, cost: position.cost ?? null } : undefined }} />)}{!panel.openPositions.length && <p>Sin posiciones abiertas</p>}</Block>
    </div>}
    {panel && !loading && !error && tab === 'Posiciones' && <div role="tabpanel" id="pane-Posiciones" aria-labelledby="tab-Posiciones">
      {/* WS-0057 C (owner 21/10): una sola tabla de operaciones; el detalle de cada una en el panel de la derecha. */}
      <TradeLog trades={panel.closedTrades} open={panel.openPositions} spec={spec} exits={panel.byExitRule} />
    </div>}
    {tab === 'Reglas' && <div role="tabpanel" id="pane-Reglas" aria-labelledby="tab-Reglas"><StrategyDesign design={design} /><StrategyData spec={spec} quality={(design.strategy?.current?.spec as AlgorithmSpec | undefined)?.data_quality}/></div>}
    {tab === 'Registro' && <div role="tabpanel" id="pane-Registro" aria-labelledby="tab-Registro">{!inDesign && <RegistryLog instances={(instances ?? (instance ? [instance] : [])).slice(0, 3)} />}{!inDesign && (version ? <p>Para ver la evaluación de la instancia actual, seleccioná Todas las versiones.</p> : <EntryEvaluations key={instance?.instanceId} instance={instance} />)}{runtime}</div>}
  </div>;
}
