import React, { useEffect, useState } from 'react';
import {
  WifiOff, Check, X, Circle, AlertTriangle, Clock, ChevronDown, RefreshCw,
  Moon, Target, Zap, Ban, Hourglass, Layers, Briefcase, BookOpen, LucideIcon,
} from 'lucide-react';
import { useRpfStore } from '../store/useRpfStore';
import { useMarketStore } from '../store/useMarketStore';
import { useSwitchEndpoint } from '../store/useAppConfigStore';
import { useSwitchEnabled } from '../store/useStrategySwitchStore';
import { RpfStateBadge } from '../components/rpf/RpfStateBadge';
import { RpfSuggestionCard } from '../components/rpf/RpfSuggestionCard';
import { ReferencesModal } from '../components/common/ReferencesModal';
import { StrategySwitch } from '../components/common/StrategySwitch';
import { StrategyOffPanel } from '../components/common/StrategyOffPanel';
import { getStrategyReference } from '../components/strategy/strategyReferences';
import { RpfStateUpdate, RpfCheck, RpfCandidate, RpfStateName } from '../types/rpf';
import { ConnectionStatus } from '../socket/useMarketSocket';
import { LegMeta } from '../types/api';
import { RPF_SWITCH_ENDPOINT } from '../api/rpf';
import { tint, fmtPrice, fmtOI, fmtExpiry, fmtTime } from '../utils/formatters';

const RPF_REF = getStrategyReference('rpf');

interface Props {
  acceptSuggestion: (id: string) => void;
  dismissSuggestion: (id: string) => void;
  subscribeLeg: (occ: string) => void;
  unsubscribeLeg: (occ: string) => void;
  socketStatus: ConnectionStatus;
}

// Estados en los que el entorno ya armó (el eje DISPARA está activo).
const ARMED_STATES: RpfStateName[] = ['ARMED', 'WAITING_CAPACITY', 'COOLDOWN', 'TRIGGERED', 'IN_POSITION'];

// Máquina de estados: icono + etiqueta en español + color, para el bloque de resolución.
const STATE_META: Record<RpfStateName, { color: string; es: string; Icon: LucideIcon }> = {
  DORMANT:          { color: 'var(--text-muted)', es: 'Dormido',        Icon: Moon },
  ARMED:            { color: 'var(--text-secondary)',           es: 'Armado',         Icon: Target },
  TRIGGERED:        { color: 'var(--green)',      es: 'Disparado',      Icon: Zap },
  COOLDOWN:         { color: 'var(--text-secondary)',           es: 'Enfriamiento',   Icon: Hourglass },
  IN_POSITION:      { color: 'var(--blue-gc)',    es: 'En posición',    Icon: Briefcase },
  WAITING_CAPACITY: { color: 'var(--yellow-gc)',  es: 'Esperando cupo', Icon: Layers },
  VETOED:           { color: 'var(--red-gc)',     es: 'Vetado',         Icon: Ban },
};

// Explicación en lenguaje llano de cada estado (la "salida" de la orquestación).
const STATE_EXPLAIN: Record<RpfStateName, string> = {
  DORMANT: 'El entorno todavía no está alineado (macro no pasa) pero no hay peligro. La cascada corta arriba y los gates de prima ni se evalúan. El loop sigue vivo y mira cada tick; el candidato se muestra solo como referencia.',
  VETOED: 'Peligro de cola activo: el veto de seguridad manda sobre todo lo demás (safety-first). Aunque hubiera edge y cupo, no se ofrece ningún trade. Es el único estado que bloquea de forma dura.',
  ARMED: 'Entorno seguro y armado: macro, VRP y cola pasan. Falta que el edge empírico llegue a la barra del régimen. Se espera con el candidato listo; no se dispara nada hasta que la prima pague.',
  WAITING_CAPACITY: 'La prima paga (el edge cruza la barra) pero la cartera está llena. El disparo queda en espera: en cuanto se libere un cupo puede emitir la sugerencia.',
  COOLDOWN: 'Se disparó hace poco y el loop está enfriando para no re-disparar la misma señal. Al terminar el timer vuelve a evaluar normalmente.',
  TRIGGERED: 'Todo alineado: entorno seguro, edge por encima de la barra, hay cupo y no hay enfriamiento. El sistema emite la sugerencia accionable. Nunca ejecuta: propone, el operador decide.',
  IN_POSITION: 'La cartera está llena y no hay señal viva (el edge no cruza la barra). No se arma nada nuevo: el sistema sólo gestiona lo que ya está abierto.',
};

