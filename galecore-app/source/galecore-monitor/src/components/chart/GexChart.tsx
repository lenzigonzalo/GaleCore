import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  LineStyle,
  IPriceLine,
  ColorType,
  CrosshairMode,
  AutoscaleInfo,
} from 'lightweight-charts';
import { GexChartData } from '../../types/gex';
import { fetchEquityCandles } from '../../api/marketdata';
import { etDateParts, etOffsetMinutes } from '../../utils/formatters';
import { appZoom } from '../../utils/appZoom';
import { gammaZoneRange } from './gammaZone';
import { GEX_BARS_W } from '../gex/graphLayout';
import type { AlertLevel, AxisLabels, ChartLayer, LayerCtx, PositionLevel } from './chartLayers';

const BARS_W_KEY = 'galecore:market:bars-width';
const BARS_W_MIN = 160;
const BARS_W_MAX_FRAC = 0.6;

interface Props {
  readable?: boolean;
  symbol:       string;
  currentPrice: number;
  openPrice?:   number;
  iv30?:        number;
  gexData:      GexChartData | null;
  /** Temporalidad de las velas. Default '5m' (intradía de Main). La pestaña GEX pasa '1h'. */
  candleInterval?: string;
  /** Segundos por vela — define el bucket de la actualización live. Debe acompañar a candleInterval. */
  candleBucketSeconds?: number;
  /** Se queda con las últimas N velas. Sin esto muestra todo lo que devuelva la API. */
  maxCandles?: number;
  /** Días calendario hacia atrás a pedir. Sin esto arranca en el open de hoy (intradía). */
  candleFromDays?: number;
  /** Barras vacías a la derecha: corren las velas a la izquierda y dejan aire para el precio. */
  rightPadBars?: number;
  /**
   * El botón «Encuadrar». En ON el eje de precio se fija en la zona gamma (ver `gammaZoneRange`) y se
   * recalcula con cada barrido o cambio de vencimiento; en OFF manda la autoescala normal. El estado
   * vive en la PANTALLA porque el gráfico se remonta por símbolo.
   */
  alineado?: boolean;
  /** Lo llama el gráfico cuando el operador mueve la escala a mano o toca «Reencuadrar»: la mira se apaga. */
  onDesalinear?: () => void;
  /** Avisos de precio (WS-0064): los dibuja la capa «Avisos». */
  alertLevels?: AlertLevel[];
  /** Niveles de las posiciones reales del símbolo: los dibuja la capa «Mis posiciones». */
  positionLevels?: PositionLevel[];
  /** Precios que el encuadre normal tiene que dejar a la vista (avisos, posiciones). */
  extraLevels?: number[];
  /** Las capas disponibles y cuáles están prendidas (panel lateral de la pantalla). */
  layers?: ChartLayer[];
  layerOn?: Record<string, boolean>;
}

const EMPTY_REASON = 'Sin velas para este período: mercado cerrado o sin datos del bróker.';

/**
 * El motivo legible de una falla al pedir velas, en una línea: lo que dice la API (`error`, con su
 * `code` estable) o, si no dijo nada, lo que se sabe del estado de la respuesta.
 */
export function candleErrorReason(err: any): string {
  const status: number | undefined = err?.response?.status;
  const body = err?.response?.data;
  const apiMessage: string | undefined = typeof body?.error === 'string' && body.error.trim() ? body.error.trim()
    : typeof body?.message === 'string' && body.message.trim() ? body.message.trim() : undefined;
  const code: string | undefined = body?.code;
  if (code === 'broker_account_not_linked' || code === 'broker_credential_invalid') {
    return `Sin datos del bróker: ${apiMessage ?? (code === 'broker_account_not_linked' ? 'no hay cuenta vinculada.' : 'la credencial fue rechazada.')}`;
  }
  if (apiMessage) return status ? `${apiMessage} (HTTP ${status})` : apiMessage;
  if (status === 401 || status === 403) return 'Sin permiso para leer el precio: iniciá sesión de nuevo.';
  if (status === 404) return 'La API no tiene velas para este símbolo.';
  if (status && status >= 500) return `Error de la API al leer el precio (HTTP ${status}).`;
  if (status) return `La API rechazó el pedido de velas (HTTP ${status}).`;
  if (err?.code === 'ECONNABORTED') return 'La API tardó más de 45 s en responder las velas.';
  return 'No se pudo conectar con la API para leer el precio.';
}

const DEFAULT_BUCKET = 5 * 60;

