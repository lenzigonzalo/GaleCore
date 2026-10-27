import React, { useState } from 'react';
import { DetailsGroup, GexAnalysisResponse } from '../../types/gex';
import { MacroRegimeChecks, StructureInputs } from '../../types/api';
import { fmtGex, fmtPrice } from '../../utils/formatters';
import { CALL_COLOR, PUT_COLOR } from '../../utils/optionSideColors';

/**
 * Cuadro Details de la pestaña GEX: los once indicadores de contexto, agrupados por la PREGUNTA que
 * contestan.
 *
 * REEMPLAZA a ValidationLayers + MarketDiagnostics, que repartían estos mismos indicadores en dos columnas
 * según de qué objeto de la respuesta venían (`macroRegime.checks` a la izquierda,
 * `structureInputs` a la derecha). Ese es el origen del dato, no una pregunta que alguien se haga:
 * dejaba RV lejos de IV Rank —juntas son la lectura de VRP— y partía la historia del gamma
 * (tamaño, asimetría, posición del spot) entre las dos mitades. También convivían dos gramáticas
 * visuales para la misma clase de dato, tiles a la izquierda y filas a la derecha, que el ojo lee
 * como dos tipos de cosa distintos.
 *
 * SIN SEMÁFORO, a propósito (`display_config...semaphore: false`). GEX es informativa y no tiene
 * gates: los checks vienen con `on_fail: inform_only`. El verde/rojo con ✓/✗ que heredó de la
 * cascada de Main hacía que un GEX global de -$921B —que es lo normal en SPY— se leyera como una
 * avería. Cada celda muestra su referencia en texto, y el color queda para las tres métricas cuyo
 * valor ES una lectura de mercado y no un veredicto (ver el bloque de TREND_UP).
 *
 * Los grupos van todos en la misma grilla, separados por una línea vertical, y el `scope` del
 * JSON solo los ordena (los de mercado primero) — hasta 2026-08-19 sacaba a Mercado a una franja
 * propia arriba, con fondo y tipografía distintas de las del resto.
 *
 * Los grupos, sus etiquetas y qué métrica va en cada uno los declara el JSON de reglas; acá vive
 * solo el cómo se dibuja cada id. Un id que el JSON declare y este panel no conozca se omite: es
 * preferible una celda de menos a una celda vacía que se lea como "sin dato".
 */

/** Grupos por defecto si el JSON no los declara. Mismo orden y mismos ids que el JSON. */
export const DEFAULT_DETAILS_GROUPS: DetailsGroup[] = [
  {
    id: 'market', label: 'Mercado', scope: 'market', hint: 'Igual para todos los simbolos',
    metrics: [{ id: 'vix', label: 'VIX', color: 'vs_ref' }, { id: 'vix_term_structure', label: 'VIX TS' }],
  },
  {
    id: 'volatility', label: 'Volatilidad', scope: 'symbol', hint: 'Cuanto vale el seguro, y hacia donde va',
    metrics: [
      { id: 'iv_rank', label: 'IV Rank', color: 'vs_ref' },
      { id: 'iv_atm', label: 'IV ATM' },
      { id: 'iv_momentum', label: 'IV Momentum' },
      { id: 'realized_vol', label: 'RV 10 / 30' },
    ],
  },
  {
    id: 'gamma', label: 'Estructura gamma', scope: 'symbol', hint: 'Donde estan los muros, y de que lado',
    metrics: [
      { id: 'gex_global', label: 'GEX Global' },
      { id: 'gex_skew', label: 'Skew de muros' },
      { id: 'spot_vs_zgl', label: 'Spot vs ZGL' },
    ],
  },
  {
    id: 'price', label: 'Precio', scope: 'symbol', hint: 'Que esta haciendo',
    metrics: [
      { id: 'price_zscore', label: 'z-score direccional' },
      { id: 'trend_ema', label: 'Trend EMA' },
    ],
  },
];