const STATUS_COLOR: Record<string, string> = {
  pass: 'var(--green)', fail: 'var(--red-gc)', no_data: 'var(--yellow-gc)', wait: 'var(--yellow-gc)',
  skipped: 'var(--text-muted)', pending: 'var(--text-muted)', na: 'var(--text-muted)',
};

// Claves de régimen (edge.bars_by_regime) → etiqueta legible.
const REGIME_ES: Record<string, string> = {
  low_vol: 'vol baja', normal: 'normal', elevated: 'vol elevada', caution: 'cautela',
};

const panelStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', borderRadius: 10, padding: '14px 16px',
};

// Sub-etiqueta de sección dentro de un panel (ej: "Macro · capa 1", "Prima y cola").
const subLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 2px',
};

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? '—' : Number.isInteger(n) ? `${n}` : n.toFixed(d);

// Mid del leg desde bid/ask del socket. null si falta cualquiera de los dos.
const legMid = (bid?: number, ask?: number): number | null =>
  !bid || !ask || bid <= 0 || ask <= 0 ? null : (bid + ask) / 2;

// Punto verde: el valor de esta celda es live (recalculado del socket), no un snapshot.
function LiveDot() {
  return <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
    backgroundColor: '#22c55e', marginLeft: 5, verticalAlign: 'middle', boxShadow: '0 0 4px #22c55e88' }} />;
}

// ── Celdas de la tabla del candidato (look Main · Setup candidato) ──
const thStyle: React.CSSProperties = {
  padding: '6px 8px', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--text-muted)', textAlign: 'center', fontFamily: 'var(--font-sans)',
  borderBottom: '1px solid var(--border-dark)', borderRight: '1px solid rgba(255,255,255,0.04)',
  whiteSpace: 'nowrap', verticalAlign: 'middle', backgroundColor: 'var(--bg-tertiary)',
};
const tdStyle: React.CSSProperties = {
  padding: '10px 8px', textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle',
  fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 15,
  borderRight: '1px solid rgba(255,255,255,0.03)',
};
const Th = ({ children, colSpan, rowSpan }: { children: React.ReactNode; colSpan?: number; rowSpan?: number }) =>
  <th colSpan={colSpan} rowSpan={rowSpan} style={thStyle}>{children}</th>;
const Td = ({ children, color }: { children: React.ReactNode; color?: string }) =>
  <td style={{ ...tdStyle, color: color ?? 'var(--text-secondary)' }}>{children}</td>;

// Sublínea OI + cierre previo bajo un strike (datos estáticos del candle anterior).
function StrikeMeta({ meta }: { meta: LegMeta | null | undefined }) {
  if (!meta || (meta.openInterest == null && meta.prevClose == null)) return null;
  const parts: string[] = [];
  if (meta.openInterest != null) parts.push(`OI ${fmtOI(meta.openInterest)}`);
  if (meta.prevClose != null) parts.push(fmtPrice(meta.prevClose, 2));
  return (
    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
      fontVariantNumeric: 'tabular-nums', marginTop: 2, whiteSpace: 'nowrap' }}>
      {parts.join(' · ')}
    </span>
  );
}

// Delega en fmtTime para que el tick del loop se lea en la MISMA zona que el reloj del encabezado.
// Antes formateaba con toLocaleTimeString('es-AR'), o sea hora local con locale hardcodeado: el
// tablero decía "tick vivo · 13:33" mientras la StatusBar marcaba otra hora, y comparar frescura
// entre los dos daba una hora de diferencia fantasma.
const tickTime = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : fmtTime(d);
};

// Nota contextual del candidato según en qué punto de la orquestación estamos.
function candidateNote(state: RpfStateName, armed: boolean, vetoed: boolean): string {
  if (vetoed) return 'sin disparo — entorno vetado';
  if (!armed) return 'referencia — macro no alineado';
  switch (state) {
    case 'TRIGGERED': return 'disparo — edge sobre la barra';
    case 'ARMED': return 'armado — falta que la prima pague';
    case 'COOLDOWN': return 'suprimido por enfriamiento';
    case 'WAITING_CAPACITY': return 'la prima paga pero no hay cupo';
    case 'IN_POSITION': return 'cartera llena y sin señal viva';
    default: return '';
  }
}

