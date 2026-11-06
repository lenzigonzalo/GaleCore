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
import { GexChartData, GexTabDisplayConfig } from '../../types/gex';
import { fetchEquityCandles } from '../../api/marketdata';
import { etDateParts, etOffsetMinutes } from '../../utils/formatters';
import { appZoom } from '../../utils/appZoom';
import type { AlertLevel, AxisLabels, ChartLayer, LayerCtx } from './chartLayers';

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
  /** `display_config.gex_tab.chart_scale`: qué anclas y cuánto aire usa el encuadre. */
  scaleConfig?: GexTabDisplayConfig['chart_scale'];
  /**
   * El botón de la mira. En ON el eje de precio se encuadra en la zona gamma y se vuelve a encuadrar
   * con cada barrido; en OFF manda el encuadre por muros.
   *
   * El estado vive en la PANTALLA y no acá: el gráfico se remonta por símbolo (`key`), así que un
   * modo guardado adentro se perdería al cambiar de ticker.
   */
  alineado?: boolean;
  /** Lo llama el gráfico cuando el operador mueve la escala a mano: la alineación se apaga sola. */
  onDesalinear?: () => void;
  /** Avisos de precio (WS-0064): los dibuja la capa «Avisos». */
  alertLevels?: AlertLevel[];
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

/** Aire a cada lado del encuadre, como fracción del alto del marco, cuando el JSON no lo declara. */
const PADDING_PCT = 0.06;

/** El 8% que el eje de precio se reserva arriba y abajo fuera del encuadre gamma. */
const SCALE_MARGIN = 0.08;

type Rango = { lo: number; hi: number };

/**
 * Las anclas de cada lado, por el id que declara el JSON (`chart_scale.upper_anchors` /
 * `lower_anchors`). Son los tres niveles que el gráfico ya dibuja de ese lado, así que el encuadre
 * no inventa una referencia nueva: encuadra lo que el operador está mirando.
 *
 * `null` es "esta ancla no aplica acá" y no cero: el scope GLOBAL no tiene bandas, y un 0 metido en
 * el `Math.min` de abajo mandaría el piso del gráfico al origen.
 */
const ANCLAS_ARRIBA: Record<string, (g: GexChartData, em: number) => number | null> = {
  expected_move_1sigma: (g, em) => (em > 0 ? g.spot + em : null),
  call_wall:            (g)     => (g.callWall > 0 ? g.callWall : null),
  call_band_high:       (g)     => (g.callBand ? g.callBand.high : null),
};

const ANCLAS_ABAJO: Record<string, (g: GexChartData, em: number) => number | null> = {
  expected_move_1sigma: (g, em) => (em > 0 ? g.spot - em : null),
  put_wall:             (g)     => (g.putWall > 0 ? g.putWall : null),
  put_band_low:         (g)     => (g.putBand ? g.putBand.low : null),
};

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

/**
 * El encuadre "zona gamma": del mayor ancla de arriba al menor ancla de abajo, más `padding_pct`
 * del alto resultante a cada lado.
 *
 * **El aire va en proporción y no en strikes.** Dos strikes son el 17% del marco en un 0DTE (unos
 * 13 puntos de alto) y el 3% en un vencimiento a 42 días (unos 69): la misma regla se ve enorme de
 * un lado y no se ve del otro. Un porcentaje se ve igual en los dos.
 *
 * **El marco no se centra en el spot**: va pegado a las anclas. El spot queda al medio solo cuando
 * el EM es el ancla que manda de los dos lados, porque es la única simétrica — con el EM en cero
 * (0DTE) mandan el muro de arriba y la banda de abajo, que están a distancias distintas.
 */
function rangoZonaGamma(
  g: GexChartData, iv30: number | undefined, cfg?: GexTabDisplayConfig['chart_scale'],
): Rango | null {
  const em = expectedMove(g, iv30);
  const resolver = (ids: string[] | undefined, mapa: typeof ANCLAS_ARRIBA) =>
    (ids ?? Object.keys(mapa))
      .map(id => mapa[id]?.(g, em) ?? null)
      .filter((v): v is number => v != null && isFinite(v) && v > 0);

  const arriba = resolver(cfg?.upper_anchors, ANCLAS_ARRIBA);
  const abajo  = resolver(cfg?.lower_anchors, ANCLAS_ABAJO);
  if (!arriba.length || !abajo.length) return null;

  const techo = Math.max(...arriba);
  const piso  = Math.min(...abajo);
  if (!(piso < techo)) return null;

  const aire = (techo - piso) * (cfg?.padding_pct ?? PADDING_PCT);
  return { lo: piso - aire, hi: techo + aire };
}

