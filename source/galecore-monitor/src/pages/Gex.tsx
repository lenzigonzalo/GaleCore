import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, BookOpen, Crosshair } from 'lucide-react';
import { MarketWatchlist } from '../components/ticker/MarketWatchlist';
import { TickerGrid } from '../components/ticker/TickerGrid';
import { SymbolSearchCard } from '../components/ticker/SymbolSearchCard';
import { DetailsPanel } from '../components/gex/DetailsPanel';
import { OptionsChainList } from '../components/gex/OptionsChainList';
import { CHAIN_COL_W } from '../components/gex/graphLayout';
import { ExpiryEngine } from '../components/gex/ExpiryEngine';
import { GexChart } from '../components/chart/GexChart';
import { StrategySwitch } from '../components/common/StrategySwitch';
import { StrategyOffPanel } from '../components/common/StrategyOffPanel';
import { ReferencesModal } from '../components/common/ReferencesModal';
import { getStrategyReference } from '../components/strategy/strategyReferences';
import { GEX_SWITCH_ENDPOINT } from '../api/gex';
import { useGexStore } from '../store/useGexStore';
import { useMarketStore } from '../store/useMarketStore';
import { useAppConfigStore, useSwitchEndpoint } from '../store/useAppConfigStore';
import { useSwitchEnabled } from '../store/useStrategySwitchStore';
import { ConnectionStatus } from '../socket/useMarketSocket';
import {
  GexChartData, GexExpiryApi, GexScopeApi, GexStrikeApi, GLOBAL_SCOPE,
} from '../types/gex';
import { fmtPrice, fmtTime, isStale, tint } from '../utils/formatters';

// Fallback si el JSON no declara refresh_seconds. Los barridos se serializan en el backend, así que
// lo que manda es recorrer el universo entero (~383s medidos con 4 símbolos), no un barrido suelto.
const DEFAULT_REFRESH_SECONDS = 600;
const DETAIL_HEIGHT = 500;

const GEX_REF = getStrategyReference('gex');

/** Strikes de la API al shape que dibuja GexBarsPanel. Igual para un vencimiento y para el agregado. */
function toChartStrikes(strikes: GexStrikeApi[]) {
  return strikes.map((s) => ({
    strike: s.strike,
    callGex: s.callGEX,
    putGex: s.putGEX,
    netGex: s.netGEX,
    callOI: s.callOI,
    putOI: s.putOI,
    callDelta: s.callDelta,
    putDelta: s.putDelta,
  }));
}

/** Un vencimiento en el shape que dibuja GexChart + GexBarsPanel. */
function toChartData(symbol: string, spot: number, expiry: GexExpiryApi | null): GexChartData | null {
  if (!expiry) return null;
  return {
    symbol,
    spot,
    dte: expiry.dte,
    expiration: expiry.expiration,
    zeroGammaLevel: expiry.gammaZeroLevel ?? 0,
    netGex: expiry.netGex,
    callWall: expiry.callWall ?? 0,
    putWall: expiry.putWall ?? 0,
    callBand: expiry.callBand,
    putBand: expiry.putBand,
    expectedMove: expiry.expectedMove,
    strikes: toChartStrikes(expiry.strikes),
  };
}

/**
 * El agregado de toda la cadena en el mismo shape. ZGL y muros ya vienen calculados sobre los
 * strikes agregados, así que el gráfico no hace nada distinto: dibuja otro scope.
 *
 * `dte: 0` y `expiration: GLOBAL_SCOPE` son relleno del contrato — el agregado no tiene ninguno de
 * los dos. Nadie los lee: `expiration` no se usa en el chart, y `dte` solo entra en las bandas
 * ±1σ/±2σ, que en global no se dibujan porque no hay IV ATM que las alimente.
 *
 * **El sombreado de la banda va en null**, por lo mismo que el expected move: su ancho es una
 * fracción del EM y el agregado no tiene un `t`. El muro sí sale, porque el argmax es un máximo
 * sobre strikes y no necesita EM.
 */
