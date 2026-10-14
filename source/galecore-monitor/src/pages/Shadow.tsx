import React, { useCallback, useEffect, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { SectionTitle } from '../components/common/SectionTitle';
import { PerformancePanel } from '../components/shadow/PerformancePanel';
import { NoticePanel } from '../components/common/NoticePanel';
import {
  fetchShadowDiscards, fetchShadowEvaluations, fetchShadowMetrics, fetchShadowPositions, fetchShadowStatus,
} from '../api/shadow';
import {
  DISCARD_LABELS, ShadowEvaluation, ShadowEvent, ShadowInstance, ShadowPosition, ShadowStatus, SpecVersionMetrics,
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
const mono: React.CSSProperties = { fontFamily: 'JetBrains Mono, monospace' };

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

export function Shadow() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedSpec, setSelectedSpec] = useState('');
  const [knownSpecs, setKnownSpecs] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const status = await fetchShadowStatus();
      const instance = pickInstance(status.instances);
      let metrics: SpecVersionMetrics[] | null = null;
      let metricsError: string | null = null;
      try { metrics = await fetchShadowMetrics(); } catch (e) { metricsError = errorText(e); }
      if (metrics) setKnownSpecs(Array.from(new Set(metrics.map(m => m.specName))));
      const [evaluations, discards, positions] = instance
        ? await Promise.all([
            fetchShadowEvaluations(instance.instanceId),
            fetchShadowDiscards(instance.instanceId),
            fetchShadowPositions(instance.instanceId),
          ])
        : [[], [], []];
      setData({ status, metrics, metricsError, instance, evaluations, discards, positions, loadedAt: new Date() });
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div style={{ padding: '16px 18px 40px', fontFamily: 'var(--font-sans)' }}>
      <SectionTitle title="GaleCore SHADOW" badge="simulación con datos reales · no mueve plata" accent="#38bdf8">
        <button onClick={load} disabled={loading} title="Actualizar"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)',
            background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
          <RefreshCw size={12} /> {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </SectionTitle>

      {error && (
        <NoticePanel title="No se pudo leer el runtime" detail={error} icon={<Database size={16} />} color="var(--red-gc)"
          hint="¿Está levantada la API y tu sesión vigente?" />
      )}

      {/* Si el último refresco falló, el cartel reemplaza a los datos: números viejos se leen como vigentes. */}
      {knownSpecs.length > 0 && <>
        <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 20, fontSize: 16 }}>
          Estrategia
          <select aria-label="Estrategia" value={selectedSpec || knownSpecs[0]}
            onChange={e => setSelectedSpec(e.target.value)}
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
            {knownSpecs.map(spec => <option key={spec}>{spec}</option>)}
          </select>
        </label>
        <PerformancePanel key={selectedSpec || knownSpecs[0]} spec={selectedSpec || knownSpecs[0]} />
      </>}
      {data && !error && <Content data={data} />}
      {!data && !error && <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 16 }}>Cargando…</div>}
    </div>
  );
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
