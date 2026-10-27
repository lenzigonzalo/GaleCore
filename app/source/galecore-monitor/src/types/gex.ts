import { GexStrike, MacroRegimeResult, StructureInputs } from './api';

/**
 * Tipos de la estrategia GEX (informativa). Fuente: GET /App/Gex/Analysis.
 *
 * El GEX de esta pestaña es GLOBAL: agrega todos los strikes de todos los vencimientos de la
 * cadena dentro de `gex.max_dte` (incluido 0DTE). Es un número distinto — y mayor — que el GEX
 * de Main, que mira un solo vencimiento. No se comparan entre sí.
 */

/**
 * Valor de `selectedExpiry` que significa "el agregado de toda la cadena" en vez de un vencimiento.
 *
 * Es un centinela y no un flag aparte a propósito: la elección de scope es UNA sola, y con dos
 * estados (`selectedExpiry` + un `isGlobal`) se puede representar el imposible "global Y el 0DTE".
 * No colisiona con un `expiration` real, que siempre es una fecha ISO.
 */
export const GLOBAL_SCOPE = 'global';

/**
 * Strike tal como llega de la API. Era el mismo shape que `ValidationGexStrike`; desde que la
 * API expone la IV por strike (2026-08-25) es un superconjunto de aquel.
 */
export interface GexStrikeApi {
  strike: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  callOI: number;
  putOI: number;
  callDelta: number;
  putDelta: number;
  /**
   * IV por strike y por lado — la superficie, no un promedio. Expuesta el 2026-08-25;
   * antes se calculaba en el backend y se descartaba al mapear. Opcional porque una
   * respuesta cacheada de antes de ese cambio no la trae.
   */
  callIV?: number;
  putIV?: number;
}

export interface GexScopeApi {
  spot: number;
  callGex: number;
  putGex: number;
  /** Net GEX en billones de USD. */
  netGex: number;
  gammaZeroLevel: number | null;
  callWall: number | null;
  putWall: number | null;
  /** Vencimientos que llegaron con datos. */
  expirationsIncluded: number;
  /** Vencimientos que entraron al barrido. Si supera a expirationsIncluded, el GEX está incompleto. */
  expirationsRequested: number;
  /** Símbolos con Greeks sobre símbolos pedidos, en %. */
  coveragePct: number;
  strikes: GexStrikeApi[];
}

/**
 * La banda de gamma de un lado: dónde está apilado el open interest, como RANGO y no como strike.
 *
 * Reemplaza al Call/Put Wall en la pantalla desde 2026-08-28. El argmax que mostraba antes está
 * medido que es un mal objeto — nunca junta más del 19% del |GEX| de su lado y salta $40 en 48
 * minutos —; la banda sobre las mismas series se movió $1.3 en total.
 *
 * NO dice que el precio vaya a frenar acá: eso se midió sobre 926 observaciones de 2013-2025 y da
 * que el borde se comporta como un strike cualquiera de su mismo delta. Es descripción del
 * posicionamiento. Ver research/got/hallazgos/2026-08-28-la-banda-no-predice.md.
 */
export interface GammaBandApi {
  low: number;
  high: number;
  /** El borde EXTERNO — el extremo más lejos del spot. Es la referencia de la banda. */
  edge: number;
  /** Qué % del |GEX| de su lado junta la banda. */
  pctOfSide: number;
  /** La banda contra la ventana mediana del mismo lado. Cerca de 1x = no hay nada apilado. Sin umbral: no decide. */
  xMed: number | null;
  /** El ancho usado, en puntos de precio (width_em × expectedMove). */
  width: number;
}

export interface GexExpiryApi {
  expiration: string;
  dte: number;
  expirationType: string | null;
  callGex: number;
  putGex: number;
  netGex: number;
  gammaZeroLevel: number | null;
  callWall: number | null;
  putWall: number | null;
  /** null = no hay banda acá (sin EM, o el lado sin suficientes strikes). Es un resultado válido. */
  callBand: GammaBandApi | null;
  putBand: GammaBandApi | null;
  atmIv: number | null;
  expectedMove: number | null;
  /** Skew 25Δ put (IV del put de delta ≈ −0,25 / IV ATM), servido por la API. Opcional: barridos viejos no lo traen. */
  putSkew25d?: number | null;
  put25DeltaStrike?: number | null;
  strikes: GexStrikeApi[];
}

export interface GexScanConfig {
  maxDte: number;
  includeZeroDte: boolean;
  expirationTypes: string[];
  greeksBatchSize: number;
  greeksRetries: number;
  cacheSeconds: number;
  /** Cobertura mínima para que el backend guarde el barrido en cache. Debajo, no lo cachea. */
  cacheMinCoveragePct: number;
}

export interface GexAnalysisResponse {
  symbol: string;
  timestamp: string;
  spotPrice: number;
  fromCache: boolean;
  /** Switch de la estrategia. En false no se barrió nada: lo que llega es el último dato. */
  switchEnabled: boolean;
  /** El dato es de un barrido anterior y nadie lo va a actualizar mientras el switch esté en OFF. */
  frozen: boolean;
  elapsedMs: number;
  macroRegime: MacroRegimeResult | null;
  structureInputs: StructureInputs | null;
  gex: {
    global: GexScopeApi;
    byExpiry: GexExpiryApi[];
    config: GexScanConfig;
  };
}

