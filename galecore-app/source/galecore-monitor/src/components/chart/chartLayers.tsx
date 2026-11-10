import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { IPriceLine, ISeriesApi, LineStyle } from 'lightweight-charts';
import { Layers } from 'lucide-react';
import { GexChartData } from '../../types/gex';
import { CALL_COLOR, PUT_COLOR, sideColorAlpha } from '../../utils/optionSideColors';
import { fmtExpiry, fmtPrice } from '../../utils/formatters';
import { expectedMove } from './GexChart';
import { GexBarsPanel } from './GexBarsPanel';
import type { PositionLine } from '../../api/account';

/**
 * Capas del gráfico de Mercado. Sumar una capa nueva (EMA, eventos, posición, capas guardadas del
 * chat…) es agregar un item a CHART_LAYERS: el panel lateral y el gráfico leen la lista, no
 * conocen cada capa.
 *
 * Una capa dibuja con `render(ctx)`: devuelve un componente que puede crear series o líneas de
 * precio sobre `ctx.series` (con su propio efecto) o un overlay sobre el panel del gráfico, que se
 * posiciona con `ctx.priceToY` — la misma escala de precio que las velas.
 */

export interface AxisLabels {
  /** Registra una línea con etiqueta en el eje; si choca con otra, la de menor prioridad se oculta. */
  add(line: IPriceLine, priority: number, title: string): void;
  remove(line: IPriceLine): void;
}

export interface AlertLevel { id: string; price: number; label: string }

/** Un nivel de una posición real del símbolo (strike de un spread o precio de compra), armado desde la API. */
export interface PositionLevel { price: number; title: string; main: boolean }

/** Las posiciones de la cuenta del símbolo, como niveles: spreads por strike (vendido marcado) y acciones por precio de compra. */
export function positionLevels(positions: PositionLine[], symbol: string): PositionLevel[] {
  const out: PositionLevel[] = [];
  for (const p of positions.filter(x => x.symbol === symbol)) {
    const exp = p.expiration ? ` · ${fmtExpiry(p.expiration)}` : '';
    const legs = (tag: string, short: number | null, long: number | null) => {
      if (short) out.push({ price: short, title: `${tag} ${fmtPrice(short, 0)}/${long ? fmtPrice(long, 0) : '—'}${exp}`, main: true });
      if (long) out.push({ price: long, title: '', main: false });
    };
    if (p.structure === 'EQUITY') {
      if (p.averageOpenPrice) out.push({ price: p.averageOpenPrice, title: `Compra ×${p.quantity}`, main: true });
    } else {
      legs(p.structure === 'IC' ? 'IC' : 'PCS', p.shortPutStrike, p.longPutStrike);
      legs(p.structure === 'IC' ? 'IC' : 'CCS', p.shortCallStrike, p.longCallStrike);
    }
  }
  return out;
}

export interface LayerCtx {
  series: ISeriesApi<'Candlestick' | 'Line', any> | null;
  /** Cambia cuando la serie se reemplaza (línea → velas): las capas con líneas de precio las rehacen. */
  seriesVersion: number;
  gexData: GexChartData | null;
  iv30?: number;
  currentPrice: number;
  symbol: string;
  /**
   * Falso cuando el gráfico ya se destruyó. Al desmontar, React limpia el padre antes que las capas: quitar una
   * línea de un gráfico destruido agenda un repintado que tira «Object is disposed». Las capas lo miran al limpiar.
   */
  alive: () => boolean;
  alertLevels: AlertLevel[];
  positionLevels: PositionLevel[];
  axisLabels: AxisLabels;
  priceToY: (price: number) => number | null;
  /** Área de dibujo (sin eje de precio ni eje de tiempo), en píxeles de pantalla. */
  paneWidth: number;
  paneHeight: number;
  axisWidth: number;
  /** Ancho en píxeles de la columna lateral (barras por strike); lo fija el divisor arrastrable. */
  sideWidth: number;
}

/** Lo que el panel lateral le pasa a los controles propios de una capa. */
export interface LayerPanelCtx {
  alerts: { id: string; label: string; onRemove: () => void }[];
}