function StatusIcon({ status }: { status: string }) {
  const c = STATUS_COLOR[status] ?? 'var(--text-muted)';
  if (status === 'pass') return <Check size={15} style={{ color: c, flexShrink: 0 }} />;
  if (status === 'fail') return <X size={15} style={{ color: c, flexShrink: 0 }} />;
  if (status === 'wait') return <Clock size={14} style={{ color: c, flexShrink: 0 }} />;
  return <Circle size={9} style={{ color: c, flexShrink: 0 }} />;
}

// Fila de check macro/prima: icono + etiqueta + valor/umbral.
//
// El `detail` se muestra cuando el check NO pasa, y ahí es lo único que explica por qué. Un check
// puede fallar sin umbral contra el cual compararse —`short_below_put_wall` sin put wall es el
// caso— y sin esta línea la fila queda en rojo con un número suelto: el operador ve que algo
// bloqueó, no qué. Es la misma regla que el amarillo de `no_data`: el estado tiene que decir cuál
// guarda dejó de estar, no solo que no está verde.
function CheckRow({ c }: { c: RpfCheck }) {
  const color = STATUS_COLOR[c.status] ?? 'var(--text-muted)';
  const valTxt = c.value != null
    ? `${fmt(c.value)}${c.threshold != null ? ` / ${fmt(c.threshold)}` : ''}`
    : '';
  const showDetail = !!c.detail && c.status !== 'pass';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-dark)' }}>
      <StatusIcon status={c.status} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>{c.label}</div>
        {showDetail && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>{c.detail}</div>
        )}
      </div>
      <span className="tabular-nums" style={{ fontSize: 13, color: c.status === 'fail' ? color : 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{valTxt}</span>
    </div>
  );
}

// Fila de gate de disparo: valor libre (texto) + estado con reloj para "esperando".
function DisparaRow({ label, hint, value, status }: {
  label: string; hint?: string; value: string; status: 'pass' | 'fail' | 'wait' | 'na';
}) {
  const color = STATUS_COLOR[status] ?? 'var(--text-muted)';
  const valColor = status === 'na' ? 'var(--text-muted)' : status === 'pass' ? 'var(--text-primary)' : color;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border-dark)' }}>
      <StatusIcon status={status} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>{hint}</div>}
      </div>
      <span className="tabular-nums" style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)', color: valColor }}>{value}</span>
    </div>
  );
}

function PanelHeader({ title, right, rightColor }: { title: string; right: string; rightColor: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>{title}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: rightColor, fontFamily: 'var(--font-mono)' }}>{right}</span>
    </div>
  );
}

// Conector vertical del flujo: chevron hacia abajo con etiqueta opcional.
function Connector({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, margin: '7px 0' }}>
      {label && <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>{label}</span>}
      <ChevronDown size={14} style={{ color: 'var(--text-disabled)' }} />
    </div>
  );
}

// Motor: el nodo raíz del flujo. El loop corre la cascada cada tick y la reparte en los dos ejes.
function MotorStrip({ online, lastTick }: { online: boolean; lastTick: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderRadius: 8, ...panelStyle, padding: '10px 14px', width: '60%', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <RefreshCw size={15} style={{ color: online ? 'var(--green)' : 'var(--text-muted)' }} />
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>MOTOR</span>
      </div>
      <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
        corre la cascada de 4 capas cada tick y la reparte en los dos ejes
      </span>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontFamily: 'var(--font-mono)', color: online ? 'var(--green)' : 'var(--text-muted)' }}>
        <span className={online ? 'pulse-dot' : ''} style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: online ? 'var(--green)' : 'var(--text-muted)' }} />
        {online ? 'tick vivo' : 'sin tick'}{lastTick ? ` · ${lastTick}` : ''}
      </span>
    </div>
  );
}

