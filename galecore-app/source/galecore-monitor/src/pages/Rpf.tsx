import React, { useEffect, useState } from 'react';
import { Check, X, Circle, AlertTriangle, Clock, BookOpen } from 'lucide-react';
import { useRpfStore } from '../store/useRpfStore';
import { useMarketStore } from '../store/useMarketStore';
import { useSwitchEndpoint } from '../store/useAppConfigStore';
import { useSwitchEnabled } from '../store/useStrategySwitchStore';
import { RpfSuggestionCard } from '../components/rpf/RpfSuggestionCard';
import { ReferencesModal } from '../components/common/ReferencesModal';
import { StrategyOffPanel } from '../components/common/StrategyOffPanel';
import { getStrategyReference } from '../components/strategy/strategyReferences';
import { RpfStateUpdate, RpfCheck, RpfCandidate, RpfStateName } from '../types/rpf';
import { ConnectionStatus } from '../socket/useMarketSocket';
import { LegMeta } from '../types/api';
import { RPF_SWITCH_ENDPOINT } from '../api/rpf';
import { fmtPrice, fmtOI, fmtExpiry } from '../utils/formatters';
import './Rpf.css';

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

// Máquina de estados: nombre en castellano y color del estado resuelto.
const STATE_META: Record<RpfStateName, { color: string; es: string }> = {
  DORMANT:          { color: 'var(--text-secondary)', es: 'Dormido' },
  ARMED:            { color: 'var(--text-primary)',   es: 'Armado' },
  TRIGGERED:        { color: 'var(--green)',          es: 'Disparado' },
  COOLDOWN:         { color: 'var(--text-primary)',   es: 'Enfriamiento' },
  IN_POSITION:      { color: 'var(--blue-gc)',        es: 'En posición' },
  WAITING_CAPACITY: { color: 'var(--yellow-gc)',      es: 'Esperando cupo' },
  VETOED:           { color: 'var(--red-gc)',         es: 'Vetado' },
};

// Explicación en lenguaje llano de cada estado (la "salida" de la orquestación).
const STATE_EXPLAIN: Record<RpfStateName, string> = {
  DORMANT: 'El entorno todavía no está alineado (macro no pasa) pero no hay peligro. La cascada corta arriba y los filtros de prima no se evalúan. El motor sigue mirando cada tick; el candidato se muestra sólo como referencia.',
  VETOED: 'Peligro de cola activo: el veto de seguridad manda sobre todo lo demás (safety-first). Aunque hubiera edge y cupo, no se ofrece ningún trade. Es el único estado que bloquea de forma dura.',
  ARMED: 'Entorno seguro y armado: macro, VRP y cola pasan. Falta que el edge empírico llegue a la barra del régimen. Se espera con el candidato listo; no se dispara nada hasta que la prima pague.',
  WAITING_CAPACITY: 'La prima paga (el edge cruza la barra) pero la cartera está llena. El disparo queda en espera: en cuanto se libere un cupo puede emitir la sugerencia.',
  COOLDOWN: 'Se disparó hace poco y el loop está enfriando para no re-disparar la misma señal. Al terminar el timer vuelve a evaluar normalmente.',
  TRIGGERED: 'Todo alineado: entorno seguro, edge por encima de la barra, hay cupo y no hay enfriamiento. El sistema emite la sugerencia accionable. Nunca ejecuta: propone, el operador decide.',
  IN_POSITION: 'La cartera está llena y no hay señal viva (el edge no cruza la barra). No se arma nada nuevo: el sistema sólo gestiona lo que ya está abierto.',
};

const STATUS_COLOR: Record<string, string> = {
  pass: 'var(--green)', fail: 'var(--red-gc)', no_data: 'var(--yellow-gc)', wait: 'var(--yellow-gc)',
  skipped: 'var(--text-secondary)', pending: 'var(--text-secondary)', na: 'var(--text-secondary)',
};

