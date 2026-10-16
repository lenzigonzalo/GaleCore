/**
 * Watchlist guardada en la cuenta (preferencia `watchlist` del espacio): grupos con sus tickers y los tickers de la
 * plataforma que el usuario quitó. Lo de la plataforma que no está en ningún grupo ni quitado entra al último grupo.
 */
export interface WatchlistGroup { name: string; symbols: string[] }
export interface Watchlist { groups: WatchlistGroup[]; hidden: string[] }

export const WATCHLIST_KEY = 'watchlist';
const ETF = ['SPY', 'QQQ', 'IWM', 'TLT'];

export function defaultWatchlist(base: string[]): Watchlist {
  return {
    groups: [
      { name: 'ETF', symbols: base.filter(s => ETF.includes(s)) },
      { name: 'Instrumentos', symbols: base.filter(s => !ETF.includes(s)) },
    ],
    hidden: [],
  };
}

export function parseWatchlist(raw: unknown): Watchlist | null {
  const value = raw as Partial<Watchlist> | null;
  if (!value || !Array.isArray(value.groups)) return null;
  const groups = value.groups
    .filter(g => g && typeof g.name === 'string' && Array.isArray(g.symbols))
    .map(g => ({ name: g.name, symbols: g.symbols.filter(s => typeof s === 'string') }));
  if (!groups.length) return null;
  return { groups, hidden: Array.isArray(value.hidden) ? value.hidden.filter(s => typeof s === 'string') : [] };
}

/** Lo que se muestra: los grupos guardados más lo nuevo de la plataforma, sin lo quitado. */
export function resolveWatchlist(saved: Watchlist | null, base: string[]): Watchlist {
  const list = saved ?? defaultWatchlist(base);
  const listed = new Set(list.groups.flatMap(g => g.symbols));
  const missing = base.filter(s => !listed.has(s) && !list.hidden.includes(s));
  if (!missing.length) return list;
  const groups = list.groups.map((g, i) => i === list.groups.length - 1 ? { ...g, symbols: [...g.symbols, ...missing] } : g);
  return { ...list, groups };
}

const without = (list: Watchlist, symbol: string) => list.groups.map(g => ({ ...g, symbols: g.symbols.filter(s => s !== symbol) }));

export function addSymbol(list: Watchlist, symbol: string, group: string): Watchlist {
  const target = list.groups.some(g => g.name === group) ? group : list.groups[list.groups.length - 1].name;
  const groups = without(list, symbol).map(g => g.name === target ? { ...g, symbols: [...g.symbols, symbol] } : g);
  return { groups, hidden: list.hidden.filter(s => s !== symbol) };
}

export function removeSymbol(list: Watchlist, symbol: string, base: string[]): Watchlist {
  return { groups: without(list, symbol), hidden: base.includes(symbol) && !list.hidden.includes(symbol) ? [...list.hidden, symbol] : list.hidden };
}

export function restoreSymbol(list: Watchlist, symbol: string): Watchlist {
  return { ...list, hidden: list.hidden.filter(s => s !== symbol) };
}

export const moveSymbol = (list: Watchlist, symbol: string, group: string): Watchlist => addSymbol(list, symbol, group);

/** Nombre libre: «Grupo», «Grupo 2»… */
export function createGroup(list: Watchlist, name = 'Grupo'): Watchlist {
  let candidate = name; let n = 2;
  while (list.groups.some(g => g.name === candidate)) candidate = `${name} ${n++}`;
  return { ...list, groups: [...list.groups, { name: candidate, symbols: [] }] };
}

export function renameGroup(list: Watchlist, from: string, to: string): Watchlist {
  const name = to.trim();
  if (!name || name === from || list.groups.some(g => g.name === name)) return list;
  return { ...list, groups: list.groups.map(g => g.name === from ? { ...g, name } : g) };
}

/** Borrar un grupo no borra sus tickers: pasan al primer grupo que queda. */
export function deleteGroup(list: Watchlist, name: string): Watchlist {
  if (list.groups.length < 2) return list;
  const gone = list.groups.find(g => g.name === name);
  if (!gone) return list;
  const rest = list.groups.filter(g => g.name !== name);
  rest[0] = { ...rest[0], symbols: [...rest[0].symbols, ...gone.symbols.filter(s => !rest[0].symbols.includes(s))] };
  return { ...list, groups: rest };
}
