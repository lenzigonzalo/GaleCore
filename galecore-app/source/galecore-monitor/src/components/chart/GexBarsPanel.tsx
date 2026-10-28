import React from 'react';
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
  priceToY: (price: number) => number | null;
  height:   number;
}

const PANEL_W  = GEX_BARS_W;
const LABEL_W  = 38;  // px for strike labels on left
const BAR_AREA = PANEL_W - LABEL_W - 4; // total horizontal space for bars
const HALF_BAR = BAR_AREA / 2;          // each side (put left, call right)
const CENTER_X = LABEL_W + HALF_BAR;    // x=0 axis position

export const GexBarsPanel = React.memo(function GexBarsPanel({
  strikes, spot, callWall, putWall, callBand, putBand, zgl, priceToY, height,
}: Props) {
  if (!strikes.length || height <= 0) return null;

  const maxCallGex = Math.max(...strikes.map(s => s.callGex), 0.001);
  const maxPutGex  = Math.max(...strikes.map(s => Math.abs(s.putGex)), 0.001);
  const maxAbs     = Math.max(maxCallGex, maxPutGex);

  // Only render strikes in visible area (with small clip buffer)
  const visible = strikes.filter(s => {
    const y = priceToY(s.strike);
    return y !== null && y >= -10 && y <= height + 10;
  });

  const lineY = (price: number) => {
    const y = priceToY(price);
    return y !== null && y >= 0 && y <= height ? y : null;
  };

  const spotY     = lineY(spot);
  const zglY      = lineY(zgl);
  const callWallY = lineY(callWall);
  const putWallY  = lineY(putWall);

  return (
    <div style={{
      width: '48%',
      maxWidth: PANEL_W,
      flexShrink: 0,
      borderLeft: '1px solid var(--border-dark)',
      backgroundColor: 'var(--bg-primary)',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <svg viewBox={`0 0 ${PANEL_W} ${height}`} preserveAspectRatio="none" width="100%" height={height} style={{ display: 'block' }}>
        {/* El sombreado de la banda va PRIMERO: es fondo, y las barras y los muros se leen encima.
            Pintado después taparía las barras que la banda justamente viene a describir. */}
        <BandShade band={callBand} color={CALL_COLOR} lineY={lineY} height={height} />
        <BandShade band={putBand}  color={PUT_COLOR}  lineY={lineY} height={height} />

        {/* Header labels */}
        <text x={CENTER_X - HALF_BAR / 2} y={10} fill={sideColorAlpha(PUT_COLOR, 0.55)} fontSize={7} textAnchor="middle">PUT</text>
        <text x={CENTER_X + HALF_BAR / 2} y={10} fill={sideColorAlpha(CALL_COLOR, 0.55)} fontSize={7} textAnchor="middle">CALL</text>

        {/* Zero axis */}
        <line x1={CENTER_X} y1={14} x2={CENTER_X} y2={height} stroke="var(--border)" strokeWidth={1} />

        {/* Bars */}
        {visible.map(s => {
          const y = priceToY(s.strike);
          if (y === null) return null;
          const yPx = y as number;

          const callW = Math.max(1, (s.callGex / maxAbs) * HALF_BAR);
          const putW  = Math.max(1, (Math.abs(s.putGex) / maxAbs) * HALF_BAR);
          const neighbours = visible.map(v => priceToY(v.strike)).filter((v): v is number => v != null && v !== yPx);
          const spacing = neighbours.length ? Math.min(...neighbours.map(v => Math.abs(v - yPx))) : 18;
          const barH = Math.max(1, Math.min(14, spacing * 0.7));

          // Highlight the spot strike
          const isAtm = Math.abs(s.strike - spot) < 2.5;

          return (
            <g key={s.strike}>
              {/* Strike label */}
              <text
                x={LABEL_W - 3} y={yPx + 3.5}
                fill={isAtm ? 'var(--text-secondary)' : 'var(--text-muted)'}
                fontSize={isAtm ? 9.5 : 8.5}
                fontWeight={isAtm ? 600 : 400}
                textAnchor="end"
                fontFamily="var(--font-mono)"
              >
                {s.strike}
              </text>

              {/* Call GEX bar — right of center */}
              {s.callGex > 0 && (
                <rect
                  x={CENTER_X + 1}
                  y={yPx - barH / 2}
                  width={callW}
                  height={barH}
                  fill={sideColorAlpha(CALL_COLOR, isAtm ? 0.9 : 0.55)}
                  rx={1}
                />
              )}

              {/* Put GEX bar — left of center */}
              {s.putGex < 0 && (
                <rect
                  x={CENTER_X - putW - 1}
                  y={yPx - barH / 2}
                  width={putW}
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
            <line x1={LABEL_W} y1={callWallY} x2={PANEL_W} y2={callWallY} stroke={CALL_COLOR} strokeWidth={1} strokeDasharray="3,2" />
            <text x={PANEL_W - 2} y={callWallY - 2} fill={CALL_COLOR} fontSize={7} textAnchor="end">CW {fmtPrice(callWall, 0)}</text>
          </g>
        )}

        {/* Put Wall line */}
        {putWallY !== null && (
          <g>
            <line x1={LABEL_W} y1={putWallY} x2={PANEL_W} y2={putWallY} stroke={PUT_COLOR} strokeWidth={1} strokeDasharray="3,2" />
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
            <text x={LABEL_W - 3} y={spotY - 2} fill="#e2e8f0" fontSize={7.5} textAnchor="end" opacity={0.8}>
              {fmtPrice(spot, 1)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
});

/**
 * La banda de gamma como ZONA sombreada, **sin etiqueta y sin líneas**: cuánta masa hay realmente
 * alrededor del muro, que es lo que la línea del muro sola no puede decir.
 *
 * Mismo color de lado y misma opacidad (`BAND_FILL_ALPHA`) que el sombreado de `GexChart`: los dos
 * gráficos comparten el eje de precio, así que dos tratamientos distintos se leerían como dos
 * objetos distintos. El color es identidad de lado —CALL verde, PUT rojo— y no bien/mal.
 *
 * **El texto es del muro, no de la banda.** El muro contesta "qué número" y por eso lleva línea y
 * etiqueta; la banda contesta "qué tan ancha es la concentración", que es forma y se lee del
 * sombreado.
 *
 * `null` no dibuja nada — el scope agregado, donde la banda no está definida.
 */
function BandShade({ band, color, lineY, height }: {
  band: GammaBandApi | null;
  color: string;
  lineY: (price: number) => number | null;
  height: number;
}) {
  if (!band) return null;

  // `lineY` recorta a la vista visible, así que una banda parcialmente fuera de pantalla perdería
  // uno de sus dos extremos y no se dibujaría. Se clampea contra el alto en vez de descartarla.
  const bruto = [band.low, band.high].map(p => lineY(p));
  if (bruto.every(y => y === null)) return null;
  const [yA, yB] = [lineY(band.low) ?? height, lineY(band.high) ?? 0];

  const top = Math.max(0, Math.min(yA, yB));
  const bottom = Math.min(height, Math.max(yA, yB));
  if (bottom - top <= 0) return null;

  return (
    <rect
      x={LABEL_W}
      y={top}
      width={PANEL_W - LABEL_W}
      height={bottom - top}
      fill={sideColorAlpha(color, BAND_FILL_ALPHA)}
    />
  );
}