// Claves de régimen (edge.bars_by_regime) → etiqueta legible.
const REGIME_ES: Record<string, string> = {
  low_vol: 'vol baja', normal: 'normal', elevated: 'vol elevada', caution: 'cautela',
};

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? '—' : Number.isInteger(n) ? `${n}` : n.toFixed(d);

// Mid del leg desde bid/ask del socket. null si falta cualquiera de los dos.
const legMid = (bid?: number, ask?: number): number | null =>
  !bid || !ask || bid <= 0 || ask <= 0 ? null : (bid + ask) / 2;

// Punto verde: el valor de esta celda es live (recalculado del socket), no un snapshot.
function LiveDot() {
  return <span className="rpf-live" aria-label="en vivo" />;
}

// Celdas de la tabla del candidato: números a la derecha, como el resto de las tablas.
const Th = ({ children, colSpan, rowSpan }: { children: React.ReactNode; colSpan?: number; rowSpan?: number }) =>
  <th colSpan={colSpan} rowSpan={rowSpan}>{children}</th>;
const Td = ({ children, color }: { children: React.ReactNode; color?: string }) =>
  <td style={color ? { color } : undefined}>{children}</td>;

// Sublínea OI + cierre previo bajo un strike (datos estáticos del candle anterior).
function StrikeMeta({ meta }: { meta: LegMeta | null | undefined }) {
  if (!meta || (meta.openInterest == null && meta.prevClose == null)) return null;
  const parts: string[] = [];
  if (meta.openInterest != null) parts.push(`OI ${fmtOI(meta.openInterest)}`);
  if (meta.prevClose != null) parts.push(fmtPrice(meta.prevClose, 2));
  return <span className="rpf-strike-meta">{parts.join(' · ')}</span>;
}

// El tick se lee en la misma zona que el reloj del encabezado (Argentina): con zonas distintas, comparar
// frescura entre los dos daba una hora de diferencia fantasma.
const tickTime = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
  const c = STATUS_COLOR[status] ?? 'var(--text-secondary)';
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
  const color = STATUS_COLOR[c.status] ?? 'var(--text-secondary)';
  const valTxt = c.value != null
    ? `${fmt(c.value)}${c.threshold != null ? ` / ${fmt(c.threshold)}` : ''}`
    : '';
  const showDetail = !!c.detail && c.status !== 'pass';
  return (
    <div className="rpf-row">
      <StatusIcon status={c.status} />
      <div className="rpf-row-label">{c.label}{showDetail && <span>{c.detail}</span>}</div>
      <span className="rpf-row-value" style={c.status === 'fail' ? { color } : undefined}>{valTxt}</span>
    </div>
  );
}

