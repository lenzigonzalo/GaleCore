import { Metric, PerformancePanelResponse } from '../../types/shadow';
import { fmtPnl, fmtPct, fmtPrice, fmtTime, MARKET_TZ } from '../../utils/formatters';

export const usd = (n: number) => fmtPnl(n).replace('-', '−');
export const amount = (n: number) => usd(n).replace(/^\+/, '');
export const pct = (n: number) => fmtPct(n, 1).replace('-', '−');
export const rate = (n: number) => `${fmtPrice(n * 100, 1)}%`;
export const days = (n: number) => `${fmtPrice(n, 1)} d`;
export const date = (iso: string | null) => iso ? `${new Date(iso).toLocaleDateString('es-AR', { timeZone: MARKET_TZ })} ${fmtTime(new Date(iso))} ET` : 'n/d';
export const stateLabel = (state: string) => state === 'RUNNING' ? 'corriendo' : state === 'PAUSED' ? 'pausada' : state === 'STOPPED' ? 'detenida' : state;
export const exitLabel = (reason: string) => reason === 'TAKE_PROFIT' ? 'Toma de ganancia' : reason === 'STOP_LOSS' ? 'Stop loss' : reason === 'DTE_EXIT' || reason === 'TIME_EXIT' ? 'Por vencimiento/tiempo' : reason;
export const metricText = (metric: Metric, format: (n: number) => string = fmtPrice) => metric.value === null ? '—' : format(metric.value);
export function readPanelError(error: unknown): string {
  const e = error as { response?: { status?: number }; message?: string };
  if (e.response?.status === 404) return 'Esta estrategia todavía no tiene posiciones SHADOW';
  if (e.response?.status === 503) return 'SHADOW no tiene persistencia disponible';
  if (/timeout|aborted/i.test(e.message || '')) return 'El panel tardó demasiado en responder. Reintentá la lectura.';
  return e.message || 'No se pudo leer el panel de rendimiento.';
}
export function missingReasons(panel: PerformancePanelResponse): string[] {
  const reasons = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    if ('value' in item && item.value === null && typeof item.reason === 'string' && item.reason.trim()) reasons.add(item.reason);
    Object.values(item).forEach(visit);
  };
  visit(panel);
  for (const reason of [panel.openRiskVsLimits === null ? panel.openRiskVsLimitsReason : null,
    panel.hypothesis.sampleReached === null ? panel.hypothesis.reason : null, panel.regime.reason,
    panel.execution.notIncluded]) if (reason?.trim()) reasons.add(reason);
  for (const position of panel.openPositions ?? []) {
    position.valuationProblems?.forEach(reason => reasons.add(reason));
    if (position.unrealizedPnl === null || position.lastSpreadValue === null) reasons.add('Posiciones abiertas sin valuación disponible');
  }
  return Array.from(reasons);
}
