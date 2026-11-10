import React, { useState } from 'react';
import { GexStrike } from '../../types/api';
import { GammaBandApi } from '../../types/gex';
import { GEX_BARS_W } from '../gex/graphLayout';
import { BAND_FILL_ALPHA, CALL_COLOR, PUT_COLOR, sideColorAlpha } from '../../utils/optionSideColors';
import { fmtPrice } from '../../utils/formatters';

interface Props {
  strikes:  GexStrike[];
  spot:     number;
  /** El muro: el nivel con nombre y valor. Va como línea con etiqueta. */
  callWall: number;
  putWall:  number;
  /**
   * La banda de gamma del lado, que se **sombrea** sin etiqueta. `null` si este scope no la tiene
   * — el agregado nunca la tiene, porque su ancho es una fracción del expected move.
   */
  callBand: GammaBandApi | null;
  putBand:  GammaBandApi | null;
  zgl:      number;
  /** Mismo mapeo de precio que las velas (`series.priceToCoordinate`): cada strike queda a la altura del eje. */
  priceToY: (price: number) => number | null;
  height:   number;
  /** Ancho en píxeles; sin él, el ancho de diseño. */
  width?:   number;
}

const LABEL_W  = 38;  // px for strike labels on left
const TOP      = 20;  // header: toggle Neto | Call/Put y rótulos PUT/CALL
const MIN_SIDE = 8;   // px mínimos de cada lado del eje cero
const VIEW_KEY = 'galecore:market:gex-view';
type View = 'net' | 'split';
const readView = (): View => { try { return localStorage.getItem(VIEW_KEY) === 'split' ? 'split' : 'net'; } catch { return 'net'; } };
const MIN_LABEL_GAP = 14;   // px mínimos entre rótulos de strike
const STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500];
export const GexBarsPanel = React.memo(function GexBarsPanel({
  strikes, spot, callWall, putWall, callBand, putBand, zgl, priceToY, height, width = GEX_BARS_W,
}: Props) {
  const [view, setViewState] = useState<View>(readView);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* sin storage */ } };
  if (!strikes.length || height <= 0) return null;
  const PANEL_W  = width;
  const BAR_AREA = PANEL_W - LABEL_W - 4; // espacio horizontal total para barras

  // Sólo los strikes dentro del área visible del gráfico (con un pequeño margen de recorte).
  const yOf = new Map<number, number>();
  for (const s of strikes) { const y = priceToY(s.strike); if (y != null && y >= -10 && y <= height + 10) yOf.set(s.strike, y); }
  const visible = strikes.filter(s => yOf.has(s.strike)).sort((a, b) => a.strike - b.strike);
  const yPos = (k: number) => yOf.get(k) ?? 0;

  // Cada strike aporta un largo a la izquierda (left) y uno a la derecha (right), en unidades de GEX.
  const sides = (s: GexStrike) => view === 'net'
    ? { left: Math.max(0, -(s.callGex + s.putGex)), right: Math.max(0, s.callGex + s.putGex) }
    : { left: Math.abs(s.putGex), right: Math.max(0, s.callGex) };
  const maxL = Math.max(0, ...visible.map(s => sides(s).left));
  const maxR = Math.max(0, ...visible.map(s => sides(s).right));
  // Eje cero proporcional a lo que hay de cada lado y una sola escala (px por unidad de GEX).
  const total = maxL + maxR;
  const leftPx = total > 0 ? Math.max(MIN_SIDE, Math.min(BAR_AREA - MIN_SIDE, BAR_AREA * (maxL / total))) : BAR_AREA / 2;
  const rightPx = BAR_AREA - leftPx;
  const pxPerGex = Math.min(maxL > 0 ? leftPx / maxL : Infinity, maxR > 0 ? rightPx / maxR : Infinity);
  const scale = Number.isFinite(pxPerGex) ? pxPerGex : 0;
  const CENTER_X = LABEL_W + leftPx;

  const lineY = (price: number) => {
    if (!(price > 0)) return null;
    const y = priceToY(price);
    return y != null && y >= 0 && y <= height ? y : null;
  };

  // Rótulos de strike: sólo los que entran sin chocar, en un paso redondo según los píxeles por unidad de precio.
  // Las barras siguen siendo todas. Spot, CW y PW se rotulan aunque no caigan en el paso si hay lugar.
  const pxPerUnit = (() => {
    if (visible.length < 2) return 0;
    const a = visible[0], b = visible[visible.length - 1];
    return a.strike === b.strike ? 0 : Math.abs((yPos(b.strike) - yPos(a.strike)) / (b.strike - a.strike));
  })();
  const step = pxPerUnit > 0 ? (STEPS.find(k => k * pxPerUnit >= MIN_LABEL_GAP) ?? STEPS[STEPS.length - 1]) : 1;
  const onStep = (k: number) => Math.abs(Math.round(k / step) * step - k) < 1e-6;
  const nearestStrike = (price: number) => strikes.reduce((best, s) => Math.abs(s.strike - price) < Math.abs(best - price) ? s.strike : best, strikes[0].strike);
  const key = new Map<number, 'spot' | 'call' | 'put'>([[nearestStrike(spot), 'spot'], [nearestStrike(putWall), 'put'], [nearestStrike(callWall), 'call']]);
  const stepYs = visible.filter(s => onStep(s.strike)).map(s => yPos(s.strike));
  const showLabel = (k: number, y: number) => onStep(k) || (key.has(k) && stepYs.every(o => Math.abs(o - y) >= MIN_LABEL_GAP * 0.8));

  const spotY     = lineY(spot);
  const zglY      = lineY(zgl);
  const callWallY = lineY(callWall);
  const putWallY  = lineY(putWall);

  return (
    <div style={{
      width: PANEL_W,
      flexShrink: 0,
      borderLeft: '1px solid var(--border-dark)',
      backgroundColor: 'var(--bg-primary)',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <svg viewBox={`0 0 ${PANEL_W} ${height}`} width="100%" height={height} style={{ display: 'block' }}>
        {/* El sombreado de la banda va PRIMERO: es fondo, y las barras y los muros se leen encima. */}
        <BandShade band={callBand} color={CALL_COLOR} priceToY={priceToY} height={height} panelW={PANEL_W} />
        <BandShade band={putBand}  color={PUT_COLOR}  priceToY={priceToY} height={height} panelW={PANEL_W} />

        {/* En Call/Put se rotula cada lado; en Neto el toggle ocupa el encabezado. */}
        {view === 'split' && <>
          <text x={LABEL_W + 2} y={TOP - 3} fill={sideColorAlpha(PUT_COLOR, 0.7)} fontSize={8}>PUT</text>
          <text x={PANEL_W - 4} y={TOP - 3} fill={sideColorAlpha(CALL_COLOR, 0.7)} fontSize={8} textAnchor="end">CALL</text>
        </>}

        {/* Zero axis */}
        <line x1={CENTER_X} y1={TOP} x2={CENTER_X} y2={height} stroke="var(--border)" strokeWidth={1} />

        {/* Bars */}
        {visible.map((s, i) => {
          const yPx = yPos(s.strike);

          const { left, right } = sides(s);
          const leftW  = left  > 0 ? Math.max(1, left  * scale) : 0;
          const rightW = right > 0 ? Math.max(1, right * scale) : 0;
          const neighbours = [visible[i - 1], visible[i + 1]].filter(Boolean).map(v => Math.abs(yPos(v.strike) - yPx));
          const spacing = neighbours.length ? Math.min(...neighbours) : 18;
          const barH = Math.max(2, Math.min(14, spacing * 0.7));

          // Highlight the spot strike
          const isAtm = s.strike === nearestStrike(spot);

          return (
            <g key={s.strike}>
              {/* Strike label */}
              {showLabel(s.strike, yPx) && (() => {
                const role = key.get(s.strike);
                const color = role === 'call' ? CALL_COLOR : role === 'put' ? PUT_COLOR : isAtm ? 'var(--text-secondary)' : 'var(--text-muted)';
                return (
                  <text
                    x={LABEL_W - 3} y={yPx + 3.5}
                    fill={color}
                    fontSize={role || isAtm ? 9.5 : 8.5}
                    fontWeight={role || isAtm ? 600 : 400}
                    textAnchor="end"
                    fontFamily="var(--font-mono)"
                  >
                    {s.strike}
                  </text>
                );
              })()}

              {/* Lado derecho: call (Call/Put) o neto positivo (Neto) */}
              {rightW > 0 && (
                <rect
                  x={CENTER_X + 1}
                  y={yPx - barH / 2}
                  width={rightW}
                  height={barH}
                  fill={sideColorAlpha(CALL_COLOR, isAtm ? 0.9 : 0.55)}
                  rx={1}
                />
              )}

              {/* Lado izquierdo: put (Call/Put) o neto negativo (Neto) */}
              {leftW > 0 && (
                <rect
                  x={CENTER_X - leftW - 1}
                  y={yPx - barH / 2}
                  width={leftW}
                  height={barH}
                  fill={sideColorAlpha(PUT_COLOR, isAtm ? 0.9 : 0.55)}
                  rx={1}
                />
              )}

              {/* Tick mark on axis */}
              <line x1={CENTER_X - 1.5} y1={yPx} x2={CENTER_X + 1.5} y2={yPx} stroke="var(--border)" strokeWidth={0.5} />
            </g>
          );
        })}

        {/* Call Wall line */}
        {callWallY !== null && (
          <g>
            <line x1={LABEL_W} y1={callWallY} x2={PANEL_W} y2={callWallY} stroke={CALL_COLOR} strokeWidth={1} strokeDasharray="3,2" opacity={0.85} />
            <text x={PANEL_W - 2} y={callWallY - 2} fill={CALL_COLOR} fontSize={7} textAnchor="end">CW {fmtPrice(callWall, 0)}</text>
          </g>
        )}

        {/* Put Wall line */}
        {putWallY !== null && (
          <g>
            <line x1={LABEL_W} y1={putWallY} x2={PANEL_W} y2={putWallY} stroke={PUT_COLOR} strokeWidth={1} strokeDasharray="3,2" opacity={0.85} />
            <text x={PANEL_W - 2} y={putWallY + 9} fill={PUT_COLOR} fontSize={7} textAnchor="end">PW {fmtPrice(putWall, 0)}</text>
          </g>
        )}

        {/* ZGL line */}
        {zglY !== null && (
          <g>
            <line x1={LABEL_W} y1={zglY} x2={PANEL_W} y2={zglY} stroke="#94a3b8" strokeWidth={1} strokeDasharray="2,3" />
          </g>
        )}

        {/* Spot price line */}
        {spotY !== null && (
          <g>
            <line x1={0} y1={spotY} x2={PANEL_W} y2={spotY} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4,3" opacity={0.7} />
            <text x={PANEL_W - 2} y={spotY - 2} fill="#e2e8f0" fontSize={7.5} textAnchor="end" opacity={0.8}>
              {fmtPrice(spot, 1)}
            </text>
          </g>
        )}
      </svg>
      <div role="group" aria-label="Vista del panel gamma" style={{ position: 'absolute', top: 2, left: '50%', transform: 'translateX(-50%)', display: 'flex', fontSize: 9, border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
        {([['net', 'Neto'], ['split', 'Call/Put']] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}
            style={{ border: 0, padding: '1px 7px', cursor: 'pointer', background: view === id ? 'var(--bg-tertiary)' : 'none', color: view === id ? 'var(--text-primary)' : 'var(--text-muted)' }}>{label}</button>
        ))}
      </div>
    </div>
  );
});

/**
 * La banda de gamma como ZONA sombreada, sin etiqueta y sin líneas: cuánta masa hay realmente
 * alrededor del muro. Mismo color de lado y opacidad (`BAND_FILL_ALPHA`) que el sombreado de
 * `GexChart`. `null` no dibuja nada — el scope agregado, donde la banda no está definida.
 */
function BandShade({ band, color, priceToY, height, panelW }: {
  band: GammaBandApi | null;
  color: string;
  priceToY: (price: number) => number | null;
  height: number;
  panelW: number;
}) {
  if (!band) return null;
  // Una banda parcialmente fuera de pantalla pierde un extremo: se recorta contra el alto en vez de descartarla.
  const raw = [priceToY(band.low), priceToY(band.high)];
  if (raw.every(y => y == null)) return null;
  const yA = raw[0] ?? height, yB = raw[1] ?? 0;
  const t = Math.max(0, Math.min(yA, yB));
  const b = Math.min(height, Math.max(yA, yB));
  if (b - t <= 0) return null;
  return (
    <rect x={LABEL_W} y={t} width={panelW - LABEL_W} height={b - t} fill={sideColorAlpha(color, BAND_FILL_ALPHA)} />
  );
}