/** El encuadre por defecto: los muros con un 1,5% de aire, que es lo que deja las velas legibles. */
function rangoMuros(g: GexChartData): Rango | null {
  if (!g.putWall || !g.callWall) return null;
  return { lo: g.putWall * 0.985, hi: g.callWall * 1.015 };
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
    const takenPrices: number[] = lastPrice > 0 ? [lastPrice] : [];
    const last = lastPrice > 0 ? series.priceToCoordinate(lastPrice) : null;
    if (last != null) taken.push(last as number);
    const items = Array.from(entries).map(([line, e]) => ({ line, e, y: series.priceToCoordinate(line.options().price) }))
      .sort((a, b) => b.e.priority - a.e.priority);
    for (const { line, e, y } of items) {
      const visible = y != null && taken.every(t => Math.abs(t - (y as number)) >= gap);
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
  scaleConfig,
  alineado = false,
  onDesalinear,
  alertLevels,
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
  const scaleRef    = useRef<GexTabDisplayConfig['chart_scale']>(undefined);
  const alineadoRef = useRef(false);
  const avisarRef   = useRef<(() => void) | undefined>(undefined);
  scaleRef.current    = scaleConfig;
  alineadoRef.current = alineado;
  avisarRef.current   = onDesalinear;

  /** El operador movió el eje de precio a mano: el barrido siguiente no se lo pisa. */
  const tocadoRef = useRef(false);
  const soltarRef = useRef(0);
  /** El vencimiento del último encuadre: cambiarlo SÍ vuelve a encuadrar, aunque lo hayan movido. */
  const expRef    = useRef<string | null>(null);

  /** La sincronización del panel con el eje de precio, publicada por el efecto de montaje. */
  const sincronizarRef = useRef<(() => void) | null>(null);

  // renderTick: incremented on scroll/resize so GexBarsPanel re-renders
  const [renderTick, setRenderTick] = useState(0);
  const [chartH, setChartH] = useState(400);
  const [chartW, setChartW] = useState(800);

  const bump = useCallback(() => setRenderTick(n => n + 1), []);

  /**
   * Fija el rango del eje de precio según el modo activo. Los dos modos comparten camino: el
   * proveedor de autoescala es lo único que decide qué tramo de precio se ve.
   */
  const aplicarEncuadre = useCallback((
    series: ISeriesApi<'Candlestick' | 'Line', any>, g: GexChartData, iv?: number,
  ) => {
    const chart = chartRef.current;
    const gamma = alineadoRef.current;
    const rango = gamma ? rangoZonaGamma(g, iv, scaleRef.current) : rangoMuros(g);
    if (!chart || !rango) return;
    series.applyOptions({
      // Sin margen en modo gamma: el aire ya viene medido en strikes, y un porcentaje encima haría
      // que "dos strikes más" no fueran dos strikes.
      autoscaleInfoProvider: () => ({
        priceRange: { minValue: rango.lo, maxValue: rango.hi },
        margins: { above: gamma ? 0 : 0.10, below: gamma ? 0 : 0.10 },
      }),
    });

    // Encuadrar y SOLTAR, en ese orden y en dos frames.
    //
    // El proveedor de autoescala es la única forma de fijar un rango de precio en
    // lightweight-charts, pero solo se consulta con el autoscale PRENDIDO — y con el autoscale
    // prendido el eje vuelve al encuadre apenas lo movés: el gráfico quedaba clavado, de entrada y
    // después de cada encuadre. Se prende para que recalcule con el rango nuevo y se apaga en el
    // frame siguiente, cuando ya lo aplicó: el eje se queda donde lo dejamos y de ahí en más el
    // operador lo mueve como quiera.
    // El encuadre que se está aplicando es el nuestro: lo que el operador hubiera movido antes queda
    // atrás. Va acá y no adentro del rAF de abajo, porque ahí llegaba un frame tarde y en el medio
    // podía entrar un gesto suyo — y el gesto perdía contra nuestro reset.
    tocadoRef.current = false;

    const escala = chart.priceScale('right');
    escala.applyOptions({
      // El eje se reserva un 8% arriba y abajo por su cuenta. En modo gamma va a cero: el aire lo
      // declara `padding_pct`, y sumarle otro 8% invisible haría que el número del JSON fuera menos
      // de la mitad de lo que se ve.
      scaleMargins: gamma ? { top: 0, bottom: 0 } : { top: SCALE_MARGIN, bottom: SCALE_MARGIN },
      autoScale: true,
    });
    cancelAnimationFrame(soltarRef.current);
    soltarRef.current = requestAnimationFrame(() => {
      // El chart puede haberse ido en el frame del medio (cambio de símbolo): aplicarle opciones a
      // uno destruido tira "incorrect pane index" y rompe la pantalla.
      if (chartRef.current !== chart) return;
      escala.applyOptions({ autoScale: false });
      // El panel de barras se entera por el mismo camino que un gesto: comparando el mapeo. Va
      // acá y no en cada llamador porque TODO encuadre lo necesita — el del botón y el del barrido.
      sincronizarRef.current?.();
    });
  }, []);

  /**
   * Prender la alineación encuadra. **Apagarla no toca el eje**: el botón se apaga solo cuando el
   * operador mueve la escala, y ahí saltar a otro encuadre sería exactamente lo contrario de lo que
   * pidió con ese gesto.
   */
  useEffect(() => {
    const series = seriesRef.current, g = gexRef.current;
    if (!alineado || !series || !g) return;
    aplicarEncuadre(series, g, ivRef.current);
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
    if (rightPadBars > 0 && n > 0) {
      chart.timeScale().setVisibleLogicalRange({ from: 0, to: n - 1 + rightPadBars });
    } else {
      chart.timeScale().fitContent();
    }
  }, [rightPadBars]);

  /**
   * «Reset chart»: vuelve al encuadre de entrada, pase lo que pase con la ruedita o el arrastre. El eje de tiempo
   * se reajusta a las velas y el de precio vuelve al encuadre gamma o de muros; sin datos gamma (Precio), a la
   * autoescala.
   */
  const resetChart = useCallback(() => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series) return;
    fitView();
    const g = gexRef.current;
    if (g) aplicarEncuadre(series, g, ivRef.current);
    else {
      tocadoRef.current = false;
      chart.priceScale('right').applyOptions({ autoScale: true, scaleMargins: { top: SCALE_MARGIN, bottom: SCALE_MARGIN } });
    }
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
        chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
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
    // Solo lo primero marca el eje como suyo — ver tocadoRef.
    /** Devuelve si el eje se movió — o sea, si hubo algo que redibujar. */
    const sincronizar = (porGesto: boolean) => {
      const f = firmaEscala();
      if (f === firmaPrev) return false;
      firmaPrev = f;
      if (porGesto) {
        // Mover la escala a mano APAGA la alineación. El eje pasa a ser del operador, y el botón
        // tiene que decirlo: un botón encendido sobre un encuadre que ya no es el suyo miente.
        tocadoRef.current = true;
        if (alineadoRef.current) avisarRef.current?.();
      }
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
      cancelAnimationFrame(soltarRef.current);
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
        if (gexRef.current) aplicarEncuadre(cs, gexRef.current, ivRef.current);
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
      if (last && last.time === bucket) {
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
  const alertsKey = (alertLevels ?? []).map(a => `${a.id}:${a.price}`).join('|');
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (!gex) {
      // Las líneas de precio no entran en la autoescala de lightweight-charts. Sin cadena GEX,
      // incluir los avisos para que un nivel fuera del recorrido de las velas siga visible (BF-0003).
      // No se reactiva autoScale: el zoom manual se conserva y Reset vuelve a este proveedor.
      const prices = (alertLevels ?? []).map(a => a.price).filter(p => Number.isFinite(p) && p > 0);
      series.applyOptions({ autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const base = original();
        if (!prices.length) return base;
        return { ...base, priceRange: {
          minValue: Math.min(base?.priceRange?.minValue ?? prices[0], ...prices),
          maxValue: Math.max(base?.priceRange?.maxValue ?? prices[0], ...prices),
        } };
      } });
      if (gexRef.current) {
        gexRef.current = null;
        expRef.current = null;
        chartRef.current?.priceScale('right').applyOptions({ autoScale: true, scaleMargins: { top: SCALE_MARGIN, bottom: SCALE_MARGIN } });
        bump();
      }
      return;
    }

    // Datos vivos para el botón de encuadre, que corre fuera de este efecto.
    gexRef.current = gex;
    ivRef.current  = iv30;

    // El encuadre se recalcula con cada barrido: si el modo es gamma, los muros y las bandas nuevas
    // mueven el marco. Salvo que el operador haya movido el eje a mano: ahí el eje es suyo hasta
    // que apriete el botón. Elegir OTRO vencimiento sí reencuadra: es pedir ver otra cosa.
    const cambioDeExpiracion = expRef.current !== gex.expiration;
    expRef.current = gex.expiration;
    if (cambioDeExpiracion || !tocadoRef.current) aplicarEncuadre(series, gex, iv30);

    fitView();
    bump();
  }, [gex, iv30, seriesVersion, alertsKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const ctx: LayerCtx = {
    series: seriesRef.current, seriesVersion, gexData: gex, iv30, currentPrice,
    alertLevels: alertLevels ?? [], axisLabels: labelsRef.current.api, priceToY,
    paneWidth, paneHeight, axisWidth,
  };

  return (
    <div ref={outerRef} style={{ display: 'flex', width: '100%', height: "100%", minHeight: 'calc(320px * var(--app-zoom))', zoom: 'calc(1 / var(--app-zoom))' }}>
      {/* El zoom global de la plataforma se anula acá: lightweight-charts calcula el mouse en píxeles de pantalla y
          dibuja el canvas con devicePixelRatio, así que bajo zoom el crosshair se corría 10 % y la imagen salía
          reescalada. Los textos propios (botón, avisos, fuente del gráfico) se reescalan aparte con --app-zoom.
          El wrapper es `relative`: las capas con overlay (barras por strike) se posicionan sobre el canvas
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
      {/* Capas laterales (barras por strike): columna a la derecha del eje, con el mismo mapeo de precio. */}
      {layers.filter(l => layerOn[l.id] && l.placement === 'side').map(l => <React.Fragment key={l.id}>{l.render({ ...ctx, paneHeight: chartH })}</React.Fragment>)}
    </div>
  );
}