/**
 * Las tres métricas que se pintan, porque su valor ES una lectura de mercado y no un veredicto:
 * qué muro domina, hacia dónde apuntan las EMAs y de qué signo es el gamma del dealer. Pero cada
 * una en su eje, y los tres comparten los dos colores del tema:
 *
 * * **El skew usa la identidad del lado de la cadena** (`optionSideColors`): call verde, put rojo,
 *   los mismos colores con los que el gráfico y el panel de barras dibujan ese muro. "put 0.38" en
 *   rojo dice "el muro dominante es de puts", igual que la línea roja del Put Wall — no dice que
 *   algo esté mal.
 * * **El trend usa el verde/rojo de dirección de precio**, que es el mismo de las velas.
 * * **El GEX global usa el signo del gamma**: positivo verde, negativo rojo.
 *
 * Tres ejes distintos con dos colores, así que el que lee tiene que apoyarse en la etiqueta de la
 * celda. Ninguno de los tres es bien/mal: en SPY el GEX global es negativo casi siempre.
 */
const TREND_UP = 'var(--green)';
const TREND_DOWN = 'var(--red-gc)';
const GAMMA_POSITIVO = 'var(--green)';
const GAMMA_NEGATIVO = 'var(--red-gc)';

/**
 * El cuarto eje, y el único que SÍ es aprobado/reprobado: verde si el valor cae dentro de la
 * referencia declarada, rojo si no. Lo piden VIX e IV Rank, las dos celdas donde la referencia
 * es una banda y estar afuera cambia cómo se lee todo lo demás.
 *
 * Sigue sin haber ✓/✗ ni veredicto de panel (`semaphore: false`): estos checks vienen con
 * `on_fail: inform_only`, así que un VIX en rojo dice "fuera de la banda", no "no operar".
 * Qué celda lo lleva lo declara el JSON (`metrics[].color: 'vs_ref'`) y no este archivo, para
 * que se vea desde las reglas cuáles tienen esa lectura.
 */
const DENTRO_DE_REF = 'var(--green)';
const FUERA_DE_REF = 'var(--red-gc)';

interface Cell {
  /** El número o la palabra que se lee de un vistazo. */
  value: string;
  /** Contra qué se lee: el umbral que declara el JSON, o la interpretación que arma el backend. */
  reference: string;
  /** Solo para las métricas direccionales; el resto va en texto neutro. */
  color?: string;
  /** Filas exactas para el tooltip. Sin esto se perdían los valores crudos al redondear. */
  tooltip?: { label: string; value: string }[];
  /**
   * Si el valor cae dentro de su referencia. Lo calcula el backend (`checks.<x>.passed`), no
   * el panel: el umbral vive en el JSON de reglas y recalcularlo acá sería una segunda fuente
   * de verdad. Solo se pinta si el JSON declara `color: 'vs_ref'` para esa métrica.
   */
  passed?: boolean;
}

const NO_DATA: Cell = { value: '—', reference: 'sin dato' };

function n(v: number | null | undefined, d = 2): string {
  return v == null ? '—' : v.toFixed(d);
}

/**
 * Una celda por id de métrica. La línea de referencia sale de lo que devolvió la API
 * (`threshold` / `min` / `max` / `interpretation`) y NO del display_config: declarar el umbral en
 * los dos lados sería una segunda fuente de verdad que puede quedar desalineada de macro_regime.
 */