/** Shape que consume GexChart/GexBarsPanel, derivado de un scope (global o de un vencimiento). */
export interface GexChartData {
  symbol: string;
  spot: number;
  dte: number;
  expiration: string;
  zeroGammaLevel: number;
  netGex: number;
  /** El muro: el nivel con nombre y valor. Va como línea con etiqueta en los dos gráficos. */
  callWall: number;
  putWall: number;
  /**
   * La banda de gamma que los gráficos **sombrean**, sin etiqueta: qué tan ancha es la
   * concentración alrededor del muro. `null` = no hay banda para este scope, y el agregado siempre
   * cae ahí — el ancho es una fracción del expected move, que necesita un vencimiento.
   */
  callBand: GammaBandApi | null;
  putBand: GammaBandApi | null;
  /**
   * El expected move del vencimiento, tal como lo calcula el backend con la IV ATM de ESA
   * expiración. `null` en el agregado, que no tiene un `t`.
   *
   * Va en el contrato del gráfico porque la cuenta con IV 30d y DTE da **cero en un 0DTE** (t = 0),
   * y ahí el 1er EM es justamente lo único que separa el marco de la ancho de los muros.
   */
  expectedMove: number | null;
  strikes: GexStrike[];
  /**
   * Otros vencimientos elegidos para comparar: sólo sus niveles (muros y ZGL), que ya vienen
   * calculados por la API para cada uno. Las barras son siempre las del vencimiento principal.
   */
  others?: GexOtherLevels[];
}

/** Los niveles de un vencimiento que se dibujan como líneas junto a los del principal. */
export interface GexOtherLevels {
  expiration: string;
  callWall: number;
  putWall: number;
  zeroGammaLevel: number;
}

/**
 * Un grupo del cuadro Details. Agrupa por la PREGUNTA que contestan sus métricas, no por el objeto
 * de la respuesta que las trae — `macroRegime.checks` y `structureInputs` son dos orígenes de dato
 * y ese reparto no le dice nada a quien lee.
 *
 * `scope: 'market'` es el que importa: VIX y VIX9D son índices CBOE que el backend pide como
 * símbolos fijos, así que valen lo mismo en SPY, QQQ o AAPL. Van en su propia franja y fuera del
 * encabezado "<símbolo> · Details" — mezclados con los del símbolo, cambiar de ticker y ver que
 * esos dos no se mueven es indistinguible de un dato que quedó colgado del barrido anterior.
 */
export interface DetailsGroup {
  id: string;
  label: string;
  scope?: 'market' | 'symbol';
  hint?: string;
  /**
   * El `id` es el contrato con el panel, que mapea id → celda. El `label` es lo que se ve.
   *
   * `color: 'vs_ref'` = esta celda se pinta contra su referencia (verde dentro, rojo fuera).
   * Es la única lectura de aprobado/reprobado del cuadro y por eso la declara el JSON: el
   * resto de los colores del panel son otros ejes (lado de la cadena, dirección de precio,
   * signo del gamma) y viven en el front porque salen del significado del valor, no de un
   * umbral. Sin el campo, la celda va en texto neutro salvo que su eje propio la pinte.
   */
  metrics: { id: string; label: string; color?: 'vs_ref' }[];
}

/** Contrato de render de la pestaña: display_config.gex_tab del JSON de reglas. */
export interface GexTabDisplayConfig {
  refresh_seconds?: number;
  default_expiry?: string;
  candles?: { interval?: string; count?: number; right_pad_bars?: number };
  /**
   * El botón de la mira: cómo encuadra el eje de precio en la zona gamma.
   *
   * Los ids de ancla son de este contrato, no del front: `expected_move_1sigma`, `call_wall`,
   * `call_band_high` arriba y `expected_move_1sigma`, `put_wall`, `put_band_low` abajo. Uno que el
   * front no sepa resolver se ignora — el JSON manda, pero un id nuevo no puede dejar sin encuadre
   * a un tablero viejo.
   */
  chart_scale?: {
    label?: string;
    /**
     * Aire a cada lado, como fracción del alto del marco (0.06 = 6%). En proporción y no en
     * strikes: dos strikes son el 17% del marco en un 0DTE y el 3% a 42 días.
     */
    padding_pct?: number;
    upper_anchors?: string[];
    lower_anchors?: string[];
  };
  details_panel?: {
    subtitle?: string;
    microstructure?: boolean;
    gex_scope?: string;
    /** false = sin verde/rojo ni checkmarks. GEX no tiene gates: nada acá aprueba ni reprueba. */
    semaphore?: boolean;
    /** Los grupos del cuadro Details, en orden de lectura. Ver DetailsGroup. */
    groups?: DetailsGroup[];
  };
  expiry_engine?: { label?: string; rows?: { id: string; label: string }[] };
  options_chain?: {
    label?: string;
    /** Fila fija que selecciona el agregado de toda la cadena en vez de un vencimiento. */
    global_row?: { enabled?: boolean; label?: string; scope?: string };
  };
}

/**
 * `universe.ad_hoc_search` del JSON de reglas: el buscador de símbolos de la pestaña.
 *
 * El símbolo que se elige NO se agrega a `universe.tickers` — esa lista es whitelist, está en git y
 * es la misma para todos. El pinneado vive en el store y muere con la sesión.
 */
export interface AdHocSearchConfig {
  enabled?: boolean;
  /** Cuántos símbolos ad-hoc se pueden tener a la vez. Es un límite real: el store recorta a este número. */
  max_pinned?: number;
  max_results?: number;
  /** false = el símbolo ad-hoc no entra al intervalo de auto-refresh; solo se rebarre a mano. */
  auto_refresh?: boolean;
  min_query_length?: number;
  allowed_instrument_types?: string[];
}

export interface GexRules {
  _meta?: { version?: string; strategy?: string; status?: string };
  universe?: { tickers?: string[]; ad_hoc_search?: AdHocSearchConfig };
  gex?: { max_dte?: number; include_zero_dte?: boolean };
  display_config?: { gex_tab?: GexTabDisplayConfig };
}