// Eje ARMA: macro checks + gates de señal (VRP, cola). Si la cascada cortó en macro, los gates
// no corrieron → se muestra una nota en vez de filas vacías.
function ArmaPanel({ st, armed, vetoed }: { st: RpfStateUpdate; armed: boolean; vetoed: boolean }) {
  const macro = st.macroChecks ?? [];
  const gates = st.gates ?? [];
  const right = vetoed ? 'VETADO' : armed ? 'ARMADO' : 'NO ARMADO';
  const rightColor = vetoed ? 'var(--red-gc)' : armed ? 'var(--green)' : 'var(--text-muted)';
  return (
    <div style={panelStyle}>
      <PanelHeader title="Arma · ¿el entorno es seguro?" right={right} rightColor={rightColor} />
      {/* Macro · capa 1 y Prima y cola lado a lado (cada uno = un tercio del ancho total de la fila),
          separados por un divisor vertical */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ paddingRight: 22 }}>
          <div style={subLabelStyle}>Macro · capa 1</div>
          {macro.length > 0
            ? macro.map((c) => <CheckRow key={c.id} c={c} />)
            : <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>Macro no evaluado.</div>}
        </div>
        <div style={{ paddingLeft: 22, borderLeft: '1px solid var(--border-dark)' }}>
          <div style={subLabelStyle}>Prima y cola</div>
          {gates.length > 0
            ? gates.map((c) => <CheckRow key={c.id} c={c} />)
            : <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>No evaluado — la cascada cortó en macro.</div>}
        </div>
      </div>
    </div>
  );
}

// Eje DISPARA: los gates de decisión (edge vs barra + cupo + enfriamiento). La estructura del
// spread candidato vive en su propia tarjeta abajo. Atenuado si el entorno no armó.
function DisparaPanel({ st, active }: { st: RpfStateUpdate; active: boolean }) {
  const edge = st.edge ?? st.candidate?.edge ?? null;
  const bar = st.bar ?? st.candidate?.bar ?? null;
  const edgeOk = edge != null && bar != null && edge >= bar;
  const open = st.openPositions ?? 0;
  const max = st.maxPositions || 2;
  const capOk = st.capacityAvailable ?? (open < max);
  const cd = st.cooldownRemainingSec ?? 0;
  const regimeLabel = st.regime ? `barra · régimen ${REGIME_ES[st.regime] ?? st.regime}` : 'barra del régimen';
  const heat = st.heatPct != null ? ` · heat ${(st.heatPct * 100).toFixed(0)}%` : '';

  return (
    <div style={{ ...panelStyle, opacity: active ? 1 : 0.55 }}>
      <PanelHeader title="Dispara · ¿la prima paga?" right={active ? 'ACTIVO' : 'EN ESPERA'} rightColor={active ? 'var(--green)' : 'var(--text-muted)'} />
      {!active && (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'var(--font-sans)' }}>
          eje no evaluado hasta que el entorno arme
        </div>
      )}
      <DisparaRow
        label="Edge vs barra"
        hint={regimeLabel}
        value={edge != null ? `${fmt(edge)} ${edgeOk ? '≥' : '<'} ${fmt(bar)}` : '—'}
        status={edge == null ? 'na' : edgeOk ? 'pass' : 'fail'}
      />
      <DisparaRow
        label="Cupo de cartera"
        hint={`máx ${max}${heat}`}
        value={`${open} / ${max}`}
        status={!active ? 'na' : capOk ? 'pass' : 'fail'}
      />
      <DisparaRow
        label="Enfriamiento"
        hint="suprime el re-disparo"
        value={cd > 0 ? `${Math.round(cd)}s` : 'inactivo'}
        status={cd > 0 ? 'wait' : 'pass'}
      />
    </div>
  );
}

// Máquina de estados: el estado resuelto es la salida de la orquestación.
function StateResolution({ state }: { state: RpfStateName }) {
  const meta = STATE_META[state] ?? STATE_META.DORMANT;
  const { Icon } = meta;
  return (
    <div style={{ borderRadius: 10, padding: '14px 16px', backgroundColor: tint(meta.color, 9), border: `1px solid ${tint(meta.color, 30)}`, width: '60%', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: tint(meta.color, 15), flexShrink: 0 }}>
          <Icon size={22} style={{ color: meta.color }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, fontFamily: 'var(--font-mono)', color: meta.color, letterSpacing: '0.08em' }}>{meta.es}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>{meta.es}</div>
        </div>
      </div>
      <div style={{ fontSize: 14.5, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 10, fontFamily: 'var(--font-sans)' }}>
        {STATE_EXPLAIN[state]}
      </div>
    </div>
  );
}

