import React, { useCallback, useEffect, useRef, useState } from 'react';
import { labRequest, WorkspaceProject, WorkspaceState } from '../api/lab';
import { useAppConfigStore } from '../store/useAppConfigStore';
import { Database } from 'lucide-react';
import { InstanceState, latestInstance } from '../components/shadow/InstanceState';
import { PerformancePanel } from '../components/shadow/PerformancePanel';
import { fetchReferenceCapital } from '../api/space';
import { amount, days, metricText, rate, readPanelError, stateLabel, usd as panelUsd } from '../components/shadow/panelPresentation';
import { NoticePanel } from '../components/common/NoticePanel';
import {
  fetchPerformanceSummary, fetchShadowDiscards, fetchShadowEvaluations, fetchShadowMetrics, fetchShadowPositions, fetchShadowStatus,
} from '../api/shadow';
import {
  PerformanceSummary, Metric, DISCARD_LABELS, ShadowEvaluation, ShadowEvent, ShadowInstance, ShadowPosition, ShadowStatus, SpecVersionMetrics,
} from '../types/shadow';

/**
 * SHADOW — lo que hace el runtime de simulación (GC-0004, I3).
 *
 * SHADOW simula la ORDEN, nunca el dato: evalúa con métricas y precios reales y, si todo se cumple,
 * registra un fill simulado al mid real. Nada de esto mueve plata.
 *
 * Todo sale de /App/Runtime/*: las métricas por versión de spec las calcula la API desde la base.
 * Esta pantalla no suma ni promedia; muestra, y dice qué no existe todavía (sin operaciones, sin
 * valuación, sin persistencia) en vez de mostrar ceros.
 */

const REFRESH_MS = 30_000;
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'medium' });
}