// Fila de gate de disparo: valor libre (texto) + estado con reloj para "esperando".
function DisparaRow({ label, hint, value, status }: {
  label: string; hint?: string; value: string; status: 'pass' | 'fail' | 'wait' | 'na';
}) {
  const color = status === 'pass' || status === 'na' ? undefined : STATUS_COLOR[status];
  return (
    <div className="rpf-row">
      <StatusIcon status={status} />
      <div className="rpf-row-label">{label}{hint && <span>{hint}</span>}</div>
      <span className="rpf-row-value" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

// Eje ARMA: macro y filtros de señal (VRP, cola). Si la cascada cortó en macro, los filtros no corrieron.
function ArmaPanel({ st, armed, vetoed }: { st: RpfStateUpdate; armed: boolean; vetoed: boolean }) {
  const macro = st.macroChecks ?? [];
  const gates = st.gates ?? [];
  const right = vetoed ? 'Vetado' : armed ? 'Armado' : 'No armado';
  const rightColor = vetoed ? 'var(--red-gc)' : armed ? 'var(--green)' : 'var(--text-secondary)';
  return (
    <section className="rpf-block">
      <h3>¿El entorno es seguro? <span style={{ color: rightColor }}>{right}</span></h3>
      <h4>Macro</h4>
      {macro.length > 0 ? macro.map((c) => <CheckRow key={c.id} c={c} />) : <p className="rpf-note">Macro no evaluado.</p>}
      <h4>Prima y cola</h4>
      {gates.length > 0 ? gates.map((c) => <CheckRow key={c.id} c={c} />) : <p className="rpf-note">No evaluado: la cascada cortó en macro.</p>}
    </section>
  );
}

// Eje DISPARA: edge contra la barra del régimen, cupo y enfriamiento. Atenuado si el entorno no armó.
function DisparaPanel({ st, active }: { st: RpfStateUpdate; active: boolean }) {
  const edge = st.edge ?? st.candidate?.edge ?? null;
  const bar = st.bar ?? st.candidate?.bar ?? null;
  const edgeOk = edge != null && bar != null && edge >= bar;
  const open = st.openPositions ?? 0;
  const max = st.maxPositions || 2;
  const capOk = st.capacityAvailable ?? (open < max);
  const cd = st.cooldownRemainingSec ?? 0;
  const regimeLabel = st.regime ? `barra del régimen ${REGIME_ES[st.regime] ?? st.regime}` : 'barra del régimen';
  const heat = st.heatPct != null ? ` · uso ${(st.heatPct * 100).toFixed(0)} %` : '';

  return (
    <section className={'rpf-block' + (active ? '' : ' rpf-idle')}>
      <h3>¿La prima paga? <span style={{ color: active ? 'var(--green)' : 'var(--text-secondary)' }}>{active ? 'Activo' : 'En espera'}</span></h3>
      {!active && <p className="rpf-note">Se evalúa cuando el entorno arma.</p>}
      <DisparaRow label="Edge contra la barra" hint={regimeLabel}
        value={edge != null ? `${fmt(edge)} ${edgeOk ? '≥' : '<'} ${fmt(bar)}` : '—'}
        status={edge == null ? 'na' : edgeOk ? 'pass' : 'fail'} />
      <DisparaRow label="Cupo de cartera" hint={`máximo ${max}${heat}`} value={`${open} de ${max}`}
        status={!active ? 'na' : capOk ? 'pass' : 'fail'} />
      <DisparaRow label="Enfriamiento" hint="evita volver a disparar la misma señal"
        value={cd > 0 ? `${Math.round(cd)} s` : 'inactivo'} status={cd > 0 ? 'wait' : 'pass'} />
    </section>
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

  const header = <h3>Candidato <span>{note}</span></h3>;

  if (!cand || cand.shortPutStrike == null) {
    return (
      <section className="rpf-block rpf-candidate">
        {header}
        <p className="rpf-note">El motor no propuso una posición candidata.</p>
      </section>
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
  const ratioColor = ratioPct == null ? undefined : ratioPct >= 33.3 ? 'var(--green)' : ratioPct >= 25 ? 'var(--yellow-gc)' : 'var(--red-gc)';
  const maxProfit = credit != null ? credit * 100 : null;
  const maxLoss   = credit != null && width != null ? (width - credit) * 100 : null;
  const bpr       = maxLoss; // PCS: BPR = ancho − crédito (= max loss)

  const liveCell = (v: React.ReactNode) => <span>{v}{isLive && <LiveDot />}</span>;

  return (
    <section className="rpf-block rpf-candidate">
      {header}
      <div className="rpf-table">
        <table>
          <thead>
            <tr>
              <Th rowSpan={2}>Símbolo</Th>
              <Th rowSpan={2}>DTE</Th>
              <Th rowSpan={2}>Precio</Th>
              <Th rowSpan={2}>Estructura</Th>
              <Th colSpan={2}>Strikes</Th>
              <Th colSpan={2}>Prima</Th>
              <Th rowSpan={2}>Crédito neto</Th>
              <Th rowSpan={2}>Regla 1/3</Th>
              <Th rowSpan={2}>POP</Th>
              <Th rowSpan={2}>Ganancia máxima</Th>
              <Th rowSpan={2}>Pérdida máxima</Th>
              <Th rowSpan={2}>BPR</Th>
            </tr>
            <tr>
              <Th>Comprado</Th>
              <Th>Vendido</Th>
              <Th>Comprado</Th>
              <Th>Vendido</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td color="var(--text-primary)"><strong>{symbol}</strong></Td>
              <Td>
                {cand.dte ? `${cand.dte} d` : '—'}
                {cand.expiration && <span className="rpf-strike-meta">{fmtExpiry(cand.expiration)}</span>}
              </Td>
              <Td>{price != null && price > 0 ? fmtPrice(price) : '—'}</Td>
              <Td>Put spread</Td>
              <Td>
                <div>{cand.longPutStrike != null ? fmtPrice(cand.longPutStrike, 0) : '—'}</div>
                <StrikeMeta meta={cand.legMeta?.longPut} />
              </Td>
              <Td>
                <div>{fmtPrice(cand.shortPutStrike, 0)}{cand.shortPutDelta != null && <span className="rpf-delta">Δ {Math.abs(cand.shortPutDelta).toFixed(2)}</span>}</div>
                <StrikeMeta meta={cand.legMeta?.shortPut} />
              </Td>
              <Td>{longPutMid != null ? <span>{fmtPrice(longPutMid, 2)}<LiveDot /></span> : ls?.longPut ? '…' : '—'}</Td>
              <Td>{shortPutMid != null ? <span>{fmtPrice(shortPutMid, 2)}<LiveDot /></span> : ls?.shortPut ? '…' : '—'}</Td>
              <Td color={credit != null ? (credit > 0 ? 'var(--green)' : 'var(--red-gc)') : undefined}>
                {credit != null ? liveCell(`$${fmtPrice(credit, 2)}`) : '—'}
              </Td>
              <Td color={ratioColor}>{ratioPct != null ? liveCell(`${ratioPct.toFixed(1)}%`) : '—'}</Td>
              <Td>{cand.pop != null ? `${cand.pop.toFixed(0)}%` : '—'}</Td>
              <Td color="var(--green)">{maxProfit != null ? liveCell(`$${fmtPrice(maxProfit, 0)}`) : '—'}</Td>
              <Td color="var(--red-gc)">{maxLoss != null ? liveCell(`$${fmtPrice(maxLoss, 0)}`) : '—'}</Td>
              <Td>{bpr != null ? liveCell(`$${fmtPrice(bpr, 0)}`) : '—'}</Td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
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

  const meta = STATE_META[state] ?? STATE_META.DORMANT;

  return (
    <div className="rpf-symbol">
      <div className="rpf-state">
        <h2>{symbol} <span style={{ color: meta.color }}>{meta.es}</span></h2>
        {st && st.cascadeOk === false && <span className="rpf-warn"><AlertTriangle size={13} /> Sin datos de la cascada</span>}
      </div>
      <p className="rpf-explain">{STATE_EXPLAIN[state]}</p>

      <div className="rpf-axes">
        <ArmaPanel st={stFull} armed={armed} vetoed={vetoed} />
        <DisparaPanel st={stFull} active={active} />
      </div>

      <CandidateCard symbol={symbol} cand={st?.candidate ?? null} note={note}
        subscribeLeg={subscribeLeg} unsubscribeLeg={unsubscribeLeg} socketStatus={socketStatus} />

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
    <div className="rpf-page">
      <div className="rpf-motor">
        <span className={loopOnline ? 'rpf-motor-on' : 'rpf-motor-off'}><i aria-hidden="true" />
          {switchOff ? 'Motor apagado' : loopOnline ? `Motor al día${lastTick ? ` · último tick ${lastTick}` : ''}` : `Motor sin noticias${lastTick ? ` desde ${lastTick}` : ''}`}</span>
        <button type="button" onClick={() => setRefOpen(true)} title="Definiciones de la estrategia y JSON de reglas"><BookOpen size={15} />Referencias</button>
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
      {!loopOnline && (
        <p className="rpf-note rpf-offline">El backend no está enviando el estado de RPF. El tablero se llena en cuanto el motor emite; no se calcula nada en el navegador.</p>
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
        <p className="rpf-note">Motor conectado: esperando el primer estado de SPY.</p>
      )}
      </>
      )}
    </div>
  );
}
