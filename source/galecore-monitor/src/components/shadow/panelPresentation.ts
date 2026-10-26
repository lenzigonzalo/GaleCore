import { Metric } from '../../types/shadow';
import { fmtPnl, fmtPct, fmtPrice, fmtTime, MARKET_TZ } from '../../utils/formatters';

export const usd = (n: number) => fmtPnl(n).replace('-', '−');
export const amount = (n: number) => usd(n).replace(/^\+/, '');
export const pct = (n: number) => fmtPct(n, 1).replace('-', '−');
export const rate = (n: number) => `${fmtPrice(n * 100, 1)}%`;
export const days = (n: number) => `${fmtPrice(n, 1)} d`;
export const date = (iso: string | null) => iso ? `${new Date(iso).toLocaleDateString('es-AR', { timeZone: MARKET_TZ })} ${fmtTime(new Date(iso))} ET` : 'n/d';
export const stateLabel = (state: string) => state === 'RUNNING' ? 'corriendo' : state === 'PAUSED' ? 'pausada' : state === 'STOPPED' ? 'detenida' : state;
const EXIT_LABELS: Record<string, string> = {
  TAKE_PROFIT: 'Toma de ganancia', STOP_LOSS: 'Stop loss', EXPIRATION: 'Vencimiento', TIME_EXIT: 'Por tiempo', DTE_EXIT: 'Por tiempo',
  EVENT_EXIT: 'Por evento', METRIC_EXIT: 'Por condición', MANUAL: 'Manual', KILL_SWITCH: 'Switch apagado',
};
export const exitLabel = (reason: string) => EXIT_LABELS[reason] ?? reason;
/** Cómo se elige el strike de una pata, en palabras: «Δ 0,20», «5 pts debajo del precio», «fijo 7615», «5 pts arriba de la pata X». */
export interface LegSelection { method: string; target_delta?: number; width?: number; points_from_spot?: number; pct_from_spot?: number; points_from_atm?: number; strike?: number; from_leg?: string; offset_points?: number }
const num = (n: number) => String(n).replace('.', ',');
const fromSpot = (n: number, unit: string) => `${num(Math.abs(n))} ${unit} ${n < 0 ? 'debajo' : 'arriba'} del precio`;
export function legSelectionLabel(sel: LegSelection): string {
  switch (sel.method) {
    case 'DELTA': return sel.target_delta === undefined ? 'Delta' : `Δ ${num(sel.target_delta)}`;
    case 'FIXED_WIDTH': return sel.width === undefined ? 'Ancho fijo' : `ancho ${num(sel.width)}`;
    case 'POINTS_FROM_SPOT': return sel.points_from_spot === undefined ? 'Puntos del precio' : fromSpot(sel.points_from_spot, 'pts');
    case 'PCT_FROM_SPOT': return sel.pct_from_spot === undefined ? 'Porcentaje del precio' : fromSpot(sel.pct_from_spot, '%');
    case 'POINTS_FROM_ATM': return sel.points_from_atm === undefined ? 'Puntos del strike más cercano'
      : sel.points_from_atm === 0 ? 'strike más cercano al precio'
      : `${num(Math.abs(sel.points_from_atm))} pts ${sel.points_from_atm < 0 ? 'debajo' : 'arriba'} del strike más cercano`;
    case 'FIXED_STRIKE': return sel.strike === undefined ? 'Strike fijo' : `fijo ${num(sel.strike)}`;
    case 'OFFSET_FROM_LEG': return sel.offset_points === undefined ? `Desde la pata ${sel.from_leg ?? ''}`.trim()
      : `${num(Math.abs(sel.offset_points))} pts ${sel.offset_points < 0 ? 'debajo' : 'arriba'} de la pata ${sel.from_leg ?? ''}`.trim();
    default: return sel.method;
  }
}
export const metricText = (metric: Metric, format: (n: number) => string = fmtPrice) => metric.value === null ? '—' : format(metric.value);
export function readPanelError(error: unknown): string {
  const e = error as { response?: { status?: number }; message?: string };
  if (e.response?.status === 404) return 'Esta estrategia todavía no tiene posiciones SHADOW';
  if (e.response?.status === 503) return 'SHADOW no tiene persistencia disponible';
  if (/timeout|aborted/i.test(e.message || '')) return 'El panel tardó demasiado en responder. Reintentá la lectura.';
  return e.message || 'No se pudo leer el panel de rendimiento.';
}
const SYMBOLS = new Set(['spy', 'qqq', 'iwm', 'tlt', 'gex', 'pcs', 'vix', 'iv', 'ic']);
/** Nombre legible de una spec: «spy_prima_varianza_30_45d» → «SPY prima varianza 30–45d». Sólo presentación. */
export function strategyName(spec: string): string {
  const words = spec.replace(/(\d+)_(\d+d)\b/g, '$1–$2').split('_').filter(Boolean)
    .map(word => SYMBOLS.has(word) ? word.toUpperCase() : word);
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
