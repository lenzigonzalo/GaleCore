import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  LineStyle,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts';
import { GexChartData, GexTabDisplayConfig } from '../../types/gex';
import { CALL_COLOR, PUT_COLOR, sideColorAlpha } from '../../utils/optionSideColors';
import { fetchEquityCandles } from '../../api/marketdata';
import { fmtPrice, fmtExpiry, etDateParts, etOffsetMinutes } from '../../utils/formatters';
import { GexBarsPanel } from './GexBarsPanel';

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
function expectedMove(g: GexChartData, iv30?: number): number {
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
}: Props) {
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const outerRef      = useRef<HTMLDivElement>(null);   // flex container
  const containerRef  = useRef<HTMLDivElement>(null);   // chart div
  const chartRef      = useRef<IChartApi | null>(null);
  const seriesRef     = useRef<ISeriesApi<'Candlestick' | 'Line', any> | null>(null);
  const gexLinesRef   = useRef<any[]>([]);
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
        fontSize: readable ? 15 : 13,
        attributionLogo: false,
      },
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
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load intraday candles ─────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    let cancelled = false;
    setHistoryState('loading');
    fetchEquityCandles(symbol, candleInterval, { fromDays: candleFromDays, limit: maxCandles }).then(candles => {
      if (cancelled || !chartRef.current) return;
      if (!candles.length) { setHistoryState('empty'); return; }
      setHistoryState('ready');
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
        // El encuadre vive en la SERIE (es su proveedor de autoescala), así que cambiarla lo borra:
        // la serie de velas nace sin él y el eje se va al rango de las velas — 30 días de recorrido
        // en vez de la zona gamma. Se vuelve a aplicar acá, que es donde se pierde.
        //
        // No se notaba antes porque el efecto del encuadre se disparaba con cada tick de precio
        // (`chartData` se rehacía en cada render de la pantalla) y lo reponía en milisegundos.
        if (gexRef.current) aplicarEncuadre(cs, gexRef.current, ivRef.current);
        fitView();
        bump();
      }
    }).catch(() => { if (!cancelled) setHistoryState('error'); });
    return () => { cancelled = true; };
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── GEX price lines + StdDev + autoscale ──────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !gexData) return;

    gexLinesRef.current.forEach(l => { try { series.removePriceLine(l); } catch {} });
    gexLinesRef.current = [];

    const add = (price: number, color: string, label: string, width: 1|2|3|4, style: LineStyle, axis = true) => {
      if (!price) return;
      gexLinesRef.current.push(series.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: axis, title: label }));
    };

    // El MURO es el nivel con nombre y valor: una línea de puntos suave a lo ancho del gráfico, con su etiqueta
    // en el eje. La franja de la banda ya no se sombrea acá: pisaba las velas y el propio muro (owner 21/10).
    const SOFT = 0.75;
    add(gexData.callWall,       sideColorAlpha(CALL_COLOR, SOFT), `Call Wall ${fmtPrice(gexData.callWall, 0)}`, 1, LineStyle.Dotted);
    add(gexData.putWall,        sideColorAlpha(PUT_COLOR, SOFT),  `Put Wall ${fmtPrice(gexData.putWall, 0)}`,   1, LineStyle.Dotted);
    add(gexData.zeroGammaLevel, 'rgba(148,163,184,0.75)',         `ZGL ${fmtPrice(gexData.zeroGammaLevel, 0)}`, 1, LineStyle.Dotted);
    // Vencimientos comparados: sus muros y ZGL, más tenues y rotulados con su fecha.
    for (const o of gexData.others ?? []) {
      const tag = fmtExpiry(o.expiration);
      add(o.callWall,       sideColorAlpha(CALL_COLOR, 0.4), `CW ${fmtPrice(o.callWall, 0)} · ${tag}`,       1, LineStyle.Dotted, false);
      add(o.putWall,        sideColorAlpha(PUT_COLOR, 0.4),  `PW ${fmtPrice(o.putWall, 0)} · ${tag}`,        1, LineStyle.Dotted, false);
      add(o.zeroGammaLevel, 'rgba(148,163,184,0.4)',         `ZGL ${fmtPrice(o.zeroGammaLevel, 0)} · ${tag}`, 1, LineStyle.Dotted, false);
    }

    const spot = gexData.spot;
    const em   = expectedMove(gexData, iv30);
    if (em > 0) {
      add(spot + em,     '#60a5fa', `+1σ ${fmtPrice(spot+em, 0)}`,   1, LineStyle.Dotted);
      add(spot - em,     '#60a5fa', `-1σ ${fmtPrice(spot-em, 0)}`,   1, LineStyle.Dotted);
      add(spot + 2 * em, '#3b82f6', `+2σ ${fmtPrice(spot+2*em, 0)}`, 1, LineStyle.Dotted, false);
      add(spot - 2 * em, '#3b82f6', `-2σ ${fmtPrice(spot-2*em, 0)}`, 1, LineStyle.Dotted, false);
    }

    // Datos vivos para el botón de encuadre, que corre fuera de este efecto.
    gexRef.current = gexData;
    ivRef.current  = iv30;

    // El encuadre se recalcula con cada barrido: si el modo es gamma, los muros y las bandas nuevas
    // mueven el marco. Congelarlo en el click dejaría el encuadre de hace diez minutos.
    //
    // Salvo que el operador haya movido el eje a mano: ahí el eje es suyo hasta que apriete el
    // botón. Un barrido que le devuelve la escala a su lugar diez minutos después es la misma
    // molestia que el gráfico clavado, con la sorpresa de que pasa solo.
    //
    // Elegir OTRO vencimiento sí reencuadra aunque lo haya movido: eso no es un barrido que llega
    // solo, es pedir ver otra cosa — y los muros del vencimiento nuevo pueden caer fuera del marco
    // que quedó del anterior.
    const cambioDeExpiracion = expRef.current !== gexData.expiration;
    expRef.current = gexData.expiration;
    if (cambioDeExpiracion || !tocadoRef.current) aplicarEncuadre(series, gexData, iv30);

    fitView();
    bump();
  }, [gexData, iv30]); // eslint-disable-line react-hooks/exhaustive-deps

  // priceToY: maps any price → canvas Y coordinate (reads seriesRef, refreshes on renderTick)
  const priceToY = useCallback((price: number): number | null => {
    if (!seriesRef.current) return null;
    const y = seriesRef.current.priceToCoordinate(price);
    return y == null ? null : (y as number);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderTick]);

  return (
    <div ref={outerRef} style={{ display: 'flex', width: '100%', height: "100%", minHeight: 320 }}>
      {/* Candle chart — takes all available space. El wrapper es `relative` para que el sombreado
          de la banda se posicione sobre el canvas; lightweight-charts no dibuja zonas entre dos
          precios, así que va como overlay traducido con priceToCoordinate. */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {readable && historyState !== 'ready' && <span role="status" style={{position:'absolute',top:8,left:112,zIndex:4,padding:'6px 10px',borderRadius:4,background:'#191919',color:historyState === 'error' ? '#ffb454' : '#e5e5df',fontSize:14,pointerEvents:'none'}}>{historyState === 'loading' ? 'Cargando velas…' : historyState === 'error' ? 'Histórico de velas no disponible' : 'Sin velas para este período'}</span>}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        <button type="button" onClick={resetChart} className="chart-reset" aria-label="Reset chart">Reset chart</button>
      </div>

      {/* GEX bars panel — fixed width, synchronized Y axis */}
      {gexData && (
        <GexBarsPanel
          strikes={gexData.strikes}
          spot={currentPrice || gexData.spot}
          callBand={gexData.callBand}
          putBand={gexData.putBand}
          callWall={gexData.callWall}
          putWall={gexData.putWall}
          zgl={gexData.zeroGammaLevel}
          priceToY={priceToY}
          height={chartH}
        />
      )}
    </div>
  );
}
