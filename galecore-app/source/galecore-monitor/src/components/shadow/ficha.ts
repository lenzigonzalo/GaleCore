import { ShadowEvaluation, ShadowEvent } from '../../types/shadow';
import { MARKET_TZ, fmtTime } from '../../utils/formatters';
import { discardLabel, discardReason } from './discardPresentation';
import { exitLabel } from './panelPresentation';

/** Presentación de la ficha de una estrategia: sólo agrupa, cuenta y da formato a filas que ya calculó la API. */

export const num = (n: number, max = 2, min = 0) => n.toLocaleString('es-AR', { minimumFractionDigits: min, maximumFractionDigits: max });
export const usdAr = (n: number | null | undefined) => n === null || n === undefined ? '—' : `${num(n)} USD`;
const signedUsd = (n: number) => `${n < 0 ? '−' : '+'}${num(Math.abs(n), 2, 2)} USD`;

/** «hace 3 min», «hace 2 h», «hace 4 días». */
export function agoText(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'hace instantes';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const d = Math.floor(hours / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

const marketDay = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { timeZone: MARKET_TZ });
const at = (e: ShadowEvent) => Date.parse(e.timestamp);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const reasonOf = (e: ShadowEvent) => { const r = discardReason(e); return r === 'sin motivo registrado' ? '' : r; };

const OPERATORS: Record<string, string> = { LT: '<', LTE: '≤', GT: '>', GTE: '≥', EQ: '=', NEQ: '≠', '<=': '≤', '>=': '≥', '<': '<', '>': '>', '=': '=' };
const GATE_STATUS: Record<string, string> = { PASS: 'pasa', FAIL: 'no pasa', NO_DATA: 'sin dato' };

/** «VIX 20,18 < 24: pasa». Las reglas que no comparan un número (eventos) van sin valor. */
export function gateLine(g: ShadowEvaluation['gateResults'][number]): string {
  const state = GATE_STATUS[g.status] ?? g.status.toLowerCase();
  const name = (g.label || g.gateId).replace(/\s*[<>≤≥=].*$/, '').trim() || g.gateId;
  const op = OPERATORS[g.operator];
  if (!op || g.threshold === null) return `${g.label || g.gateId}: ${state}`;
  return `${name} ${g.value === null ? 'sin dato' : num(g.value)} ${op} ${num(g.threshold)}: ${state}`;
}

export interface RegistryEntry { key: string; at: number; day: string; hour: string; text: string; tone?: 'ok' | 'bad'; gates?: string[] }

const hourOf = (iso: string) => fmtTime(new Date(iso)).slice(0, 5);
const asNum = (v: unknown) => typeof v === 'number' ? v : null;
/** Quién fue: «por vos» si el id es el del usuario actual, «por otro usuario» si no; sin id de usuario, «por un usuario». */
export function byWhom(by: unknown, userId: string | null | undefined): string {
  if (typeof by !== 'string' || !by) return '';
  if (by === 'SYSTEM') return ' por el sistema';
  if (!userId) return ' por un usuario';
  return by === userId ? ' por vos' : ' por otro usuario';
}

type Body = Pick<RegistryEntry, 'text' | 'tone'>;
function eventBody(e: ShadowEvent, userId: string | null | undefined, opened: ShadowEvent[], deployers: Record<string, string | null | undefined>): Body | null {
  const p = e.payload ?? {};
  switch (e.eventType) {
    case 'ENTRY_SKIPPED': case 'CANDIDATE_NOT_VIABLE': case 'RISK_CHECK_FAILED': case 'ENTRY_ABORTED': {
      const reason = reasonOf(e);
      const label = lowerFirst(discardLabel(e));
      // Si el motivo ya arranca con la causa («tope por apuesta (…): …») no se repite.
      return { text: `No entró: ${reason.toLowerCase().startsWith(label) ? reason : `${label}${reason ? ` (${reason})` : ''}`}`, tone: 'bad' };
    }
    case 'CANDIDATE_CREATED': case 'POSITION_OPENED': {
      // Una entrada deja dos eventos (candidato y posición): se cuenta una sola vez.
      if (e.eventType === 'CANDIDATE_CREATED' && opened.some(o => o.symbol === e.symbol && at(o) >= at(e) && at(o) - at(e) < 60000)) return null;
      const parts = [asNum(p.credit) === null ? '' : `crédito ${num(p.credit as number, 2, 2)}`, asNum(p.max_risk) === null ? '' : `riesgo máx. ${num(p.max_risk as number)} USD`].filter(Boolean);
      return { text: parts.length ? `Entró: ${parts.join(', ')}` : 'Entró', tone: 'ok' };
    }
    case 'POSITION_CLOSED': {
      const pnl = asNum(p.realized_pnl);
      return { text: `Salió: ${typeof p.exit_reason === 'string' ? exitLabel(p.exit_reason) : 'sin motivo'}${pnl === null ? '' : `, P&L ${signedUsd(pnl)}`}`, tone: pnl !== null && pnl < 0 ? 'bad' : 'ok' };
    }
    case 'INSTANCE_STOPPED': return { text: `Pausada${byWhom(p.stopped_by, userId)}` };
    case 'INSTANCE_CREATED': return { text: `Prendida${byWhom(deployers[e.instanceId] ?? p.deployed_by ?? p.started_by, userId)}` };
    default: return null; // las evaluaciones y sus gates se muestran desde la evaluación misma
  }
}

/** El registro legible: lo más nuevo primero; los gates de una evaluación quedan bajo su línea. */
export function registryEntries(events: ShadowEvent[], evaluations: ShadowEvaluation[], userId: string | null | undefined, deployers: Record<string, string | null | undefined> = {}): RegistryEntry[] {
  const opened = events.filter(e => e.eventType === 'POSITION_OPENED');
  const rows: RegistryEntry[] = [];
  const base = (iso: string) => ({ at: Date.parse(iso), day: marketDay(iso), hour: hourOf(iso) });
  events.forEach(e => { const body = eventBody(e, userId, opened, deployers); if (body) rows.push({ key: `e-${e.eventId}`, ...base(e.timestamp), ...body }); });
  evaluations.forEach(ev => rows.push({ key: `v-${ev.evaluationId}`, ...base(ev.evaluatedAt),
    text: `Evaluó ${ev.symbol}: ${ev.overallPass ? 'se cumplen las reglas de entrada' : 'no se cumplen las reglas de entrada'}`,
    tone: ev.overallPass ? 'ok' : 'bad', gates: ev.gateResults.map(gateLine) }));
  return rows.sort((a, b) => b.at - a.at);
}
