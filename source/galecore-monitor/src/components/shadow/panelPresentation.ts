import { Metric } from '../../types/shadow';
import { fmtPnl, fmtPct, fmtPrice, fmtTime, MARKET_TZ } from '../../utils/formatters';

export const usd = (n: number) => fmtPnl(n).replace('-', '−');
export const amount = (n: number) => usd(n).replace(/^\+/, '');
export const pct = (n: number) => fmtPct(n, 1).replace('-', '−');
export const rate = (n: number) => `${fmtPrice(n * 100, 1)}%`;
export const days = (n: number) => `${fmtPrice(n, 1)} d`;
export const date = (iso: string | null) => iso ? `${new Date(iso).toLocaleDateString('es-AR', { timeZone: MARKET_TZ })} ${fmtTime(new Date(iso))} ET` : 'n/d';
export const stateLabel = (state: string) => state === 'RUNNING' ? 'corriendo' : state === 'PAUSED' ? 'pausada' : state === 'STOPPED' ? 'detenida' : state;
export const exitLabel = (reason: string) => reason === 'TAKE_PROFIT' ? 'Toma de ganancia' : reason === 'STOP_LOSS' ? 'Stop loss' : reason === 'METRIC_EXIT' ? 'Salida por condición' : reason === 'EXPIRATION' ? 'Vencimiento' : reason === 'DTE_EXIT' || reason === 'TIME_EXIT' ? 'Por vencimiento/tiempo' : reason;
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