export interface ChartLayer {
  id: string;
  name: string;
  defaultOn: boolean;
  /** La capa necesita la cadena GEX: sin ella no hay nada que dibujar (y el encuadre usa sus niveles). */
  needsGex?: boolean;
  /** `side`: columna a la derecha del eje de precio (como las barras por strike); por defecto, overlay del gráfico. */
  placement?: 'overlay' | 'side';
  render: (ctx: LayerCtx) => ReactNode;
  controls?: (panel: LayerPanelCtx) => ReactNode;
}

// ── Muros GEX ────────────────────────────────────────────────────────────────

function WallLines({ ctx }: { ctx: LayerCtx }) {
  const { series, gexData, iv30, axisLabels } = ctx;
  useEffect(() => {
    if (!series || !gexData) return;
    const lines: IPriceLine[] = [];
    const add = (price: number, color: string, title: string, priority: number, style = LineStyle.Dotted, axis = true) => {
      if (!price) return;
      try {
        const line = series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: axis, title });
        lines.push(line);
        if (axis) axisLabels.add(line, priority, title);
      } catch { /* serie destruida */ }
    };
    // El MURO es el nivel con nombre y valor: línea de puntos suave con su etiqueta en el eje.
    const SOFT = 0.5;
    add(gexData.callWall,       sideColorAlpha(CALL_COLOR, SOFT), `Call Wall ${fmtPrice(gexData.callWall, 0)}`, 80);
    add(gexData.putWall,        sideColorAlpha(PUT_COLOR, SOFT),  `Put Wall ${fmtPrice(gexData.putWall, 0)}`,   80);
    add(gexData.zeroGammaLevel, 'rgba(148,163,184,0.45)',         `ZGL ${fmtPrice(gexData.zeroGammaLevel, 0)}`, 50);
    const spot = gexData.spot;
    const em = expectedMove(gexData, iv30);
    if (em > 0) {
      add(spot + em,     'rgba(96,165,250,0.4)', `+1σ ${fmtPrice(spot + em, 0)}`,     40);
      add(spot - em,     'rgba(96,165,250,0.4)', `-1σ ${fmtPrice(spot - em, 0)}`,     40);
      add(spot + 2 * em, 'rgba(59,130,246,0.2)',  `+2σ ${fmtPrice(spot + 2 * em, 0)}`, 0, LineStyle.Dotted, false);
      add(spot - 2 * em, 'rgba(59,130,246,0.2)',  `-2σ ${fmtPrice(spot - 2 * em, 0)}`, 0, LineStyle.Dotted, false);
    }
    return () => lines.forEach(l => { axisLabels.remove(l); if (ctx.alive()) try { series.removePriceLine(l); } catch { /* serie destruida */ } });
  }, [series, ctx.seriesVersion, gexData, iv30, axisLabels]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ── Avisos de precio (WS-0064) ───────────────────────────────────────────────

