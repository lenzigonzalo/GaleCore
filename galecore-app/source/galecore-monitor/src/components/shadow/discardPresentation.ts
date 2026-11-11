import { DISCARD_LABELS, LIMIT_LABELS, ShadowEvent } from '../../types/shadow';

/** Por qué se descartó, tal como lo dejó el runtime en el evento. */
/** Motivo de un descarte: si el evento dice qué límite frenó la entrada, ese; si no, el tipo de evento. */
export function discardLabel(evt: ShadowEvent): string {
  const limit = evt.payload?.limit;
  return typeof limit === 'string' && LIMIT_LABELS[limit] ? LIMIT_LABELS[limit] : DISCARD_LABELS[evt.eventType] ?? evt.eventType;
}

const DIRECTIONS: Record<string, string> = { bullish: ' alcista', bearish: ' bajista', neutral: '', unknown: '' };
/**
 * Los motivos viejos del runtime quedaron guardados con jerga y decimales con punto («SPX unknown 2026-W45», «9.00 USD»):
 * se leen en español sin tocar el registro. Los nuevos ya salen así y esto no les cambia nada.
 */
export function tidyReason(text: string): string {
  return text
    .replace(/\((\S+) (bullish|bearish|neutral|unknown) (\d{4}-W\d{2})\)/g, (_m, sym: string, dir: string, week: string) => `(${sym}${DIRECTIONS[dir]}, vence la semana ${week})`)
    .replace(/\b(\d+)\.(\d{2})\b/g, (_m, i: string, d: string) => parseFloat(`${i}.${d}`).toLocaleString('es-AR', { maximumFractionDigits: 2 }));
}
export function discardReason(evt: ShadowEvent): string {
  const p = evt.payload ?? {};
  if (Array.isArray(p.gates)) {
    return (p.gates as Array<Record<string, unknown>>)
      .map((g) => `${g.gate_id}: ${g.status}${g.value !== null && g.value !== undefined ? ` (${g.value} ${g.operator} ${g.threshold})` : ''}`)
      .join(' · ');
  }
  if (typeof p.reason === 'string') return tidyReason(p.reason);
  if (Array.isArray(p.errors)) return (p.errors as unknown[]).join(' · ');
  return 'sin motivo registrado';
}