function buildCell(
  id: string,
  checks: MacroRegimeChecks | undefined,
  inputs: StructureInputs | null | undefined,
): Cell | null {
  switch (id) {
    case 'vix': {
      const c = checks?.vixAbsolute;
      if (!c || c.value == null) return NO_DATA;
      return {
        value: c.value.toFixed(1),
        passed: c.passed,
        reference: `ref < ${c.threshold}`,
        tooltip: [{ label: 'VIX', value: c.value.toFixed(2) }, { label: 'Ref', value: `< ${c.threshold}` }],
      };
    }
    case 'vix_term_structure': {
      const c = checks?.vixTermStructure;
      // noData = faltó alguno de los dos índices. El backend lo manda passed=true porque no
      // bloquea, así que mostrarlo como una lectura normal escondería que no hay dato.
      if (!c || c.noData || c.vix9d == null || c.vix30d == null) return NO_DATA;
      return {
        value: `${c.vix9d.toFixed(1)} / ${c.vix30d.toFixed(1)}`,
        reference: '9D / 30D · contango si 9D es menor',
        tooltip: [
          { label: 'VIX9D', value: c.vix9d.toFixed(2) },
          { label: 'VIX', value: c.vix30d.toFixed(2) },
        ],
      };
    }
    case 'iv_rank': {
      const c = checks?.ivRank;
      if (!c) return NO_DATA;
      // Un decimal: el percentil se mueve dentro del entero, y redondeado a cero decimales dos
      // barridos seguidos mostraban el mismo numero como si nada se hubiera movido.
      return {
        value: c.value.toFixed(1),
        passed: c.passed,
        reference: `ref ${c.min}–${c.max}`,
        tooltip: [{ label: 'IV Rank', value: c.value.toFixed(2) }, { label: 'Ref', value: `${c.min} – ${c.max}` }],
      };
    }
    // El nivel absoluto, al lado del percentil. IV Rank dice donde esta la IV DENTRO de su propio
    // ano: sola no dice si el seguro esta caro, y un rank de 30 sobre una IV de 12% no es la misma
    // lectura que sobre una de 45%. El nivel ya venia en la respuesta, pero escondido en el tooltip
    // del z-score, que es el unico que lo necesitaba para normalizar.
    // Fuente: IV30 30d (GexAnalysisHandler), ya en porcentaje anualizado — la MISMA base que las
    // dos RV de este grupo, asi que las celdas se leen juntas como VRP sin convertir nada.
    case 'iv_atm': {
      const z = inputs?.priceZScore;
      // 0 = no vino IV30 (el handler hace `?? 0`), y no una IV de cero.
      if (!z || z.ivAtm == null || z.ivAtm <= 0) return NO_DATA;
      return {
        value: `${z.ivAtm.toFixed(1)}%`,
        reference: 'IV 30d anualizada · se lee contra RV',
        tooltip: [
          { label: 'IV ATM', value: `${z.ivAtm.toFixed(2)}%` },
          { label: 'Fuente', value: 'IV30 30d' },
        ],
      };
    }
    case 'iv_momentum': {
      const c = checks?.ivMomentum;
      if (!c || c.value == null) return NO_DATA;
      const signo = c.value > 0 ? '+' : '';
      return {
        value: `${signo}${c.value.toFixed(1)}%`,
        reference: `ROC 5d · ref ≤ ${c.threshold}%`,
        tooltip: [
          { label: 'ROC 5d', value: `${c.value.toFixed(2)}%` },
          { label: 'Ref', value: `≤ ${c.threshold}%` },
        ],
      };
    }
    case 'realized_vol': {
      const rv = inputs?.realizedVolRegime;
      if (!rv || rv.rv10d == null || rv.rv30d == null) return NO_DATA;
      // La referencia sale de `interpretation` y NO de `signal`. El signal del backend es
      // `rv10d > rv30d ? "high" : "low"` (CascadeUtils.ComputeRealizedVol): una comparación
      // RELATIVA entre la corta y la larga, o sea expansión contra contracción. Escribirlo como
      // "regimen low" lo convertía en una afirmación sobre el nivel de vol, que es otra cosa —
      // SKM mostraba "regimen low" con RV 55.5 / 69.2. El backend ya manda la frase correcta.
      // El `%` va porque esto ES volatilidad, la misma unidad que IV ATM dos celdas a la izquierda.
      // Sin el signo, la pareja que se lee junta como VRP mostraba la misma magnitud con dos
      // vestidos distintos, y el que compara tiene que asumir que la de al lado esta en la misma
      // base. Regla del panel: lo que es volatilidad lleva `%`; el percentil (IV Rank) no, que si
      // no un rank de 31 se leeria como un nivel de vol de 31%.
      return {
        value: `${rv.rv10d.toFixed(1)}% / ${rv.rv30d.toFixed(1)}%`,
        reference: rv.interpretation ?? 'RV 10d / RV 30d anualizadas',
        tooltip: [
          { label: 'RV 10d', value: `${rv.rv10d.toFixed(2)}%` },
          { label: 'RV 30d', value: `${rv.rv30d.toFixed(2)}%` },
        ],
      };
    }
    case 'gex_global': {
      const c = checks?.gexTotal;
      if (!c) return NO_DATA;
      // Sin umbral propio para el símbolo no hay contra qué leerlo, y un umbral por default se
      // leería como si alguien lo hubiera elegido para este ticker.
      // Umbral 0 = el criterio es el SIGNO, no un piso. Escribirlo como "ref ≥ $0B" haría pasar
      // por piso en billones lo que es una lectura de gamma positivo contra gamma negativo, que es
      // justo la confusión que el JSON dejó anotada en gex_threshold_by_symbol.
      const umbral = c.thresholdDeclared === false ? null : c.threshold;
      const referencia = umbral == null ? 'sin umbral declarado'
        : umbral === 0 ? 'ref: gamma positivo (≥ 0)'
        : `ref ≥ ${fmtGex(umbral)}`;
      // Verde el gamma positivo, rojo el negativo. Es el SIGNO, no un veredicto: positivo =
      // el dealer vende fuerza y compra debilidad (regimen de pinning), negativo = amplifica el
      // movimiento. En SPY el global vive en negativo, asi que esta celda va a estar casi siempre
      // roja: eso es la lectura normal del simbolo y no una averia — lo que la distingue de un
      // semaforo es que la referencia de al lado dice contra que se lee, y que no hay cruz.
      return {
        value: fmtGex(c.value),
        color: c.value > 0 ? GAMMA_POSITIVO : c.value < 0 ? GAMMA_NEGATIVO : undefined,
        reference: referencia,
        tooltip: [
          { label: 'Net GEX', value: `${c.value.toFixed(1)}B` },
          {
            label: 'Ref',
            value: umbral == null ? 'sin declarar' : umbral === 0 ? '≥ 0 (signo)' : `≥ ${fmtGex(umbral)}`,
          },
        ],
      };
    }
    case 'gex_skew': {
      const g = inputs?.gexSign;
      if (!g || g.value == null) return NO_DATA;
      const lado = g.value === 'put_dominant' ? 'put' : g.value === 'call_dominant' ? 'call' : 'simetrico';
      return {
        value: `${lado} ${n(g.skewRatio)}`,
        reference: g.interpretation ?? 'callGEX / (callGEX + |putGEX|)',
        color: g.value === 'put_dominant' ? PUT_COLOR
          : g.value === 'call_dominant' ? CALL_COLOR
          : undefined,
        tooltip: [
          { label: 'Ratio', value: n(g.skewRatio) },
          { label: 'Muro', value: g.value },
        ],
      };
    }
    case 'spot_vs_zgl': {
      const c = checks?.spotVsZgl;
      if (!c) return NO_DATA;
      if (c.zgl == null) {
        return { value: '—', reference: 'sin ZGL en la cadena', tooltip: [{ label: 'Spot', value: c.spot.toFixed(2) }] };
      }
      return {
        value: c.passed ? 'encima' : 'debajo',
        reference: `spot ${fmtPrice(c.spot, 0)} · ZGL ${fmtPrice(c.zgl, 0)}`,
        tooltip: [
          { label: 'Spot', value: c.spot.toFixed(2) },
          { label: 'ZGL', value: c.zgl.toFixed(2) },
          { label: 'Buffer', value: `${(c.bufferPct * 100).toFixed(1)}%` },
        ],
      };
    }
    case 'price_zscore': {
      const z = inputs?.priceZScore;
      if (!z || z.value == null) return NO_DATA;
      return {
        value: z.value.toFixed(2),
        reference: `ret 5d en unidades de vol · ${z.interpretation ?? ''}`.trim(),
        tooltip: [
          { label: 'z-score', value: z.value.toFixed(2) },
          { label: 'Ret 5d', value: n(z.ret5d) },
          { label: 'IV ATM', value: n(z.ivAtm) },
        ],
      };
    }
    case 'trend_ema': {
      const t = inputs?.trend;
      if (!t || !t.signal) return NO_DATA;
      return {
        value: t.signal,
        reference: t.ema20 != null && t.ema50 != null
          ? `EMA20 ${t.ema20.toFixed(1)} · EMA50 ${t.ema50.toFixed(1)}`
          : (t.interpretation ?? 'EMA 20 vs EMA 50'),
        color: t.signal === 'up' ? TREND_UP : t.signal === 'down' ? TREND_DOWN : undefined,
        tooltip: [
          { label: 'EMA 20', value: n(t.ema20, 1) },
          { label: 'EMA 50', value: n(t.ema50, 1) },
        ],
      };
    }
    default:
      return null;
  }
}