/** El 8% que el eje de precio se reserva arriba y abajo. */
const SCALE_MARGIN = 0.08;

/**
 * El 1er EM: el mismo número que dibuja la línea ±1σ y que encuadra el botón. Sale de acá y no de
 * dos cuentas parecidas — si el botón encuadrara con un EM distinto del que se ve, el borde caería
 * en cualquier lado.
 *
 * **Primero el del backend**, que lo calcula con la IV ATM de ESE vencimiento. La cuenta local con
 * IV 30d es el fallback y tiene un agujero: con `dte = 0` da CERO, así que en un 0DTE el 1er EM
 * desaparecía como ancla y el marco se reducía al ancho de los muros —tres puntos— con las velas
 * de 30 días adentro. El agregado no tiene EM y ahí el cero es correcto: no hay vencimiento.
 */
export function expectedMove(g: GexChartData, iv30?: number): number {
  if (g.expectedMove && g.expectedMove > 0) return g.expectedMove;
  return iv30 && iv30 > 0 && g.spot > 0 && g.dte > 0
    ? g.spot * (iv30 / 100) * Math.sqrt(g.dte / 365)
    : 0;
}

function getBucket(s: number, bucketSeconds: number) {
  return Math.floor(s / bucketSeconds) * bucketSeconds;
}

/**
 * Instante Unix del open (09:30 ET) de hoy.
 *
 * Antes calculaba el offset con una regla por mes ("marzo a noviembre = -4") y tomaba el día con
 * getUTCDate(). Las dos cosas estaban mal: la regla se equivoca la primera semana de marzo y casi
 * todo noviembre (el DST arranca el 2º domingo de marzo y termina el 1er domingo de noviembre), y
 * el día UTC no es el día ET de noche en Buenos Aires — a las 22:00 marcaba el open de mañana.
 * Ahora los dos salen de los helpers de formatters, que usan Intl.
 */
function marketOpenUnix(): number {
  const [y, m, d] = etDateParts();
  // Instante "09:30 como si ET fuera UTC"; restarle el offset lo lleva al UTC real del open.
  const asIfUtc = Date.UTC(y, m - 1, d, 9, 30);
  return Math.floor((asIfUtc - etOffsetMinutes(new Date(asIfUtc)) * 60_000) / 1000);
}

/**
 * Etiquetas del eje de precio sin solaparse. Las líneas de precio (muros, ZGL, σ, avisos) y el
 * último precio compiten por el mismo borde: cuando dos etiquetas quedan a menos de `gap` píxeles,
 * se oculta la de menor prioridad (la línea sigue dibujada). El último precio manda siempre.
 */
/** Prioridad desde la cual una etiqueta del eje es de un muro y no se oculta nunca. */
const WALL_PRIORITY = 80;

function createAxisLabels(onChange: () => void) {
  const entries = new Map<IPriceLine, { priority: number; title: string }>();
  const api: AxisLabels = {
    add(line, priority, title) { entries.set(line, { priority, title }); onChange(); },
    remove(line) { entries.delete(line); },
  };
  // Las marcas automáticas del eje no se pueden ocultar una por una, pero sí se formatean: `blank`
  // devuelve true para una marca redonda que cae pegada a una etiqueta visible, y el formateador del
  // eje la dibuja vacía. Los precios no redondos (el crosshair, las propias etiquetas) no se tocan.
  let shown: number[] = [];
  let shownSeries: ISeriesApi<any> | null = null;
  let shownGap = 0;
  const blank = (price: number) => {
    if (!shownSeries || !shown.length) return false;
    if (Math.abs(price * 4 - Math.round(price * 4)) > 1e-6) return false;
    const y = shownSeries.priceToCoordinate(price);
    if (y == null) return false;
    return shown.some(p => {
      if (Math.abs(p - price) < 1e-6) return false;
      const yp = shownSeries!.priceToCoordinate(p);
      return yp != null && Math.abs((yp as number) - (y as number)) < shownGap;
    });
  };
  const reflow = (series: ISeriesApi<any> | null, lastPrice: number, gap: number, hideTitles: boolean, onShown?: () => void) => {
    if (!series) return;
    const prevShown = shown.join('|');
    const taken: number[] = [];
    const takenPrices: number[] = [];
    const last = lastPrice > 0 ? series.priceToCoordinate(lastPrice) : null;
    const items = Array.from(entries).map(([line, e]) => ({ line, e, y: series.priceToCoordinate(line.options().price) }))
      .sort((a, b) => b.e.priority - a.e.priority);
    // Los muros (prioridad >= WALL_PRIORITY) nunca se ocultan: si el último precio queda pegado a uno,
    // se oculta la etiqueta del último precio (el valor sigue en el encabezado) y no la del muro.
    const wallYs = items.filter(i => i.e.priority >= WALL_PRIORITY && i.y != null).map(i => i.y as number);
    const lastHidden = last != null && wallYs.some(w => Math.abs(w - (last as number)) < gap);
    if (series.options().lastValueVisible === lastHidden) { try { series.applyOptions({ lastValueVisible: !lastHidden }); } catch { /* serie destruida */ } }
    if (last != null && !lastHidden) { taken.push(last as number); takenPrices.push(lastPrice); }
    for (const { line, e, y } of items) {
      const visible = y != null && (e.priority >= WALL_PRIORITY || taken.every(t => Math.abs(t - (y as number)) >= gap));
      if (visible) { taken.push(y as number); takenPrices.push(line.options().price); }
      const title = visible && !hideTitles ? e.title : '';
      const o = line.options();
      if (o.axisLabelVisible !== visible || o.title !== title) {
        try { line.applyOptions({ axisLabelVisible: visible, title }); } catch { /* línea quitada */ }
      }
    }
    shown = takenPrices; shownSeries = series; shownGap = gap;
    if (shown.join('|') !== prevShown) onShown?.();
  };
  return { api, reflow, blank };
}