function AlertLines({ ctx }: { ctx: LayerCtx }) {
  const { series, alertLevels, axisLabels } = ctx;
  const key = alertLevels.map(a => `${a.id}:${a.price}:${a.label}`).join('|');
  useEffect(() => {
    if (!series) return;
    const lines: IPriceLine[] = [];
    for (const a of alertLevels) {
      try {
        // Corto y en ámbar suave: el precio ya va en el eje; la descripción completa está en Capas → Avisos.
        const line = series.createPriceLine({ price: a.price, color: 'rgba(234,179,8,0.45)', lineWidth: 1, lineStyle: LineStyle.Dashed,
          axisLabelVisible: true, axisLabelColor: '#3a2f0b', axisLabelTextColor: '#facc15', title: '' });
        lines.push(line);
        axisLabels.add(line, 70, '');
      } catch { /* serie destruida */ }
    }
    return () => lines.forEach(l => { axisLabels.remove(l); if (ctx.alive()) try { series.removePriceLine(l); } catch { /* serie destruida */ } });
  }, [series, ctx.seriesVersion, key, axisLabels]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ── Mis posiciones ───────────────────────────────────────────────────────────

function PositionLines({ ctx }: { ctx: LayerCtx }) {
  const { series, positionLevels: levels, axisLabels } = ctx;
  const key = levels.map(l => `${l.price}:${l.title}`).join('|');
  useEffect(() => {
    if (!series) return;
    const lines: IPriceLine[] = [];
    for (const l of levels) {
      try {
        const line = series.createPriceLine({ price: l.price, color: l.main ? 'rgba(167,139,250,0.75)' : 'rgba(167,139,250,0.35)',
          lineWidth: 1, lineStyle: l.main ? LineStyle.Solid : LineStyle.Dotted, axisLabelVisible: l.main, title: l.title });
        lines.push(line);
        if (l.main) axisLabels.add(line, 75, l.title);
      } catch { /* serie destruida */ }
    }
    return () => lines.forEach(l => { axisLabels.remove(l); if (ctx.alive()) try { series.removePriceLine(l); } catch { /* serie destruida */ } });
  }, [series, ctx.seriesVersion, key, axisLabels]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export const CHART_LAYERS: ChartLayer[] = [
  {
    id: 'walls', name: 'Muros GEX', defaultOn: true, needsGex: true,
    render: (ctx) => <WallLines key="walls" ctx={ctx} />,
  },
  {
    id: 'bars', name: 'Barras por strike', defaultOn: false, needsGex: true, placement: 'side',
    render: (ctx) => ctx.gexData && (
      <GexBarsPanel
        key="bars"
        strikes={ctx.gexData.strikes}
        spot={ctx.currentPrice || ctx.gexData.spot}
        callWall={ctx.gexData.callWall}
        putWall={ctx.gexData.putWall}
        callBand={ctx.gexData.callBand}
        putBand={ctx.gexData.putBand}
        zgl={ctx.gexData.zeroGammaLevel}
        priceToY={ctx.priceToY}
        height={ctx.paneHeight}
        width={ctx.sideWidth}
      />
    ),
  },
  {
    id: 'positions', name: 'Mis posiciones', defaultOn: true,
    render: (ctx) => <PositionLines key="positions" ctx={ctx} />,
  },
  {
    id: 'alerts', name: 'Avisos', defaultOn: true,
    render: (ctx) => <AlertLines key="alerts" ctx={ctx} />,
    controls: ({ alerts }) => alerts.length > 0 && (
      <div className="market-layer-chips">
        {alerts.map(a => (
          <button key={a.id} type="button" aria-label={`Borrar aviso ${a.label}`} onClick={a.onRemove}>{a.label} ×</button>
        ))}
      </div>
    ),
  },
];

// ── Estado de las capas, recordado por navegador ─────────────────────────────

const LAYERS_KEY = 'galecore:market:layers';

function readLayers(defs: ChartLayer[]): Record<string, boolean> {
  const base = Object.fromEntries(defs.map(d => [d.id, d.defaultOn]));
  try {
    const saved = JSON.parse(localStorage.getItem(LAYERS_KEY) || '{}');
    for (const d of defs) if (typeof saved?.[d.id] === 'boolean') base[d.id] = saved[d.id];
  } catch { /* sin almacenamiento o JSON roto: quedan los defaults */ }
  return base;
}

export function useChartLayers(defs: ChartLayer[]) {
  const [on, setOn] = useState<Record<string, boolean>>(() => readLayers(defs));
  const toggle = useCallback((id: string) => {
    setOn(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(LAYERS_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
      return next;
    });
  }, []);
  return { on, toggle };
}

/**
 * Botón «Capas» con su menú flotante anclado debajo (a la derecha del botón). Se cierra con clic
 * afuera o Escape. Va anclado al contenedor del botón y no en `fixed`, así que el zoom global de la
 * plataforma lo escala junto con el botón y no hace falta convertir coordenadas.
 */
export function LayersMenu({ defs, on, onToggle, panel }: {
  defs: ChartLayer[];
  on: Record<string, boolean>;
  onToggle: (id: string) => void;
  panel: LayerPanelCtx;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="market-layers-menu" ref={ref}>
      <button type="button" className="btn market-layers-toggle" aria-expanded={open} aria-haspopup="true"
        title="Capas del gráfico" onClick={() => setOpen(v => !v)}>
        <Layers size={13} /> Capas
      </button>
      {open && (
        <aside className="market-layers" aria-label="Capas del gráfico">
          <ul>
            {defs.map(layer => (
              <li key={layer.id} className="market-layer">
                <label>
                  <input type="checkbox" role="switch" checked={!!on[layer.id]} onChange={() => onToggle(layer.id)} />
                  <span className="market-layer-switch" aria-hidden="true" />
                  <span>{layer.name}</span>
                </label>
                {on[layer.id] && layer.controls?.(panel)}
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
