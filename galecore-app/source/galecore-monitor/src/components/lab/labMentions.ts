import type { SpaceItem } from '../../api/space';

/** Una skill o un agente del espacio (propio o compartido) que el trader puede nombrar en el chat con «/» o «@» (WS-0067). */
export interface Mention { kind: 'skill' | 'agent'; key: string; title: string }
export interface Trigger { char: '/' | '@'; query: string; start: number }

export function mentionsFromSpace(items: SpaceItem[]): Mention[] {
  const seen = new Set<string>();
  return items.filter(i => i.kind === 'skill' || i.kind === 'agent').map(i => ({ kind: i.kind as Mention['kind'], key: i.key, title: i.title || i.key }))
    .filter(m => { const id = m.kind + '/' + m.key; if (seen.has(id)) return false; seen.add(id); return true; });
}

/** «/» sólo al inicio del mensaje, «@» en cualquier parte (después de un espacio); la consulta es lo escrito hasta el cursor. */
export function findTrigger(value: string, caret: number): Trigger | null {
  const before = value.slice(0, caret);
  const m = /(^|\s)([/@])([\w.-]*)$/.exec(before);
  if (!m) return null;
  const start = before.length - m[3].length - 1;
  if (m[2] === '/' && start !== 0) return null;
  return { char: m[2] as Trigger['char'], query: m[3], start };
}

export function filterMentions(pieces: Mention[], trigger: Trigger): Mention[] {
  const kind = trigger.char === '/' ? 'skill' : 'agent', q = trigger.query.toLowerCase();
  return pieces.filter(m => m.kind === kind && (m.key.toLowerCase().includes(q) || m.title.toLowerCase().includes(q))).slice(0, 8);
}

/** Etiquetas que quedaron en el texto («/clave» al inicio, «@clave» en cualquier parte) que son piezas conocidas. */
export function mentionsIn(text: string, pieces: Mention[]): Mention[] {
  const found: Mention[] = [];
  for (const m of Array.from(text.matchAll(/(^|\s)([/@])([\w.-]+)/g))) {
    if (m[2] === '/' && m.index! + m[1].length !== 0) continue;
    const piece = pieces.find(p => p.key === m[3] && p.kind === (m[2] === '/' ? 'skill' : 'agent'));
    if (piece && !found.includes(piece)) found.push(piece);
  }
  return found;
}