/**
 * Pinta la celda contra su referencia, si el JSON lo pidió para esa métrica y el backend mandó
 * el `passed`. Va afuera de `buildCell` a propósito: `buildCell` sabe LEER cada métrica, y quién
 * se pinta es una decisión de presentación que toma el JSON.
 */
function paintVsRef(cell: Cell | null, color?: 'vs_ref'): Cell | null {
  if (!cell || color !== 'vs_ref' || cell.passed == null) return cell;
  return { ...cell, color: cell.passed ? DENTRO_DE_REF : FUERA_DE_REF };
}

/** Etiqueta de grupo: el mismo formato que ya usaban los dos paneles que este reemplaza. */
function GroupLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
      <span className="gex-group-label" style={{
        fontSize: 16, fontWeight: 600, 
        color: '#a78bfa', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      {hint && (
        <span style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
          {hint}
        </span>
      )}
    </div>
  );
}

function MetricTile({ label, cell }: { label: string; cell: Cell }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const handleEnter = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.bottom + 6 });
  };

  return (
    <div className="gex-metric"
      style={{
        display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0,
        padding: '7px 9px', borderRadius: 6, backgroundColor: 'var(--bg-tertiary)',
        cursor: cell.tooltip ? 'help' : undefined,
      }}
      onMouseEnter={cell.tooltip ? handleEnter : undefined}
      onMouseLeave={cell.tooltip ? () => setPos(null) : undefined}
    >
      {pos && cell.tooltip && (
        <div style={{
          position: 'fixed', top: pos.y, left: pos.x, transform: 'translateX(-50%)',
          padding: '6px 10px', backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)', zIndex: 9999,
          whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', gap: 3,
          pointerEvents: 'none',
        }}>
          {cell.tooltip.map((r) => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{
                fontSize: 14, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)',
                fontWeight: 500,
              }}>
                {r.label}
              </span>
              <span className="tabular-nums" style={{
                fontSize: 14, color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)', fontWeight: 600,
              }}>
                {r.value}
              </span>
            </div>
          ))}
        </div>
      )}

      <span className="gex-metric-label" style={{
        fontSize: 14, fontWeight: 600, 
        color: 'var(--text-muted)', fontFamily: 'var(--font-sans)',
        overflowWrap: 'anywhere',
      }}>
        {label}
      </span>

      <span className="tabular-nums gex-metric-value" style={{
        fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1,
        color: cell.color ?? 'var(--text-primary)', fontFamily: 'var(--font-mono)',
        overflowWrap: 'anywhere',
      }}>
        {cell.value}
      </span>

      {/* La referencia ENVUELVE, no se recorta. Es la mitad que le da sentido al número, y
          cortarla con puntos suspensivos ("put wall domina —…") deja justo la parte que no dice
          nada. El tile crece un renglón; el que no lo necesita no lo usa. */}
      <span className="gex-metric-reference" style={{
        fontSize: 14, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.25,
      }}>
        {cell.reference}
      </span>
    </div>
  );
}