export function GexChart({
  symbol, currentPrice, openPrice, iv30, gexData, readable = false,
  candleInterval = '5m',
  candleBucketSeconds = DEFAULT_BUCKET,
  maxCandles,
  candleFromDays,
  rightPadBars = 0,
  alineado = false,
  onDesalinear,
  alertLevels,
  positionLevels,
  extraLevels,
  layers = [],
  layerOn = {},
}: Props) {
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [historyError, setHistoryError] = useState('');
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [seriesVersion, setSeriesVersion] = useState(0);
  const outerRef      = useRef<HTMLDivElement>(null);   // flex container
  const containerRef  = useRef<HTMLDivElement>(null);   // chart div
  const chartRef      = useRef<IChartApi | null>(null);
  const seriesRef     = useRef<ISeriesApi<'Candlestick' | 'Line', any> | null>(null);
  const candlesRef    = useRef<{ time: number; open: number; high: number; low: number; close: number }[]>([]);
  const useCandlesRef = useRef(false);

  // Los datos vivos que el encuadre necesita para recalcularse. Van en refs porque los efectos que
  // encuadran se crean una vez: leer las props desde ahí daría las del primer render, o sea el
  // encuadre del barrido viejo.
  const gexRef      = useRef<GexChartData | null>(null);
  const ivRef       = useRef<number | undefined>(undefined);
  /** Precios que el encuadre normal incluye además de las velas (avisos y posiciones). */
  const alineadoRef = useRef(false);
  const avisarRef   = useRef<(() => void) | undefined>(undefined);
  alineadoRef.current = alineado;
  avisarRef.current   = onDesalinear;
  const bucketRef = useRef(candleBucketSeconds);
  bucketRef.current = candleBucketSeconds;

  const nivelesRef = useRef<number[]>([]);

  /** La sincronización del panel con el eje de precio, publicada por el efecto de montaje. */
  const sincronizarRef = useRef<(() => void) | null>(null);

  // renderTick: incremented on scroll/resize so the overlay layers re-render
  const [renderTick, setRenderTick] = useState(0);
  const [chartH, setChartH] = useState(400);
  const [chartW, setChartW] = useState(800);

  const bump = useCallback(() => setRenderTick(n => n + 1), []);

  // Ancho de la columna lateral (barras por strike), arrastrable desde su borde izquierdo y recordado por navegador.
  // Sin valor guardado, el panel arranca en ~35 % del ancho total (barsW null).
  const [barsW, setBarsW] = useState<number | null>(() => {
    try { const v = Number(localStorage.getItem(BARS_W_KEY)); if (Number.isFinite(v) && v >= BARS_W_MIN) return v; } catch { /* sin storage */ }
    return null;
  });
  const barsWRef = useRef<number>(GEX_BARS_W);
  const sideWidthRef = useRef<number>(GEX_BARS_W);
  const onDividerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX, startW = sideWidthRef.current;
    const total = (outerRef.current?.clientWidth ?? 0) || 1200;
    const move = (ev: PointerEvent) => { const w = Math.round(Math.max(BARS_W_MIN, Math.min(total * BARS_W_MAX_FRAC, startW + startX - ev.clientX))); barsWRef.current = w; setBarsW(w); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try { localStorage.setItem(BARS_W_KEY, String(barsWRef.current)); } catch { /* sin storage */ }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /**
   * Fija cómo se autoescala el eje de precio y deja la autoescala PRENDIDA, como TradingView: con zoom o arrastre del
   * eje de tiempo el precio se reacomoda a las velas visibles. Arrastrar el eje de precio la apaga (lo hace la
   * librería); «Reencuadrar» o el doble clic en el eje la vuelven a prender.
   *
   * - Zona gamma (botón «Encuadrar»): rango fijo de la zona gamma.
   * - Normal: las velas visibles más los muros del vencimiento elegido y los avisos (BF-0003), para que se vean.
   */
  const aplicarEncuadre = useCallback((
    series: ISeriesApi<'Candlestick' | 'Line', any>, g: GexChartData | null, iv?: number, soloNiveles = false,
  ) => {
    const chart = chartRef.current;
    if (!chart) return;
    const zona = alineadoRef.current && g ? gammaZoneRange(g.strikes, [g.spot, g.callWall, g.putWall, g.zeroGammaLevel]) : null;
    const niveles = [...nivelesRef.current, ...(g ? [g.callWall, g.putWall] : [])].filter(p => Number.isFinite(p) && p > 0);
    series.applyOptions({
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const base = original();
        if (zona) {
          // Owner 10/11: en 1D la zona gamma del vencimiento corto es más chica que el rango del mes; la mira encuadra
          // zona ∪ velas visibles para no cortar velas (en 5m/15m/1h sigue fija en la zona).
          const velas = bucketRef.current >= 86400 ? base?.priceRange : null;
          return { priceRange: {
            minValue: velas ? Math.min(zona.lo, velas.minValue) : zona.lo,
            maxValue: velas ? Math.max(zona.hi, velas.maxValue) : zona.hi,
          }, margins: { above: 0, below: 0 } };
        }
        if (!base?.priceRange || !niveles.length) return base;
        return { ...base, priceRange: {
          minValue: Math.min(base.priceRange.minValue, ...niveles),
          maxValue: Math.max(base.priceRange.maxValue, ...niveles),
        } };
      },
    });
    // Si sólo cambiaron los avisos/posiciones (refresco periódico) se respeta el zoom manual del eje de precio.
    if (!soloNiveles) chart.priceScale('right').applyOptions({
      scaleMargins: zona ? { top: 0, bottom: 0 } : { top: SCALE_MARGIN, bottom: SCALE_MARGIN },
      autoScale: true,
    });
    sincronizarRef.current?.();
  }, []);

  /** Prender o apagar la zona gamma cambia el encuadre. */
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    aplicarEncuadre(series, gexRef.current, ivRef.current);
    if (candlesRef.current.length) fitView();   // prendida: acerca el tiempo (1D); soltada: rango por defecto
  }, [alineado]); // eslint-disable-line react-hooks/exhaustive-deps

  // Encuadre del eje temporal. Con rightPadBars > 0 el rango visible se extiende N barras más allá
  // de la última vela: quedan esos slots vacíos a la derecha y las velas corridas a la izquierda.
  // fitContent() no sirve para eso — ajusta el rango exacto a los datos e ignora el offset.
  const labelsRef = useRef<ReturnType<typeof createAxisLabels> | null>(null);
  const priceFmt = useCallback((p: number) => (labelsRef.current?.blank(p) ? '' : p.toFixed(2)), []);
  const fitView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const n = candlesRef.current.length;
    // Con la mira prendida en 1D el tiempo se acerca a las últimas velas que entran en la zona gamma.
    const g = gexRef.current;
    const zona = alineadoRef.current && g && candleBucketSeconds >= 86400 && n > 0
      ? gammaZoneRange(g.strikes, [g.spot, g.callWall, g.putWall, g.zeroGammaLevel]) : null;
    if (zona) {
      const cs = candlesRef.current;
      let k = 0;
      for (let i = n - 1; i >= 0; i--) {
        if (cs[i].high > zona.hi || cs[i].low < zona.lo) break;
        k++;
      }
      const N = Math.min(n, Math.max(20, Math.min(60, k)));
      chart.timeScale().setVisibleLogicalRange({ from: n - N - 0.5, to: n - 1 + Math.max(rightPadBars, 0) });
    } else if (rightPadBars > 0 && n > 0) {
      chart.timeScale().setVisibleLogicalRange({ from: 0, to: n - 1 + rightPadBars });
    } else {
      chart.timeScale().fitContent();
    }
  }, [rightPadBars, candleBucketSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * «Reset chart»: vuelve al encuadre de entrada, pase lo que pase con la ruedita o el arrastre. El eje de tiempo
   * se reajusta a las velas y el de precio vuelve al encuadre gamma o de muros; sin datos gamma (Precio), a la
   * autoescala.
   */
  const resetChart = useCallback(() => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series) return;
    // «Reencuadrar» vuelve a la autoescala normal y al rango de tiempo por defecto, y apaga la mira.
    if (alineadoRef.current) { alineadoRef.current = false; avisarRef.current?.(); }
    fitView();
    aplicarEncuadre(series, gexRef.current, ivRef.current);
    bump();
  }, [fitView, aplicarEncuadre, bump]);

  // ── Build chart ────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#090909' },
        textColor: readable ? '#e5e5df' : '#b6b6b0',
        fontFamily: getComputedStyle(el).getPropertyValue('--font-sans').trim(),
        fontSize: (readable ? 15 : 13) * appZoom(),
        attributionLogo: false,
      },
      localization: { priceFormatter: priceFmt },
      grid: {
        vertLines: { color: 'rgba(30,48,74,0.5)', style: LineStyle.Dotted },
        horzLines: { color: 'rgba(30,48,74,0.5)', style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#484848', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#292929' },
        horzLine: { color: '#484848', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#292929' },
      },
      rightPriceScale: {
        borderColor: '#333333', textColor: '#b6b6b0',
        scaleMargins: { top: SCALE_MARGIN, bottom: SCALE_MARGIN },
      },
      // rightOffset mantiene el aire a la derecha cuando el usuario scrollea; fitView lo aplica al
      // encuadre inicial. Sin los dos, el padding se pierde en cuanto el chart se reajusta.
      timeScale: {
        borderColor: '#333333', timeVisible: true, secondsVisible: false, fixLeftEdge: true,
        rightOffset: rightPadBars,
        // Tope de alejamiento: con la ruedita las velas se aplastaban en una tira contra el borde y no había cómo volver.
        minBarSpacing: 2,
      },
      width:  el.clientWidth,
      height: el.clientHeight || 400,
    });

    const series = chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    const now    = Math.floor(Date.now() / 1000);
    const mktOpen = marketOpenUnix();
    const pts: { time: any; value: number }[] = [];
    // Only add open price if market already opened (mktOpen < now), otherwise time order breaks
    if (openPrice && openPrice > 0 && mktOpen < now) pts.push({ time: mktOpen, value: openPrice });
    if (currentPrice > 0)                             pts.push({ time: now, value: currentPrice });
    if (pts.length) series.setData(pts);

    chartRef.current  = chart;
    seriesRef.current = series;

    chart.timeScale().subscribeVisibleLogicalRangeChange(bump);

    const ro = new ResizeObserver(() => {
      if (el) {
        // fixLeftEdge ancla la izquierda: al angostarse el gráfico (panel de barras, watchlist) se perdían las
        // velas nuevas. Se conserva el espaciado entre velas y el borde derecho, como TradingView.
        const prevW = chart.options().width, rango = chart.timeScale().getVisibleLogicalRange();
        chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
        if (rango && prevW > 0 && el.clientWidth > 0 && el.clientWidth !== prevW) {
          const span = (rango.to - rango.from) * (el.clientWidth / prevW);
          chart.timeScale().setVisibleLogicalRange({ from: rango.to - span, to: rango.to });
        }
        setChartH(el.clientHeight);
        setChartW(el.clientWidth);
      }
      bump();
    });
    ro.observe(el);

    // ── Sincronización con el eje de PRECIO ───────────────────────────────────
    // `subscribeVisibleLogicalRangeChange` es del eje de TIEMPO: arrastrar o hacer rueda sobre la
    // escala vertical no lo dispara. Como el panel de barras no tiene escala propia —posiciona cada
    // strike con el `priceToCoordinate` de esta misma serie— se quedaba con las coordenadas
    // anteriores hasta el siguiente render por otra causa: un tick de precio, un scroll horizontal
    // o un resize. Con el mercado cerrado eso es "hasta que muevas otra cosa".
    //
    // lightweight-charts no publica un evento de cambio de rango de precio, así que se escuchan los
    // gestos que lo cambian y se compara el mapeo antes de re-renderizar: en un pan horizontal el
    // eje de precio no se movió y el panel no tiene por qué redibujar su SVG entero.
    // La firma son dos coordenadas fijas leídas al revés (`coordinateToPrice`): el mapeo es lineal,
    // así que dos puntos detectan tanto un desplazamiento como un zoom. Va en ese sentido y no con
    // `priceToCoordinate` de dos precios sonda porque las coordenadas 0 y 100 siempre son válidas,
    // mientras que un precio sonda fuera de la vista depende de cómo extrapole la librería.
    const firmaEscala = () => {
      const s = seriesRef.current;
      if (!s) return null;
      const arriba = s.coordinateToPrice(0);
      const abajo  = s.coordinateToPrice(100);
      return arriba == null || abajo == null ? null : `${arriba}|${abajo}`;
    };
    let firmaPrev = firmaEscala();
    // `porGesto` distingue quién movió el eje: el operador con el mouse, o nosotros al encuadrar.
    /** Devuelve si el eje se movió — o sea, si hubo algo que redibujar. */
    const sincronizar = (porGesto: boolean) => {
      const f = firmaEscala();
      if (f === firmaPrev) return false;
      firmaPrev = f;
      // Arrastrar el eje de precio apaga la autoescala (librería): la zona gamma ya no manda y la mira se suelta.
      if (porGesto && alineadoRef.current && !chart.priceScale('right').options().autoScale) avisarRef.current?.();
      bump();
      return true;
    };
    /**
     * Un cambio de rango puede tardar varios frames en aplicarse: el encuadre del botón prende el
     * autoscale y lightweight-charts recalcula cuando repinta, y el doble click (su reset propio)
     * hace lo mismo. Con una sola pasada en rAF el panel de barras se quedaba a veces con las
     * coordenadas del encuadre anterior, hasta que otra cosa lo redibujara.
     *
     * Se mira una ventana corta y se corta en cuanto el eje se movió: ni una sola pasada, que llega
     * temprano, ni un loop permanente. Cada pasada son dos lecturas de coordenada.
     */
    let rafId = 0;
    const sincronizarPronto = (porGesto: boolean, ms = 400) => {
      const fin = performance.now() + ms;
      cancelAnimationFrame(rafId);
      const paso = () => {
        if (sincronizar(porGesto)) return;
        if (performance.now() < fin) rafId = requestAnimationFrame(paso);
      };
      paso();
    };
    // El botón de encuadre entra por el mismo camino que un gesto: cambia el rango y pide la
    // sincronización, en vez de tener su propia forma de avisarle al panel. Pero no es un gesto:
    // el eje sigue siendo del encuadre, no del operador.
    sincronizarRef.current = () => sincronizarPronto(false);

    let arrastrando = false;
    const onDown = () => { arrastrando = true; };
    const onMove = () => { if (arrastrando) sincronizar(true); };
    const onUp   = () => { if (!arrastrando) return; arrastrando = false; sincronizarPronto(true); };
    const onGesto = () => sincronizarPronto(true);

    el.addEventListener('pointerdown', onDown);
    // move/up escuchan en window: el arrastre del eje sigue vivo aunque el puntero se salga del
    // gráfico, y ahí el evento ya no pasa por el contenedor.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onGesto, { passive: true });
    el.addEventListener('dblclick', onGesto);

    setChartH(el.clientHeight || 400);
    setChartW(el.clientWidth);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafId);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onGesto);
      el.removeEventListener('dblclick', onGesto);
      sincronizarRef.current = null;
      chart.remove();
      // Los refs se limpian DESPUÉS de destruirlo: un chart removido sigue respondiendo a
      // `priceScale()` pero tira "incorrect pane index" al aplicarle opciones. Pasa de verdad al
      // cambiar de símbolo, que remonta el componente (`key`), y en dev con StrictMode, que corre
      // los efectos de nuevo: el efecto del encuadre está declarado antes que este y encontraba el
      // chart viejo. Con los refs en null, cualquier efecto que llegue tarde no hace nada.
      chartRef.current  = null;
      seriesRef.current = null;
      useCandlesRef.current = false;
      candlesRef.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load intraday candles ─────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    let cancelled = false;
    setHistoryState('loading');
    setHistoryError('');
    fetchEquityCandles(symbol, candleInterval, { fromDays: candleFromDays, limit: maxCandles }).then(candles => {
      if (cancelled || !chartRef.current) return;
      if (!candles.length) { setHistoryError(EMPTY_REASON); setHistoryState('empty'); return; }
      const chart = chartRef.current;
      if (seriesRef.current && !useCandlesRef.current) {
        chart.removeSeries(seriesRef.current);
        const cs = chart.addSeries(CandlestickSeries, {
          upColor: '#22c55e', downColor: '#f43f5e',
          borderUpColor: '#22c55e', borderDownColor: '#f43f5e',
          wickUpColor: '#22c55e', wickDownColor: '#f43f5e',
          priceLineVisible: false, lastValueVisible: true,
        });
        cs.setData(candles as any);
        seriesRef.current    = cs;
        useCandlesRef.current = true;
        candlesRef.current   = candles;
        setSeriesVersion(v => v + 1);
        // El encuadre vive en la SERIE (es su proveedor de autoescala), así que cambiarla lo borra:
        // la serie de velas nace sin él y el eje se va al rango de las velas — 30 días de recorrido
        // en vez de la zona gamma. Se vuelve a aplicar acá, que es donde se pierde.
        //
        // No se notaba antes porque el efecto del encuadre se disparaba con cada tick de precio
        // (`chartData` se rehacía en cada render de la pantalla) y lo reponía en milisegundos.
        aplicarEncuadre(cs, gexRef.current, ivRef.current);
        fitView();
        bump();
      } else if (seriesRef.current) {
        seriesRef.current.setData(candles as any);
        candlesRef.current = candles;
        fitView();
      }
      setHistoryState('ready');
    }).catch((err) => {
      if (cancelled) return;
      setHistoryError(candleErrorReason(err));
      setHistoryState('error');
    });
    return () => { cancelled = true; };
  }, [symbol, candleInterval, candleFromDays, maxCandles, historyAttempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Live price update ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!seriesRef.current || currentPrice <= 0) return;
    const now    = Math.floor(Date.now() / 1000);
    const bucket = getBucket(now, candleBucketSeconds);
    if (useCandlesRef.current) {
      const candles = candlesRef.current;
      const last    = candles[candles.length - 1];
      if (last && (last.time === bucket || candleBucketSeconds >= 86400)) {
        const updated = { ...last, close: currentPrice, high: Math.max(last.high, currentPrice), low: Math.min(last.low, currentPrice) };
        try { seriesRef.current.update({ ...updated, time: updated.time as any }); } catch {}
        candlesRef.current[candles.length - 1] = updated;
      } else if (last && bucket > last.time) {
        const newC = { time: bucket, open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice };
        try { seriesRef.current.update({ ...newC, time: newC.time as any }); } catch {}
        candlesRef.current = [...candles, newC];
      }
    } else {
      try { seriesRef.current.update({ time: now as any, value: currentPrice }); }
      catch { seriesRef.current.setData([{ time: now as any, value: currentPrice }]); }
    }
  }, [currentPrice, candleBucketSeconds]);

  // ── Encuadre según la cadena GEX ──────────────────────────────────────────
  // Las capas que dependen de la cadena (muros, barras) fijan el marco del eje de precio. Sin
  // ninguna prendida el eje vuelve a la autoescala de las velas.
  const gex = layers.some(l => l.needsGex && layerOn[l.id]) ? gexData : null;
  const nivelesKey = (extraLevels ?? []).join('|');
  const encuadreAnt = useRef<unknown[] | null>(null);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const ant = encuadreAnt.current;
    const soloNiveles = !!ant && ant[0] === gex && ant[1] === iv30 && ant[2] === seriesVersion;
    encuadreAnt.current = [gex, iv30, seriesVersion];
    gexRef.current = gex;
    ivRef.current  = iv30;
    nivelesRef.current = extraLevels ?? [];
    aplicarEncuadre(series, gex, iv30, soloNiveles);
    if (!soloNiveles && alineadoRef.current && candlesRef.current.length) fitView();   // otro vencimiento: recalcula el acercamiento
    bump();
  }, [gex, iv30, seriesVersion, nivelesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Etiquetas del eje sin solaparse ───────────────────────────────────────
  const reflowRaf = useRef(0);
  const hideTitlesRef = useRef(false);
  hideTitlesRef.current = false;
  const currentPriceRef = useRef(currentPrice);
  currentPriceRef.current = currentPrice;
  const reflowLabels = useCallback(() => {
    cancelAnimationFrame(reflowRaf.current);
    reflowRaf.current = requestAnimationFrame(() => {
      // El obstáculo es la etiqueta del último valor de la serie, que es el cierre de la última vela.
      const lastClose = candlesRef.current[candlesRef.current.length - 1]?.close;
      labelsRef.current?.reflow(seriesRef.current, lastClose ?? currentPriceRef.current, 15 * appZoom() + 10, hideTitlesRef.current,
        () => chartRef.current?.applyOptions({ localization: { priceFormatter: priceFmt } }));
    });
  }, [priceFmt]);
  if (!labelsRef.current) labelsRef.current = createAxisLabels(reflowLabels);
  useEffect(() => { reflowLabels(); }, [renderTick, seriesVersion, currentPrice, reflowLabels]);
  useEffect(() => () => cancelAnimationFrame(reflowRaf.current), []);

  // priceToY: maps any price → canvas Y coordinate (reads seriesRef, refreshes on renderTick)
  const priceToY = useCallback((price: number): number | null => {
    if (!seriesRef.current) return null;
    const y = seriesRef.current.priceToCoordinate(price);
    return y == null ? null : (y as number);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderTick]);

  const historyMessage = historyError;
  const axisWidth = chartRef.current ? chartRef.current.priceScale('right').width() : 0;
  const timeH = chartRef.current ? chartRef.current.timeScale().height() : 0;
  const paneHeight = Math.max(0, chartH - timeH);
  const paneWidth = Math.max(0, chartW - axisWidth);
  // Tope del 60 % del gráfico (ventana angosta o watchlist abierta): se recalcula con el ancho total actual.
  const sideWidth = barsW == null
    ? Math.round(Math.max(BARS_W_MIN, (chartW * 0.35) / 0.65))
    : Math.round(Math.max(BARS_W_MIN, Math.min(barsW, (chartW + barsW) * BARS_W_MAX_FRAC)));
  sideWidthRef.current = sideWidth;
  const sideLayers = layers.filter(l => layerOn[l.id] && l.placement === 'side');
  const ctx: LayerCtx = {
    series: seriesRef.current, seriesVersion, gexData: gex, iv30, currentPrice, symbol,
    alive: () => chartRef.current !== null,
    alertLevels: alertLevels ?? [], positionLevels: positionLevels ?? [], axisLabels: labelsRef.current.api, priceToY,
    paneWidth, paneHeight, axisWidth, sideWidth,
  };

  return (
    <div ref={outerRef} style={{ display: 'flex', width: '100%', height: "100%", minHeight: 'calc(320px * var(--app-zoom))', zoom: 'calc(1 / var(--app-zoom))' }}>
      {/* El zoom global de la plataforma se anula acá: lightweight-charts calcula el mouse en píxeles de pantalla y
          dibuja el canvas con devicePixelRatio, así que bajo zoom el crosshair se corría 10 % y la imagen salía
          reescalada. Los textos propios (botón, avisos, fuente del gráfico) se reescalan aparte con --app-zoom.
          El wrapper es `relative`: las capas con overlay (perfil de barras por strike) se posicionan sobre el canvas
          con el mismo mapeo de precio que las velas (priceToCoordinate). */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {historyState !== 'ready' && <div role="status" className="chart-history-status">
          <span>{historyState === 'loading' ? 'Cargando velas…' : historyMessage}</span>
          {historyState !== 'loading' && <button className="btn" onClick={() => setHistoryAttempt(v => v + 1)}>Reintentar</button>}
        </div>}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        <button type="button" onClick={resetChart} className="chart-reset">Reencuadrar</button>
        {layers.filter(l => layerOn[l.id] && l.placement !== 'side').map(l => <React.Fragment key={l.id}>{l.render(ctx)}</React.Fragment>)}
      </div>
      {/* Capas laterales (barras por strike): columna a la derecha del eje, con su propia escala vertical. */}
      {sideLayers.length > 0 && (
        <div style={{ position: 'relative', flexShrink: 0, width: sideWidth }}>
          <div className="chart-side-divider" role="separator" aria-orientation="vertical" aria-label="Ancho del panel gamma"
            title="Arrastrar para cambiar el ancho" onPointerDown={onDividerDown} />
          {sideLayers.map(l => <React.Fragment key={l.id}>{l.render({ ...ctx, paneHeight: chartH })}</React.Fragment>)}
        </div>
      )}
    </div>
  );
}