// Tarjeta del candidato PCS: el spread en formato tabla (look Main · Setup candidato), con primas
// EN VIVO. Suscribe los legs DXLink del candidato al socket y recalcula crédito/1-3/max/BPR del mid.
// Siempre visible (aun DORMANT); si no hay legs live, cae a los valores snapshot del payload.
function CandidateCard({ symbol, cand, note, subscribeLeg, unsubscribeLeg, socketStatus }: {
  symbol: string; cand: RpfCandidate | null; note: string;
  subscribeLeg: (occ: string) => void; unsubscribeLeg: (occ: string) => void; socketStatus: ConnectionStatus;
}) {
  const tickers = useMarketStore((s) => s.tickers);
  const initTicker = useMarketStore((s) => s.initTicker);
  const ls = cand?.legSymbols;

  // Suscribir/desuscribir los legs del candidato para primas en vivo (mismo patrón que PortfolioManager).
  useEffect(() => {
    if (socketStatus !== 'connected' || !ls) return;
    const legs = [ls.shortPut, ls.longPut].filter((s): s is string => !!s);
    legs.forEach((occ) => { initTicker(occ); subscribeLeg(occ); });
    return () => legs.forEach((occ) => unsubscribeLeg(occ));
  }, [socketStatus, ls?.shortPut, ls?.longPut]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>Candidato PCS · primas en vivo</span>
      <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>{note}</span>
    </div>
  );

  if (!cand || cand.shortPutStrike == null) {
    return (
      <div style={panelStyle}>
        {header}
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>El motor no propuso una posición candidata.</div>
      </div>
    );
  }

  // Precio del subyacente (para la columna PRICE) desde el stream del ticker principal.
  const price = tickers[symbol]?.price ?? null;

  // Mids en vivo de cada leg.
  const shortPutQ = ls?.shortPut ? tickers[ls.shortPut] : undefined;
  const longPutQ  = ls?.longPut  ? tickers[ls.longPut]  : undefined;
  const shortPutMid = legMid(shortPutQ?.bid, shortPutQ?.ask);
  const longPutMid  = legMid(longPutQ?.bid,  longPutQ?.ask);

  const width = cand.shortPutStrike != null && cand.longPutStrike != null
    ? Math.abs(cand.shortPutStrike - cand.longPutStrike)
    : cand.width ?? null;

  // Crédito: live (mid short − mid long) si ambas patas cotizan; si no, el snapshot del payload.
  const netCreditLive = shortPutMid != null && longPutMid != null ? shortPutMid - longPutMid : null;
  const credit = netCreditLive ?? cand.credit ?? null;
  const isLive = netCreditLive != null;

  // Regla 1/3, max profit/loss y BPR — por contrato. Derivados del crédito vigente (live o snapshot).
  const ratioPct = credit != null && width != null && width > 0 ? (credit / width) * 100
    : cand.creditRatio != null ? cand.creditRatio * 100 : null;
  const ratioColor = ratioPct == null ? 'var(--text-muted)' : ratioPct >= 33.3 ? 'var(--green)' : ratioPct >= 25 ? 'var(--yellow-gc)' : 'var(--red-gc)';
  const maxProfit = credit != null ? credit * 100 : null;
  const maxLoss   = credit != null && width != null ? (width - credit) * 100 : null;
  const bpr       = maxLoss; // PCS: BPR = ancho − crédito (= max loss)

  const liveCell = (v: React.ReactNode) => <span>{v}{isLive && <LiveDot />}</span>;

  return (
    <div style={panelStyle}>
      {header}
      <div style={{ borderRadius: 8, border: '1px solid var(--border-dark)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th rowSpan={2}>Símbolo</Th>
              <Th rowSpan={2}>DTE</Th>
              <Th rowSpan={2}>Precio</Th>
              <Th rowSpan={2}>Estructura</Th>
              <Th colSpan={2}>Strikes</Th>
              <Th colSpan={2}>Prima en vivo</Th>
              <Th rowSpan={2}>Crédito neto</Th>
              <Th rowSpan={2}>Regla 1/3</Th>
              <Th rowSpan={2}>POP</Th>
              <Th rowSpan={2}>Ganancia máxima</Th>
              <Th rowSpan={2}>Pérdida máxima</Th>
              <Th rowSpan={2}>BPR</Th>
            </tr>
            <tr>
              <Th>Put comprado</Th>
              <Th>Put vendido</Th>
              <Th>Put comprado</Th>
              <Th>Put vendido</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td color="var(--text-primary)"><span style={{ fontWeight: 700, fontSize: 17, letterSpacing: '0.05em' }}>{symbol}</span></Td>
              <Td>
                {cand.dte ? <span style={{ color: 'var(--text-muted)' }}>{cand.dte}d</span> : '—'}
                {cand.expiration && <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 3 }}>{fmtExpiry(cand.expiration)}</span>}
              </Td>
              <Td color="var(--text-primary)">{price != null && price > 0 ? fmtPrice(price) : '—'}</Td>
              <Td>
                <span style={{ fontSize: 14, fontWeight: 700, padding: '3px 5px', borderRadius: 4, color: 'var(--green)',
                  backgroundColor: tint('var(--green)', 9), border: `1px solid ${tint('var(--green)', 19)}` }}>PCS</span>
              </Td>
              {/* Strikes */}
              <Td color="var(--red-gc)">
                <div>{cand.longPutStrike != null ? fmtPrice(cand.longPutStrike, 0) : '—'}</div>
                <StrikeMeta meta={cand.legMeta?.longPut} />
              </Td>
              <Td color="var(--red-gc)">
                <div>{fmtPrice(cand.shortPutStrike, 0)}{cand.shortPutDelta != null && <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 4 }}>Δ{Math.abs(cand.shortPutDelta).toFixed(2)}</span>}</div>
                <StrikeMeta meta={cand.legMeta?.shortPut} />
              </Td>
              {/* Premium live */}
              <Td>{longPutMid != null ? <span>{fmtPrice(longPutMid, 2)}<LiveDot /></span> : ls?.longPut ? <span style={{ opacity: 0.4 }}>…</span> : '—'}</Td>
              <Td>{shortPutMid != null ? <span>{fmtPrice(shortPutMid, 2)}<LiveDot /></span> : ls?.shortPut ? <span style={{ opacity: 0.4 }}>…</span> : '—'}</Td>
              {/* Net credit */}
              <Td color={credit != null ? (credit > 0 ? 'var(--green)' : 'var(--red-gc)') : 'var(--text-muted)'}>
                {credit != null ? liveCell(`$${fmtPrice(credit, 2)}`) : '—'}
              </Td>
              {/* 1/3 rule */}
              <Td color={ratioColor}>{ratioPct != null ? liveCell(`${ratioPct.toFixed(1)}%`) : '—'}</Td>
              {/* POP */}
              <Td color="var(--green)">{cand.pop != null ? `${cand.pop.toFixed(0)}%` : '—'}</Td>
              {/* Max profit / loss / BPR */}
              <Td color="var(--green)">{maxProfit != null ? liveCell(`$${fmtPrice(maxProfit, 0)}`) : '—'}</Td>
              <Td color="var(--red-gc)">{maxLoss != null ? liveCell(`$${fmtPrice(maxLoss, 0)}`) : '—'}</Td>
              <Td>{bpr != null ? liveCell(`$${fmtPrice(bpr, 0)}`) : '—'}</Td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SymbolPanel({ symbol, st, suggestion, onAccept, onDismiss, subscribeLeg, unsubscribeLeg, socketStatus }: {
  symbol: string;
  st: RpfStateUpdate | undefined;
  suggestion: ReturnType<typeof useRpfStore.getState>['suggestions'][string];
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  subscribeLeg: (occ: string) => void;
  unsubscribeLeg: (occ: string) => void;
  socketStatus: ConnectionStatus;
}) {
  const state: RpfStateName = st?.state ?? 'DORMANT';
  const armed = ARMED_STATES.includes(state);
  const vetoed = state === 'VETOED';
  const active = armed && !vetoed;
  const stFull: RpfStateUpdate = st ?? { symbol, state, timestamp: '' };
  const note = candidateNote(state, armed, vetoed);

  return (
    <div style={{ marginBottom: 22 }}>
      {/* Cabecera del símbolo: scan rápido (badge) + frescura */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{symbol}</span>
        <RpfStateBadge state={state} />
        {st && st.cascadeOk === false && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 'auto', fontSize: 12, color: 'var(--yellow-gc)', fontFamily: 'var(--font-mono)' }}>
            <AlertTriangle size={11} /> sin datos de cascada
          </span>
        )}
      </div>

      {/* Flujo: Arma (2/3, con Macro y Prima en tercios) + Dispara (1/3) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 12 }}>
        <ArmaPanel st={stFull} armed={armed} vetoed={vetoed} />
        <DisparaPanel st={stFull} active={active} />
      </div>

      {/* AND no compensable → máquina de estados */}
      <Connector label="arma Y dispara · no compensable" />
      <StateResolution state={state} />

      {/* Candidato */}
      <Connector />
      <CandidateCard symbol={symbol} cand={st?.candidate ?? null} note={note}
        subscribeLeg={subscribeLeg} unsubscribeLeg={unsubscribeLeg} socketStatus={socketStatus} />

      {/* Sugerencia (solo cuando dispara) */}
      {suggestion && (
        <div style={{ marginTop: 12 }}>
          <RpfSuggestionCard suggestion={suggestion} onAccept={onAccept} onDismiss={onDismiss} />
        </div>
      )}
    </div>
  );
}