function usd(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`;
}

function shortHash(h: string): string {
  return h.replace('sha256:', '').slice(0, 12);
}

/** La instancia que se mira: la que corre, o la última creada. */
export function pickInstance(instances: ShadowInstance[]): ShadowInstance | null {
  return instances.find((i) => i.lifecycleState === 'RUNNING') ?? instances[instances.length - 1] ?? null;
}

/** Por qué se descartó, tal como lo dejó el runtime en el evento. */
export function discardReason(evt: ShadowEvent): string {
  const p = evt.payload ?? {};
  if (Array.isArray(p.gates)) {
    return (p.gates as Array<Record<string, unknown>>)
      .map((g) => `${g.gate_id}: ${g.status}${g.value !== null && g.value !== undefined ? ` (${g.value} ${g.operator} ${g.threshold})` : ''}`)
      .join(' · ');
  }
  if (typeof p.reason === 'string') return p.reason;
  if (Array.isArray(p.errors)) return (p.errors as unknown[]).join(' · ');
  return 'sin motivo registrado';
}

interface Loaded {
  status: ShadowStatus;
  metrics: SpecVersionMetrics[] | null;
  metricsError: string | null;
  instance: ShadowInstance | null;
  evaluations: ShadowEvaluation[];
  discards: ShadowEvent[];
  positions: ShadowPosition[];
  loadedAt: Date;
}

function errorText(e: unknown): string {
  const any = e as { response?: { status?: number; data?: { error?: string; reason?: string } }; message?: string };
  const d = any.response?.data;
  if (d?.error) return d.reason ? `${d.error} Motivo: ${d.reason}` : d.error;
  return any.message ?? String(e);
}

export function Shadow({ selectedSpec, onSelectSpec, onOpenChat, rpf }: { selectedSpec?: string | null; onSelectSpec?: (spec: string | null) => void; onOpenChat?: (projectId: string) => void; rpf?: React.ReactNode }) {
  const [spec, setLocalSpec] = useState<string | null>(selectedSpec ?? null);
  const setSpec = (value: string | null) => { setLocalSpec(value); onSelectSpec?.(value); };
  useEffect(() => { if (selectedSpec !== undefined) setLocalSpec(selectedSpec); }, [selectedSpec]);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [projectsError, setProjectsError] = useState('');
  const projectsRequest = useRef<Promise<WorkspaceState> | undefined>(undefined);
  const rpfEnabled = useAppConfigStore(s => s.strategies.some(strategy => strategy.tab === 'rpf'));
  useEffect(() => {
    let active = true;
    projectsRequest.current ??= labRequest<WorkspaceState>('/workspaces');
    projectsRequest.current.then(state => { if (active) { setProjects(state.projects.filter(p => p.type === 'strategy' && p.strategyName && !p.strategyName.startsWith('shadow_runtime_test_'))); setProjectsError(''); } }).catch(() => { if (active) setProjectsError('No se pudieron leer las estrategias en diseño.'); });
    return () => { active = false; };
  }, []);
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [rows, setRows] = useState<PerformanceSummary[]>([]);
  const [instances, setInstances] = useState<ShadowInstance[]>([]);
  const [capital, setCapital] = useState<number | undefined>();
  const [statusError, setStatusError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const requests = useRef<{ retry: number; summary: Promise<PerformanceSummary[]>; status: Promise<ShadowStatus> } | undefined>(undefined);
  const profileRequest = useRef<Promise<number | undefined> | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setStatusError('');
    if (!requests.current || requests.current.retry !== retry) requests.current = { retry, summary: fetchPerformanceSummary(), status: fetchShadowStatus() };
    requests.current.status.then(status => { if (active) setInstances(status.instances); })
      .catch(() => { if (active) setStatusError('No se pudo leer el estado de las instancias'); });
    requests.current.summary.then(data => { if (active) setRows(data); })
      .catch(e => { if (active) setError(readPanelError(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);
  useEffect(() => { let active = true; profileRequest.current ??= fetchReferenceCapital(); profileRequest.current.then(value => { if (active) setCapital(value); }); return () => { active = false; }; }, []);
  const cell = (metric: Metric, format = panelUsd, signed = false) => <td className="numeric" title={metric.reason || undefined} style={signed && metric.value !== null ? { color: metric.value < 0 ? 'var(--red-gc)' : metric.value > 0 ? 'var(--green)' : undefined } : undefined}>{metricText(metric, format)}</td>;
  const headers = [
    ['Estrategia', 'Nombre de la estrategia.'], ['Estado', 'Estado de la instancia más reciente.'], ['Operaciones', 'Cantidad de operaciones cerradas y posiciones abiertas.'],
    ['% Gan', 'Proporción de operaciones cerradas que ganaron.'], ['Ganancia total', 'Resultado acumulado de las operaciones cerradas en USD.'],
    ['Promedio por operación', 'Resultado promedio de todas las operaciones cerradas en USD.'], ['Salidas', 'Cantidad de salidas por toma de ganancia, stop loss y otros motivos.'],
    ['Días promedio', 'Tiempo promedio entre la entrada y la salida.'], ['Máx. caída', 'Mayor caída del resultado acumulado desde su máximo anterior.'], ['Peor operación', 'Peor resultado de una operación cerrada.'],
  ];
  return <div className="shadow-page">
    {spec ? <>
      <button className="shadow-back" onClick={() => { setSpec(null); setRuntimeOpen(false); }}>← Estrategias</button>
      {spec === 'rpf' && rpf ? <div className="performance-panel"><h2>RPF</h2><div className="performance-tabs" role="tablist" aria-label="Seguimiento de RPF"><button role="tab" id="rpf-hoy" aria-selected="true" aria-controls="rpf-hoy-panel">Hoy</button></div><div role="tabpanel" id="rpf-hoy-panel" aria-labelledby="rpf-hoy">{rpf}</div></div> : <PerformancePanel key={spec} spec={spec} onOpenChat={onOpenChat} inDesign={!rows.some(row => row.spec === spec) && !latestInstance(instances, spec) && projects.some(project => project.strategyName === spec)} instance={latestInstance(instances, spec)} referenceCapital={capital} runtime={<details className="performance-block shadow-runtime" open={runtimeOpen} onToggle={event => setRuntimeOpen(event.currentTarget.open)}><summary>Runtime</summary>{runtimeOpen && <RuntimeDetails spec={spec} />}</details>} />}
    </> : <div className="performance-panel">
      <h2>Estrategias</h2>
      {error && <div role="alert">{error}<button onClick={() => setRetry(n => n + 1)}>Reintentar</button></div>}
      {statusError && <p role="alert">{statusError}</p>}{projectsError && <p role="alert">{projectsError}</p>}
      <div className="performance-table strategy-list" aria-busy={loading}><table><thead><tr>{headers.map(([label, definition]) => <th key={label} title={definition}>{label}</th>)}</tr></thead><tbody>
        {loading ? Array.from({ length: 5 }, (_, i) => <tr key={i} aria-label="Cargando estrategia">{headers.map(([label]) => <td key={label}><div className="performance-skeleton row-skeleton" /></td>)}</tr>) : rows.filter(row => !row.spec.startsWith('shadow_runtime_test_')).map(row => <tr key={row.spec} className="strategy-row" tabIndex={0} aria-label={`Abrir ${row.spec}`} onClick={() => setSpec(row.spec)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setSpec(row.spec); } }}>
          <td><button className="strategy-name" onClick={() => setSpec(row.spec)}>{row.spec}</button></td><td><InstanceState instance={latestInstance(instances, row.spec)} /></td><td>{row.tradesClosed} cerradas · {row.tradesOpen} abiertas</td>
          {cell(row.winRate, rate)}{cell(row.realizedPnl, panelUsd, true)}{cell(row.expectancy, panelUsd, true)}<td>{row.takeProfitExits} TP · {row.stopLossExits} SL · {row.otherExits} otras</td>{cell(row.avgDaysHeld, days)}{cell(row.maxDrawdown, amount)}{cell(row.worstTrade, panelUsd, true)}
        </tr>)}
        {!loading && projects.filter(project => !rows.some(row => row.spec === project.strategyName) && project.strategyName !== 'rpf').map(project => <tr key={project.id} className="strategy-row" tabIndex={0} aria-label={`Abrir ${project.strategyName}`} onClick={() => setSpec(project.strategyName)} onKeyDown={event => { if (event.key === 'Enter') setSpec(project.strategyName); }}><td><button className="strategy-name" onClick={() => setSpec(project.strategyName)}>{project.strategyName}</button></td><td>{latestInstance(instances, project.strategyName!) ? <InstanceState instance={latestInstance(instances, project.strategyName!)} /> : 'En diseño'}</td>{headers.slice(2).map(([label]) => <td key={label} title="Todavía no tiene operaciones SHADOW">—</td>)}</tr>)}
        {!loading && rpf && rpfEnabled && !rows.some(row => row.spec === 'rpf') && <tr className="strategy-row" tabIndex={0} aria-label="Abrir RPF" onClick={() => setSpec('rpf')} onKeyDown={event => { if (event.key === 'Enter') setSpec('rpf'); }}><td><button className="strategy-name" onClick={() => setSpec('rpf')}>RPF</button></td><td>Monitor propio</td>{headers.slice(2).map(([label]) => <td key={label} title="Disponible en la pestaña Hoy">—</td>)}</tr>}
        {!loading && !error && !rows.length && !projects.length && !rpfEnabled && <tr><td colSpan={headers.length}>Sin estrategias SHADOW</td></tr>}
      </tbody></table></div>
    </div>}
  </div>;
}

function RuntimeDetails({ spec }: { spec: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await fetchShadowStatus();
      const instances = raw.instances.filter(instance => instance.specName === spec);
      const status = { ...raw, instances, persistence: { ...raw.persistence, recovery: null } };
      const instance = pickInstance(instances);
      let metrics: SpecVersionMetrics[] | null = null;
      let metricsError: string | null = null;
      try { metrics = (await fetchShadowMetrics()).filter(metric => metric.specName === spec); } catch (e) { metricsError = errorText(e); }
      const readings = await Promise.all(instances.map(async instance => {
        const [evaluations, discards, positions] = await Promise.all([
          fetchShadowEvaluations(instance.instanceId), fetchShadowDiscards(instance.instanceId), fetchShadowPositions(instance.instanceId),
        ]);
        return { evaluations, discards, positions };
      }));
      setData({ status, metrics, metricsError, instance, evaluations: readings.flatMap(row => row.evaluations),
        discards: readings.flatMap(row => row.discards), positions: readings.flatMap(row => row.positions), loadedAt: new Date() });
      setError(null);
    } catch (e) { setError(errorText(e)); }
    finally { setLoading(false); }
  }, [spec]);
  useEffect(() => { load(); const id = setInterval(load, REFRESH_MS); return () => clearInterval(id); }, [load]);
  return <div><button onClick={load} disabled={loading} title="Actualizar runtime">Actualizar runtime</button>
    {error && <NoticePanel title="No se pudo leer el runtime" detail={error} icon={<Database size={16} />} color="var(--red-gc)" />}
    {!data && !error && <p>Cargando runtime…</p>}
    {data && !error && <><div className="performance-table"><table><thead><tr><th>Instancia</th><th>Estado</th><th>Actualizado</th></tr></thead><tbody>{data.status.instances.map(instance => <tr key={instance.instanceId}><td>{instance.instanceId}</td><td>{stateLabel(instance.lifecycleState)}</td><td>{when(instance.updatedAt)}</td></tr>)}</tbody></table></div><Content data={data} /></>}
  </div>;
}

function Content({ data }: { data: Loaded }) {
  const { status, metrics, metricsError, instance, evaluations, discards, positions } = data;
  const open = positions.filter((p) => p.status === 'OPEN');
  const closed = positions.filter((p) => p.status !== 'OPEN');

  return (
    <>
      <StatusPanel status={status} instance={instance} loadedAt={data.loadedAt} />

      <Block title="Métricas por versión de spec" note="calculadas por la API desde la base">
        {metricsError && <Empty text={`Sin métricas: ${metricsError}`} />}
        {metrics && metrics.length === 0 && <Empty text="Todavía no se desplegó ninguna versión de spec." />}
        {metrics?.map((m) => <MetricsCard key={m.contentHash} m={m} />)}
      </Block>

      {!instance && (
        <Empty text="No hay instancias SHADOW. Se crean con POST /App/Runtime/Deploy." />
      )}

      {instance && (
        <>
          <Block title="Operaciones abiertas" note={`${open.length}`}>
            {open.length === 0 ? <Empty text="No hay operaciones abiertas." /> : <PositionsTable positions={open} />}
          </Block>
          <Block title="Operaciones cerradas" note={`${closed.length}`}>
            {closed.length === 0 ? <Empty text="No hay operaciones cerradas." /> : <PositionsTable positions={closed} />}
          </Block>
          <Block title="Descartes recientes" note="por qué una evaluación no terminó en operación">
            {discards.length === 0 ? <Empty text="Sin descartes registrados." /> : <DiscardsTable events={discards} />}
          </Block>
          <Block title="Evaluaciones recientes" note="valor real de cada gate">
            {evaluations.length === 0 ? <Empty text="Sin evaluaciones registradas (sólo evalúa en sesión y con el switch ON)." />
              : <EvaluationsTable evaluations={evaluations} />}
          </Block>
        </>
      )}
    </>
  );
}

function StatusPanel({ status, instance, loadedAt }: { status: ShadowStatus; instance: ShadowInstance | null; loadedAt: Date }) {
  const p = status.persistence;
  return (
    <div data-testid="shadow-status" className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', margin: '16px 0' }}>
      <Card label="Persistencia">
        {p.available ? (
          <>
            <Value color="var(--green)">Guardado en base</Value>
            <Small>Recuperado al arrancar: {when(p.recoveredAt)}</Small>
            {p.recovery && (
              <Small>
                {p.recovery.instances} instancias · {p.recovery.openPositions} abiertas · {p.recovery.closedPositions} cerradas ·{' '}
                {p.recovery.evaluations} evaluaciones · {p.recovery.events} eventos
              </Small>
            )}
            {p.recovery?.problems.map((x) => <Small key={x} color="var(--red-gc)">{x}</Small>)}
          </>
        ) : (
          <>
            <Value color="var(--red-gc)">Sin persistencia</Value>
            <Small>{p.reason ?? 'motivo no informado'}</Small>
            <Small>No se puede desplegar: se perdería al reiniciar.</Small>
          </>
        )}
      </Card>
      <Card label="Switch del runtime">
        <Value color={status.switch.enabled ? 'var(--green)' : 'var(--text-muted)'}>{status.switch.enabled ? 'ON' : 'OFF'}</Value>
        <Small>{status.switch.enabled ? 'Evalúa entradas en sesión.' : 'Entradas pausadas; lo abierto se sigue valuando.'}</Small>
      </Card>
      <Card label="Instancia">
        {instance ? (
          <>
            <Value>{instance.specName}</Value>
            <Small><span style={mono}>{shortHash(instance.versionHash)}</span> · {instance.lifecycleState} / {instance.schedulerState}</Small>
            <Small>Desde {when(instance.createdAt)}</Small>
          </>
        ) : <Small>Ninguna desplegada.</Small>}
        <Small>Leído {loadedAt.toLocaleTimeString('es-AR')}</Small>
      </Card>
    </div>
  );
}

function MetricsCard({ m }: { m: SpecVersionMetrics }) {
  const discardEntries = Object.entries(m.discards);
  return (
    <div data-testid="shadow-metrics" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 10, background: 'var(--bg-secondary)' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
        {m.specName} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>v{m.specVersion} · <span style={mono}>{shortHash(m.contentHash)}</span> · {m.instances} instancia(s)</span>
      </div>
      {m.noTrades && (
        <div style={{ fontSize: 14, color: 'var(--yellow-gc)', marginBottom: 8 }}>
          Esta versión todavía no abrió operaciones: P&amp;L, acierto y drawdown no existen aún.
        </div>
      )}
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <Stat label="Evaluaciones" value={`${m.evaluations}`} sub={`${m.evaluationsPassed} pasaron los gates`} />
        <Stat label="Descartes" value={`${m.discardsTotal}`} sub={`${m.noDataBlocks} con dato faltante`} />
        <Stat label="Operaciones" value={`${m.positionsOpened}`} sub={`${m.positionsOpen} abiertas · ${m.positionsClosed} cerradas`} />
        <Stat label="P&L realizado" value={usd(m.realizedPnl)} sub={m.realizedPnl === null ? 'sin operaciones cerradas' : undefined} />
        <Stat label="P&L no realizado" value={usd(m.unrealizedPnl)}
          sub={m.openPositionsNotValued > 0 ? `${m.openPositionsNotValued} abiertas sin valuar` : undefined} />
        <Stat label="Acierto" value={m.winRate === null ? '—' : `${(m.winRate * 100).toFixed(1)} %`} />
        <Stat label="Drawdown máx." value={usd(m.maxDrawdown)} />
        <Stat label="Período" value={m.lastEvaluationAt ? when(m.lastEvaluationAt) : '—'} sub={m.firstEvaluationAt ? `desde ${when(m.firstEvaluationAt)}` : 'sin evaluaciones'} />
      </div>
      {discardEntries.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
          Descartes por motivo: {discardEntries.map(([k, v]) => `${DISCARD_LABELS[k] ?? k} ${v}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

function PositionsTable({ positions }: { positions: ShadowPosition[] }) {
  return (
    <Table head={['Entrada', 'Símbolo', 'Patas', 'Crédito', 'Riesgo máx.', 'DTE', 'Valuación', 'Salida']}>
      {positions.map((p) => (
        <tr key={p.positionId}>
          <Td>{when(p.entryAt)}</Td>
          <Td>{p.symbol}</Td>
          <Td mono>{p.legs.map((l) => `${l.side} ${l.type} ${l.strike} ${l.expiration ?? ''}`).join(' / ')}</Td>
          <Td mono>{p.entryCredit.toFixed(2)}</Td>
          <Td mono>{usd(p.maxRisk)}</Td>
          <Td mono>{p.currentDte ?? p.entryDte}</Td>
          <Td>
            {p.valuationProblems?.length ? (
              <span style={{ color: 'var(--yellow-gc)' }}>Sin valuar: {p.valuationProblems.join(' · ')}</span>
            ) : p.lastValuedAt ? (
              <span style={mono}>{p.lastSpreadValue?.toFixed(2)} · {usd(p.unrealizedPnl)} <span style={{ color: 'var(--text-muted)' }}>({when(p.lastValuedAt)})</span></span>
            ) : <span style={{ color: 'var(--text-muted)' }}>todavía no valuada</span>}
          </Td>
          <Td>{p.exitReason ? <span style={mono}>{p.exitReason} · {p.exitDebit?.toFixed(2)} · {usd(p.realizedPnl)} ({when(p.exitAt)})</span> : '—'}</Td>
        </tr>
      ))}
    </Table>
  );
}

function DiscardsTable({ events }: { events: ShadowEvent[] }) {
  return (
    <Table head={['Hora', 'Símbolo', 'Motivo', 'Detalle']}>
      {[...events].reverse().map((e) => (
        <tr key={e.eventId}>
          <Td>{when(e.timestamp)}</Td>
          <Td>{e.symbol ?? '—'}</Td>
          <Td>{DISCARD_LABELS[e.eventType] ?? e.eventType}</Td>
          <Td mono>{discardReason(e)}</Td>
        </tr>
      ))}
    </Table>
  );
}

function EvaluationsTable({ evaluations }: { evaluations: ShadowEvaluation[] }) {
  return (
    <Table head={['Hora', 'Símbolo', 'Resultado', 'Gates']}>
      {[...evaluations].reverse().map((e) => (
        <tr key={e.evaluationId}>
          <Td>{when(e.evaluatedAt)}</Td>
          <Td>{e.symbol}</Td>
          <Td><span style={{ color: e.overallPass ? 'var(--green)' : 'var(--red-gc)', fontWeight: 600 }}>{e.overallPass ? 'PASA' : 'NO PASA'}</span></Td>
          <Td mono>
            {e.gateResults.map((g) => (
              <div key={g.gateId}>
                <span style={{ color: g.status === 'PASS' ? 'var(--green)' : g.status === 'NO_DATA' ? 'var(--yellow-gc)' : 'var(--red-gc)' }}>{g.status}</span>{' '}
                {g.gateId}: {g.value ?? 'sin dato'} {g.operator} {g.threshold}
              </div>
            ))}
          </Td>
        </tr>
      ))}
    </Table>
  );
}

// ── piezas ──────────────────────────────────────────────────────

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title} {note && <span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {note}</span>}
      </div>
      {children}
    </section>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--bg-secondary)' }}>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function Value({ children, color = 'var(--text-primary)' }: { children: React.ReactNode; color?: string }) {
  return <div style={{ fontSize: 22, fontWeight: 700, color, marginBottom: 4 }}>{children}</div>;
}

function Small({ children, color = 'var(--text-secondary)' }: { children: React.ReactNode; color?: string }) {
  return <div style={{ fontSize: 13, color, lineHeight: 1.5 }}>{children}</div>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', ...mono }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 14, color: 'var(--text-muted)', padding: '6px 0' }}>{text}</div>;
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--bg-tertiary)' }}>
            {head.map((h) => (
              <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, mono: isMono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td style={{ padding: '6px 8px', borderTop: '1px solid var(--border-dark)', color: 'var(--text-secondary)', verticalAlign: 'top', ...(isMono ? mono : {}) }}>
      {children}
    </td>
  );
}
