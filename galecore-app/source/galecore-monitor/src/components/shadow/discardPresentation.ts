import { DISCARD_LABELS, LIMIT_LABELS, ShadowEvent } from '../../types/shadow';

/** Por qué se descartó, tal como lo dejó el runtime en el evento. */
/** Motivo de un descarte: si el evento dice qué límite frenó la entrada, ese; si no, el tipo de evento. */
export function discardLabel(evt: ShadowEvent): string {
  const limit = evt.payload?.limit;
  return typeof limit === 'string' && LIMIT_LABELS[limit] ? LIMIT_LABELS[limit] : DISCARD_LABELS[evt.eventType] ?? evt.eventType;
}

export function discardReason(evt: ShadowEvent): string {
  const p = evt.payload ?? {};
  if (Array.isArray(p.gates)) {
    return (p.gates as Array<Record<string, unknown>>)
      .map((g) => `${g.gate_id}: ${g.status}${g.value !== null && g.value !== undefined ? ` (${g.value} ${g.operator} ${g.threshold})` : ''}`)
      .join(' · ');
  }
  if (typeof p.reason === 'string') return p.reason;
  if (Array.isArray(p.errors)) return (p.errors as unknown[]).join(' · ');
  return 'sin motivo registrado';
}