interface Props {
  data: GexAnalysisResponse | null;
  /** Los grupos que declara display_config.gex_tab.details_panel, en orden de lectura. */
  groups?: DetailsGroup[];
  subtitle?: string;
  /** Recorte visual de los grupos declarados, sin alterar métricas ni referencias. */
  groupIds?: string[];
  compact?: boolean;
}

export function DetailsPanel({ data, groups, subtitle, groupIds, compact = false }: Props) {
  const [hoveredReference, setHoveredReference] = useState<string | null>(null);
  const [focusedReference, setFocusedReference] = useState<string | null>(null);
  const declared = groups?.length ? groups : DEFAULT_DETAILS_GROUPS;
  const checks = data?.macroRegime?.checks;
  const inputs = data?.structureInputs ?? null;

  // Un id que el JSON declare y este panel no sepa dibujar se omite en vez de rendir una celda
  // vacía, que se leería como "sin dato" cuando el problema es de contrato.
  const rendered = declared
    .filter(g => !groupIds || groupIds.includes(g.id))
    .map((g) => ({
      group: g,
      cells: g.metrics
        .map((m) => ({ label: m.label, cell: paintVsRef(buildCell(m.id, checks, inputs), m.color) }))
        .filter((c): c is { label: string; cell: Cell } => c.cell !== null),
    }))
    .filter((g) => g.cells.length > 0);

  if (compact) {
    return <div className="market-context-metrics">
      {!data ? <span>Sin barrido todavía.</span> : rendered.flatMap(({ group, cells }) =>
        cells.map(({ label, cell }, index) => {
          const referenceId = `market-context-${group.id}-${index}`;
          return <span className="market-context-metric" key={`${group.id}-${label}`}
            tabIndex={0} aria-describedby={referenceId}
            onMouseEnter={() => setHoveredReference(referenceId)} onMouseLeave={() => setHoveredReference(null)}
            onFocus={() => setFocusedReference(referenceId)} onBlur={() => setFocusedReference(null)}>
            <span>{label}</span><b className="tabular-nums" style={{ color: cell.color }}>{cell.value}</b>
            {(hoveredReference === referenceId || focusedReference === referenceId) && <span id={referenceId} role="tooltip" className="market-context-reference">
              {[cell.reference, ...(cell.tooltip ?? []).map(r => `${r.label}: ${r.value}`)].join('\n')}
            </span>}
          </span>;
        }))}
    </div>;
  }

  return (
    <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {subtitle && (
        <span style={{
          fontSize: 14, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.3,
        }}>
          {subtitle}
        </span>
      )}

      {!data ? (
        <span style={{ fontSize: 14, color: 'var(--text-muted)', padding: '6px 0' }}>
          Sin barrido todavia.
        </span>
      ) : (
        /* TODOS los grupos en la misma grilla, Mercado incluido, y el mismo tile para cada
           métrica: así ninguna parece de otra clase por venir de otro objeto de la respuesta.
           Mercado tenía su propia franja arriba, con fondo y tipografía propias — una segunda
           gramática visual para la misma clase de dato, que es justo lo que este panel evita.
           Lo que sigue avisando que VIX y VIX TS no dependen del símbolo es su rótulo más el hint
           ("Igual para todos los simbolos"), y que van primeros; el `scope` del JSON los ordena,
           ya no los saca de la grilla.

           Cada grupo pesa lo que mide: `Nfr` con N = cuantas celdas tiene, y no una fracción igual
           para todos. Con columnas iguales, el grupo más poblado reparte su tercio entre más tiles,
           así que el MISMO tile sale angosto en Volatilidad y ancho en Precio.

           El separador es el borde derecho de cada grupo, no un elemento aparte. El último no lo
           lleva: ahí la línea sería el borde del panel y no una separación entre dos cosas.
           `stretch` (y no `start`) para que todas midan lo mismo — con columnas de alto propio, la
           línea más larga se lee como si ese grupo pesara más. */
        <div style={{
          display: 'flex', flexWrap: 'wrap',
          gap: 12,
          alignItems: 'stretch',
        }}>
          {rendered.map(({ group, cells }, i) => {
            const separa = i < rendered.length - 1;
            return (
              <div
                key={group.id}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
                  flex: `${cells.length} 1 ${cells.length * 150}px`,
                  borderRight: separa ? '1px solid var(--border-dark)' : undefined,
                  paddingRight: separa ? 12 : undefined,
                }}
              >
                <GroupLabel label={group.label} hint={group.hint} />
                <div className="gex-metrics-grid" style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))',
                  gap: 5,
                }}>
                  {cells.map(({ label, cell }) => (
                    <MetricTile key={label} label={label} cell={cell} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
