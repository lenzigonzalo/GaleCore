import { GexStrike } from '../../types/api';

const ZONE_FRAC = 0.03;   // un strike entra en la zona gamma si algún lado llega al 3 % del máximo

/**
 * La zona gamma: strikes con |callGex| o |putGex| >= 3 % del máximo, unidos con spot, muros y ZGL,
 * más un paso de strike (la mediana entre strikes vecinos) de margen arriba y abajo. La usa el
 * botón «Encuadrar» para fijar el eje de precio del gráfico.
 */
export function gammaZoneRange(strikes: GexStrike[], levels: number[]): { lo: number; hi: number } | null {
  if (!strikes.length) return null;
  const ks = strikes.map(s => s.strike).sort((a, b) => a - b);
  const gaps = ks.slice(1).map((k, i) => k - ks[i]).filter(g => g > 0).sort((a, b) => a - b);
  const step = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1;
  const mx = Math.max(...strikes.map(s => Math.max(Math.abs(s.callGex), Math.abs(s.putGex))), 1e-9);
  const pts = [
    ...strikes.filter(s => Math.max(Math.abs(s.callGex), Math.abs(s.putGex)) >= mx * ZONE_FRAC).map(s => s.strike),
    ...levels.filter(v => Number.isFinite(v) && v > 0),
  ];
  const base = pts.length ? pts : ks;
  let lo = Math.min(...base) - step, hi = Math.max(...base) + step;
  if (!(hi > lo)) { lo -= step; hi += step; }
  return { lo, hi };
}