function globalToChartData(symbol: string, spot: number, global: GexScopeApi): GexChartData | null {
  if (!global.strikes.length) return null;
  return {
    symbol,
    spot,
    dte: 0,
    expiration: GLOBAL_SCOPE,
    zeroGammaLevel: global.gammaZeroLevel ?? 0,
    netGex: global.netGex,
    callWall: global.callWall ?? 0,
    putWall: global.putWall ?? 0,
    callBand: null,
    putBand: null,
    expectedMove: null,
    strikes: toChartStrikes(global.strikes),
  };
}

/**
 * Pestaña GEX — estrategia informativa. Replica el layout de Main leyendo su propio JSON:
 * cards del universo, cuadro Details (checks + diagnóstico, sin microestructura) con el GEX GLOBAL,
 * y el cuadro Graph con la cadena por vencimiento. No calcula ni muestra setup candidato.
 */
interface GexProps {
  subscribeSymbol: (symbol: string) => void;
  unsubscribeSymbol: (symbol: string) => void;
  socketStatus: ConnectionStatus;
}

export function Gex({ subscribeSymbol, unsubscribeSymbol, socketStatus }: GexProps) {
  const {
    tickers, display, rulesLoading, rulesError, loadRules,
    cache, loading, error, errorCode, selectedExpiry, fetchGex, selectExpiry,
    adHocSearch, adHocSymbols, pinAdHoc, unpinAdHoc, selectedSymbol, setSelectedSymbol,
  } = useGexStore();

  const platformTickers = useAppConfigStore((s) => s.tickers);

  // El switch es el mismo que muestra la card de GEX en Main: mismo endpoint, mismo store.
  const switchEndpoint = useSwitchEndpoint('gex', GEX_SWITCH_ENDPOINT);
  const switchEnabled = useSwitchEnabled(switchEndpoint);

  const [refOpen, setRefOpen] = useState(false);

  // El universo del JSON más lo que el operador pineó con el buscador. Los ad-hoc van al final y no
  // se mezclan con los declarados: son de esta sesión y de esta persona.
  const gridSymbols = useMemo(
    () => [...tickers, ...adHocSymbols],
    [tickers, adHocSymbols],
  );

  const active = selectedSymbol ?? tickers[0] ?? null;
  const isAdHoc = !!active && adHocSymbols.includes(active);

  const ticker = useMarketStore((s) => (active ? s.tickers[active] : undefined));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * El botón de la mira: ON encuadra el eje de precio en la zona gamma y lo mantiene ahí con cada
   * barrido y cada cambio de vencimiento.
   *
   * Vive acá y no adentro del gráfico porque el gráfico se remonta por símbolo (`key={active}`, para
   * no volver a pedir las velas al cambiar de vencimiento): un modo guardado adentro se perdería al
   * volver de otro ticker, y el botón no tendría dónde leerlo.
   */
  const [alineado, setAlineado] = useState(false);

  useEffect(() => { loadRules(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Suscribir al hub el DELTA del universo de GEX: los símbolos de su JSON que la plataforma no
  // streamea. App ya suscribe universe.tickers del config de app (SPY/QQQ); acá completamos el resto
  // (AAPL, SKM…) para que sus cards tengan precio/quote/estado de mercado en vivo, no solo el REST
  // inicial. Se excluye lo que ya suscribe la plataforma para no desuscribírselo al salir de la
  // pestaña: la conexión del hub es única y compartida con Monitor/RPF/Home.
  //
  // Gateado por el switch: en OFF la estrategia no puede seguir ocupando el hub con símbolos que
  // solo ella necesita. Apagarla tiene que apagar TODA su actividad, no solo el barrido.
  // Incluye a los ad-hoc: un símbolo pineado tiene que tener precio en vivo como cualquier otro, y
  // al despinearlo el cleanup lo desuscribe.
  const extraTickersKey = gridSymbols.filter((s) => !platformTickers.includes(s)).join(',');
  useEffect(() => {
    if (socketStatus !== 'connected' || !switchEnabled) return;
    const extras = extraTickersKey ? extraTickersKey.split(',') : [];
    extras.forEach(subscribeSymbol);
    return () => extras.forEach(unsubscribeSymbol);
  }, [extraTickersKey, socketStatus, switchEnabled, subscribeSymbol, unsubscribeSymbol]);

  // Carga inicial + auto-refresh del símbolo activo. El período sale del JSON (display_config).
  // Con el switch en OFF no se programa nada: el backend igual rechazaría el barrido, pero pedirlo
  // sería ruido. Se hace una sola lectura para traer el dato congelado a la pantalla.
  const refreshSeconds = display?.refresh_seconds ?? DEFAULT_REFRESH_SECONDS;

  // El símbolo ad-hoc no entra al intervalo: lo declara `ad_hoc_search.auto_refresh`, y no es una
  // preferencia de UI. Los barridos se serializan en un semáforo del backend y recorrer el universo
  // ya toma minutos, así que un símbolo de paso que se refresca solo entra a esa misma ronda.
  // El primer barrido sí sale: elegirlo en el buscador ES el acto manual.
  const autoRefresh = !isAdHoc || (adHocSearch?.auto_refresh ?? false);

  useEffect(() => {
    // En OFF no se pide NADA, ni siquiera la lectura inicial: antes se hacía un fetch para traer el
    // dato congelado a pantalla, pero con la pantalla reducida al cartel de apagado ese dato no se
    // muestra en ningún lado. Era una request al backend cuyo resultado nadie miraba.
    if (!active || !switchEnabled) return;
    if (!cache[active]) fetchGex(active);
    if (!autoRefresh) return;

    intervalRef.current = setInterval(() => fetchGex(active), refreshSeconds * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [active, refreshSeconds, switchEnabled, autoRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const entry = active ? cache[active] : undefined;
  const data = entry?.data ?? null;
  const isLoading = active ? loading[active] ?? false : false;
  const err = active ? error[active] ?? null : null;
  // 409 con code: el símbolo existe pero no se puede barrer. Es una respuesta, no una avería.
  const chainMissing = (active ? errorCode[active] : null) === 'option_chain_not_found';

  const expiries = useMemo(() => data?.gex.byExpiry ?? [], [data]);
  // Sin elección explícita manda el más cercano — que en día hábil es el 0DTE. El agregado global
  // NO es el default: es una lectura distinta (sin vencimiento, sin DTE) y se pide a mano.
  const activeExpiration = (active ? selectedExpiry[active] : null) ?? expiries[0]?.expiration ?? null;
  const isGlobalScope = activeExpiration === GLOBAL_SCOPE;
  const activeExpiry = useMemo(
    () => (isGlobalScope ? null : expiries.find((e) => e.expiration === activeExpiration) ?? null),
    [expiries, activeExpiration, isGlobalScope],
  );

  // Memoizado: sin esto el objeto se rehace en CADA render de la pantalla —o sea con cada tick de
  // precio— y el gráfico lo ve como datos nuevos. El encuadre del eje cuelga de ese cambio, así que
  // se recalculaba varias veces por segundo y le peleaba la escala al operador mientras la movía.
  const chartData = useMemo(
    () => (!active || !data
      ? null
      : isGlobalScope
        ? globalToChartData(active, data.spotPrice ?? 0, data.gex.global)
        : toChartData(active, data.spotPrice ?? 0, activeExpiry)),
    [active, data, isGlobalScope, activeExpiry],
  );

  // IV del vencimiento seleccionado, anualizada en % — alimenta las bandas ±1σ/±2σ del gráfico.
  // En global queda undefined y las bandas no se dibujan: el agregado no tiene IV ATM (ni un solo
  // vencimiento del que sacarla), y tomar la del más cercano sería mostrar otro scope.
  const iv30 = activeExpiry?.atmIv != null ? activeExpiry.atmIv * 100 : undefined;

  // Un vencimiento sin Greeks no aporta al agregado: el GEX da más chico sin que se note.
  const partialScan = !!data
    && data.gex.global.expirationsRequested > data.gex.global.expirationsIncluded;

  // Switch en OFF: lo que se ve es el último barrido y nadie lo va a actualizar. Se marca con la
  // hora del dato para que no se lea como vigente.
  const frozen = switchEnabled === false || !!data?.frozen;

  const updated = entry?.updatedAt ?? null;
  // El amarillo de "dato viejo" mide contra la cadencia del auto-refresh. Para un símbolo que nadie
  // va a refrescar, envejecer es el estado normal y no una anomalía: en vez del amarillo lleva la
  // etiqueta MANUAL, que dice por qué la hora no se mueve.
  const stale = autoRefresh && isStale(updated, refreshSeconds * 1000 * 1.5);

  if (rulesLoading) {
    return <div className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>Cargando reglas de GEX…</div>;
  }
  if (rulesError) {
    return <div className="p-4 text-xs" style={{ color: 'var(--red-gc)' }}>Error cargando reglas de GEX: {rulesError}</div>;
  }

  return (
    <div className="market-workspace"><div className="market-analysis">
      {/* Header — mismo formato que RPF: nombre de la estrategia + badge con su descripción. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px 0' }}>
        <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>{active || 'Mercado'}</span>
        <span className="market-analysis-label">Gamma exposure</span>
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
            title="Prender / apagar el barrido de la cadena. En OFF no se toca DXLink."
          />
        </span>
      </div>

      {GEX_REF && (
        <ReferencesModal
          open={refOpen}
          onClose={() => setRefOpen(false)}
          title="GEX · Referencias"
          accentColor={GEX_REF.accentColor}
          definitions={GEX_REF.definitions}
          fetchJson={GEX_REF.fetchJson}
        />
      )}

      {/* Switch en OFF: la pantalla se reduce al encabezado y un cartel. Cortar el árbol acá apaga
          actividad real, no solo píxeles — TickerGrid hace su propio polling REST de respaldo y el
          gráfico mantiene series vivas. Mostrar el último barrido "congelado" era peor: un panel
          lleno de números se lee como vigente aunque diga que no lo está. */}
      {switchEnabled === false ? (
        <div className="px-3">
          <StrategyOffPanel detail="Apagada para TODA la plataforma: no se barre la cadena, no se toca DXLink ni a pedido, y no se suscribe ningun simbolo propio de la estrategia. El estado se guarda, asi que un reinicio no la vuelve a prender sola." />
        </div>
      ) : (
      <>


      {active && (
        <>
          {/* ── Cuadro Graph — cadena por vencimiento ── */}
          <div style={{
            margin: '0 12px 12px',
            borderRadius: 10,
            overflow: 'hidden',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--bg-secondary)',
            boxShadow: 'var(--shadow-sm)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 14px',
              borderBottom: '1px solid var(--border-dark)',
              backgroundColor: 'var(--bg-tertiary)',
            }}>
              <span style={{
                fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 15,
                color: 'var(--text-primary)', letterSpacing: '0.04em',
              }}>
                {active} · {isGlobalScope ? 'Toda la cadena' : 'Por vencimiento'}
              </span>
              {/* A la derecha, y a la izquierda del spot: encuadrar la escala en la zona gamma.
                  Es un toggle con estado a la vista —no el switch ON/OFF del proyecto, que significa
                  otra cosa (kill switch de estrategia, global y de admin)— porque esto es una
                  preferencia de quien mira el gráfico. Se apaga solo cuando mueven la escala. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => setAlineado(v => !v)}
                  disabled={!chartData}
                  className="btn"
                  aria-pressed={alineado}
                  title={alineado
                    ? 'Alineación activa — clic para soltar la escala'
                    : (display?.chart_scale?.label ?? 'Encuadrar la escala en la zona gamma')}
                  style={{
                    padding: '3px 6px',
                    ...(alineado ? {
                      color: 'var(--blue-gc)',
                      backgroundColor: 'var(--blue-muted)',
                      borderColor: 'var(--blue-border)',
                    } : null),
                  }}
                  aria-label="Encuadrar la escala en la zona gamma"
                >
                  <Crosshair size={11} />
                </button>
                <span className="tabular-nums" style={{
                  fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)',
                }}>
                  Spot {fmtPrice(ticker?.price || data?.spotPrice || 0)}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', height: DETAIL_HEIGHT }}>
              {/* Izquierda: cadena + lectura numérica del vencimiento elegido */}
              <div style={{
                width: CHAIN_COL_W,
                flexShrink: 0,
                borderRight: '1px solid var(--border-dark)',
                overflowY: 'auto',
              }}>
                <OptionsChainList
                  expiries={expiries}
                  selected={activeExpiration}
                  onSelect={(scope) => selectExpiry(active, scope)}
                  label={display?.options_chain?.label}
                  globalNetGex={data?.gex.global.netGex}
                  maxDte={data?.gex.config.maxDte}
                  globalLabel={display?.options_chain?.global_row?.label}
                />
                <ExpiryEngine
                  scope={isGlobalScope && data
                    ? { kind: 'global', global: data.gex.global, maxDte: data.gex.config.maxDte ?? null }
                    : { kind: 'expiry', expiry: activeExpiry }}
                  label={display?.expiry_engine?.label}
                />
              </div>

              {/* Derecha: gráfico del vencimiento seleccionado */}
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                {isLoading && !chartData ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100%', gap: 8, fontSize: 14, color: 'var(--text-muted)',
                  }}>
                    <span className="spinner" /> Barriendo la cadena…
                  </div>
                ) : !chartData ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100%', fontSize: 14, color: 'var(--text-muted)',
                  }}>
                    No GEX data
                  </div>
                ) : (
                  <GexChart
                    // Key por símbolo, no por vencimiento: cambiar de vencimiento redibuja muros y
                    // barras sin remontar el chart (remontarlo volvería a pedir las velas).
                    key={active}
                    symbol={active}
                    currentPrice={ticker?.price ?? data?.spotPrice ?? 0}
                    openPrice={ticker?.open ?? 0}
                    iv30={iv30}
                    gexData={chartData}
                    candleInterval={display?.candles?.interval ?? '1h'}
                    candleBucketSeconds={3600}
                    maxCandles={display?.candles?.count ?? 100}
                    candleFromDays={30}
                    rightPadBars={display?.candles?.right_pad_bars ?? 10}
                    scaleConfig={display?.chart_scale}
                    alineado={alineado}
                    onDesalinear={() => setAlineado(false)}
                  />
                )}
              </div>
            </div>
          </div>
          {/* ── Cuadro Details — GEX global + contexto. Sin columna Microstructure. ── */}
          <div style={{
            margin: '0 12px 12px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            backgroundColor: 'var(--bg-secondary)',
            boxShadow: 'var(--shadow-sm)',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px 8px',
              borderBottom: '1px solid var(--border-dark)',
            }}>
              <span style={{
                fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'var(--text-muted)', fontFamily: 'var(--font-sans)',
              }}>
                Contexto y GEX global
              </span>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="tabular-nums" style={{
                  fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)',
                }}>
                  {/* Solo la COBERTURA del barrido. El GEX global se fue de acá: es una métrica y
                      vive en su celda del cuadro (grupo "Estructura gamma"), donde tiene su
                      referencia al lado. Repetido en el encabezado, el mismo número aparecía dos
                      veces en la misma pantalla con dos formatos distintos. */}
                  {data?.gex.global.expirationsIncluded ?? 0} vtos
                  {data?.gex.config.maxDte != null && ` ≤ ${data.gex.config.maxDte} DTE`}
                </span>
                {/* Barrido incompleto: sin este aviso, un GEX más chico por vencimientos faltantes
                    se lee como una caída real del gamma. */}
                {/* Barrido detenido: el dato es de antes y no se está actualizando. */}
                {frozen && (
                  <span
                    title={updated ? `Último barrido: ${fmtTime(updated)}` : 'Sin barrido en esta sesión'}
                    style={{
                      fontSize: 13, fontWeight: 700, letterSpacing: '0.06em',
                      padding: '2px 6px', borderRadius: 20,
                      color: 'var(--red-gc)',
                      backgroundColor: tint('var(--red-gc)', 10),
                      border: `1px solid ${tint('var(--red-gc)', 30)}`,
                      fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', cursor: 'help',
                    }}
                  >
                    DETENIDO{data ? ' · DATO CONGELADO' : ''}
                  </span>
                )}
                {/* Símbolo de paso: no lo refresca ningún intervalo, y la hora que está al lado no
                    se va a mover sola. Sin decirlo, esa hora quieta se lee como un dato colgado. */}
                {isAdHoc && !frozen && (
                  <span
                    title="Simbolo pineado con el buscador: no entra al auto-refresh del universo. Se rebarre con Reload."
                    style={{
                      fontSize: 13, fontWeight: 700, letterSpacing: '0.06em',
                      padding: '2px 6px', borderRadius: 20,
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                      fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', cursor: 'help',
                    }}
                  >
                    MANUAL
                  </span>
                )}
                {partialScan && (
                  <span
                    title={`Faltaron ${(data!.gex.global.expirationsRequested - data!.gex.global.expirationsIncluded)} vencimientos · cobertura ${data!.gex.global.coveragePct}% de los símbolos`}
                    className="tabular-nums"
                    style={{
                      fontSize: 13, fontWeight: 700, letterSpacing: '0.06em',
                      padding: '2px 6px', borderRadius: 20,
                      color: 'var(--yellow-gc)',
                      backgroundColor: 'var(--yellow-muted)',
                      border: '1px solid var(--yellow-border)',
                      fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', cursor: 'help',
                    }}
                  >
                    PARCIAL {data!.gex.global.expirationsIncluded}/{data!.gex.global.expirationsRequested}
                  </span>
                )}
                {updated && (
                  <span className="tabular-nums" style={{
                    fontSize: 12, fontFamily: 'JetBrains Mono, monospace',
                    color: stale ? 'var(--yellow-gc)' : 'var(--text-muted)',
                  }}>
                    {fmtTime(updated)}
                  </span>
                )}
                <button
                  onClick={() => fetchGex(active, true)}
                  disabled={isLoading || frozen}
                  className="btn"
                  title={frozen ? 'Barrido detenido: prendé la estrategia para rebarrer' : 'Rebarrer la cadena'}
                  style={frozen ? { opacity: 0.45, cursor: 'default' } : undefined}
                >
                  <RefreshCw size={10} className={isLoading ? 'animate-spin' : ''} />
                  Reload
                </button>
              </div>
            </div>

            {err ? (
              /* El símbolo sin cadena no es una avería: se dice con el texto de la API y sin el
                 rojo de error, que acá mandaría el mensaje equivocado — no hay nada que arreglar,
                 hay otro símbolo que elegir. */
              <div style={{
                padding: 16, fontSize: 14, lineHeight: 1.5,
                color: chainMissing ? 'var(--text-secondary)' : 'var(--red-gc)',
              }}>
                {chainMissing ? err : `Error cargando GEX: ${err}`}
                {chainMissing && (
                  <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-muted)' }}>
                    El buscador matchea tambien la descripcion, asi que devuelve ETFs sobre el
                    simbolo que no tienen cadena propia. Elegi otro.
                  </div>
                )}
              </div>
            ) : (
              <DetailsPanel
                data={data}
                groups={display?.details_panel?.groups}
                subtitle={display?.details_panel?.subtitle
                  ?? 'Contexto de mercado — lectura informativa'}
              />
            )}
          </div>

        </>
      )}
      </>
      )}
    </div>
    {switchEnabled !== false && (      <MarketWatchlist>
        <TickerGrid layout="list"
          symbols={gridSymbols}
          selectedSymbol={active}
          onSelect={setSelectedSymbol}
          removableSymbols={adHocSymbols}
          onRemoveSymbol={(symbol) => {
            // Si se saca el que estaba abierto, la pantalla vuelve al primero del universo en vez
            // de quedarse mostrando un símbolo que ya no está en la grilla.
            if (active === symbol) setSelectedSymbol(null);
            unpinAdHoc(symbol);
          }}
          trailing={adHocSearch?.enabled ? (
            <SymbolSearchCard compact
              minQueryLength={adHocSearch.min_query_length}
              maxResults={adHocSearch.max_results}
              instrumentTypes={adHocSearch.allowed_instrument_types}
              onPick={(symbol) => {
                const pinned = pinAdHoc(symbol);
                if (pinned) setSelectedSymbol(pinned);
              }}
            />
          ) : undefined}
        />
      </MarketWatchlist>)}
    </div>
  );
}