// Sin estado nuevo por más de este tiempo, el loop se considera caído.
//
// OJO con el cálculo: la cadencia de emisión NO es tier_b_tick_seconds. Ese valor es la espera
// ENTRE ticks, y hay que sumarle lo que tarda el tick en correr. Medido el 2026-08-10 con mercado
// abierto: el tick tarda 17-30s (lo domina el barrido de ~640 símbolos de la cadena) y después
// espera los 30s → las emisiones llegan cada ~47-60s, no cada 30s.
//
// El valor anterior (75s) se calibró como "dos ticks más margen" asumiendo cadencia de 30s. Contra
// la cadencia real dejaba ~15s de margen, así que cualquier tick largo marcaba el loop como caído
// estando sano — que fue exactamente el falso MOTOR DESCONECTADO que perseguimos media tarde.
// 150s = dos cadencias reales + margen.
const STALE_MS = 150_000;

export function Rpf({ acceptSuggestion, dismissSuggestion, subscribeLeg, unsubscribeLeg, socketStatus }: Props) {
  const { states, suggestions, clear } = useRpfStore();

  // El switch es el mismo que muestra la card de RPF en Main: mismo endpoint, mismo store. Su
  // estado también llega por SignalR (ReceiveRpfSwitch), que escribe en ese mismo lugar.
  const switchEndpoint = useSwitchEndpoint('rpf', RPF_SWITCH_ENDPOINT);
  const switchEnabled = useSwitchEnabled(switchEndpoint);

  // Apagar deja el tablero como recién abierto. Con el loop inerte nadie actualiza el estado, y
  // dejarlo en pantalla haría pasar datos congelados por vigentes cuando la estrategia se vuelva a
  // prender. Vive acá y no en el store del switch: quién tiene que limpiar qué es asunto de cada
  // estrategia, y el store compartido no sabe de ninguna.
  useEffect(() => { if (switchEnabled === false) clear(); }, [switchEnabled, clear]);

  // Reloj propio: sin esto el semáforo solo se recalcularía cuando llega un evento, que es
  // justamente lo que deja de pasar cuando el loop se cae.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const [refOpen, setRefOpen] = useState(false);

  // Solo los símbolos que el loop RPF emitió — NO el universo del core. RPF define su propio
  // universo (SPY-only) en galecore_rules_rpf.json; caer al ticker list del core mostraría QQQ como
  // si fuera parte de RPF, que es engañoso. Mientras el loop no emite, se muestra solo el banner.
  const symbols = Object.keys(states);
  const lastTs = symbols.map((s) => states[s]?.timestamp).filter(Boolean).sort().slice(-1)[0];
  const lastTick = tickTime(lastTs);

  // El semáforo sale de dos cosas distintas: si el switch está en OFF el loop está parado a
  // propósito; si están prendidos pero hace rato que no llega estado, se cayó o se colgó.
  const switchOff = switchEnabled === false;
  const fresh = !!lastTs && now - new Date(lastTs).getTime() < STALE_MS;
  const loopOnline = !switchOff && fresh;

  return (
    <div className="rpf-page" style={{ padding: '14px 18px 40px', height: '100%', overflowY: 'auto', fontFamily: 'var(--font-sans)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>GaleCore RPF</span>
        <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.06em',
          color: 'var(--text-secondary)', backgroundColor: tint('var(--text-secondary)', 13), border: `1px solid ${tint('var(--text-secondary)', 30)}`, fontFamily: 'var(--font-mono)' }}>
          Prima real · simulado
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setRefOpen(true)}
            title="Definiciones de la estrategia + JSON de reglas"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6,
              background: 'none', border: '1px solid var(--border)', cursor: 'pointer',
              fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)',
            }}
          >
            <BookOpen size={12} /> Referencias
          </button>
          <StrategySwitch
            endpoint={switchEndpoint}
            title="Prender / apagar la estrategia RPF. En OFF el loop no corre y el tablero se vacía, para todos los operadores; solo lo pueden tocar los admin."
          />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)',
            color: loopOnline ? 'var(--green)' : 'var(--text-muted)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: loopOnline ? 'var(--green)' : 'var(--text-muted)' }} />
            {loopOnline ? 'MOTOR CONECTADO' : 'MOTOR DESCONECTADO'}
          </span>
        </span>
      </div>

      {RPF_REF && (
        <ReferencesModal
          open={refOpen}
          onClose={() => setRefOpen(false)}
          title="RPF · Referencias"
          accentColor={RPF_REF.accentColor}
          definitions={RPF_REF.definitions}
          fetchJson={RPF_REF.fetchJson}
        />
      )}

      {/* Switch en OFF: la pantalla se reduce al encabezado y un cartel. La estrategia no corre —
          ni loop, ni suscripciones, ni tablero — así que mostrar paneles vacíos o con el último
          estado invitaría a leerlos como vigentes. Cortar acá desmonta también CandidateCard, que
          es quien suscribe los legs del candidato al hub. */}
      {switchOff ? (
        <StrategyOffPanel detail="Apagada para TODA la plataforma: el loop no corre, no se consume feed y nadie ve estado ni sugerencias. El backend lo confirma dentro de un tick y lo persiste, asi que un reinicio no la vuelve a prender sola." />
      ) : (
      <>
      {/* Motor: nodo raíz del flujo de orquestación */}
      <MotorStrip online={loopOnline} lastTick={lastTick} />
      {symbols.length > 0 && <Connector />}

      {!loopOnline && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', marginTop: 8, marginBottom: 16, borderRadius: 8,
          backgroundColor: 'var(--bg-secondary)', border: '1px dashed var(--border)' }}>
          {switchOff
            ? <Ban size={16} style={{ color: 'var(--red-gc)', flexShrink: 0, marginTop: 1 }} />
            : <WifiOff size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 1 }} />}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: switchOff ? 'var(--red-gc)' : 'var(--text-secondary)', marginBottom: 3 }}>
              {switchOff ? 'Estrategia apagada' : 'Motor desconectado'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {switchOff
                ? <>El loop está parado a propósito: no corre la cascada ni emite. El tablero vuelve a llenarse al prender el switch.</>
                : <>El backend no está empujando por el grupo <code style={{ fontFamily: 'var(--font-mono)' }}>rpf</code>. El tablero se llena en cuanto el loop emite.
                   No se corre la cascada localmente: una sola fuente de verdad.</>}
            </div>
          </div>
        </div>
      )}

      {symbols.map((sym) => (
        <SymbolPanel
          key={sym}
          symbol={sym}
          st={states[sym]}
          suggestion={suggestions[sym] ?? null}
          onAccept={acceptSuggestion}
          onDismiss={dismissSuggestion}
          subscribeLeg={subscribeLeg}
          unsubscribeLeg={unsubscribeLeg}
          socketStatus={socketStatus}
        />
      ))}

      {loopOnline && symbols.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 12px', marginTop: 8, border: '1px dashed var(--border-dark)', borderRadius: 8 }}>
          Loop conectado — esperando el primer estado del universo RPF (SPY).
        </div>
      )}
      </>
      )}
    </div>
  );
}
