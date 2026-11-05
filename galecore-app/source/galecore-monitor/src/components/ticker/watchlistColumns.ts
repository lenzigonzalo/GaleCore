import { useEffect, useState } from 'react';
import { fetchSpace, saveSpaceItem, SpaceItem } from '../../api/space';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';

/** Columnas opcionales de la watchlist; el símbolo siempre se ve. */
export type WatchlistColumn = 'last' | 'chg' | 'chgPct' | 'premarket';
export const WATCHLIST_COLUMNS: { id: WatchlistColumn; label: string }[] = [
  { id: 'last', label: 'Precio (Last)' },
  { id: 'chg', label: 'Variación (Chg)' },
  { id: 'chgPct', label: 'Variación % (Chg%)' },
  { id: 'premarket', label: 'Premarket' },
];
const KEY = 'watchlist-columnas';
const DEFAULT_HIDDEN: WatchlistColumn[] = ['premarket'];
const EVENT = 'galecore:watchlist-columns';

export function readHiddenColumns(items: SpaceItem[]): WatchlistColumn[] {
  try {
    const hidden = JSON.parse(items.find(i => i.kind === 'preference' && i.key === KEY)?.content || 'null')?.hidden;
    return Array.isArray(hidden) ? hidden.filter((id: string) => WATCHLIST_COLUMNS.some(c => c.id === id)) : DEFAULT_HIDDEN;
  } catch { return DEFAULT_HIDDEN; }
}

/** Columnas ocultas, preferencia privada del usuario (por defecto sólo Premarket); cambia al instante en todas las watchlists. */
export function useWatchlistColumns(): { hidden: WatchlistColumn[]; toggle: (id: WatchlistColumn) => void } {
  const user = useCurrentUserStore(s => s.user);
  const [hidden, setHidden] = useState<WatchlistColumn[]>(DEFAULT_HIDDEN);
  useEffect(() => {
    let active = true, changed = false;
    const update = (event: Event) => { changed = true; setHidden((event as CustomEvent<WatchlistColumn[]>).detail); };
    window.addEventListener(EVENT, update);
    fetchSpace().then(data => { if (active && !changed) setHidden(readHiddenColumns(data.items)); }).catch(() => {});
    return () => { active = false; window.removeEventListener(EVENT, update); };
  }, [user]);
  const toggle = (id: WatchlistColumn) => {
    const next = hidden.includes(id) ? hidden.filter(c => c !== id) : [...hidden, id];
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
    saveSpaceItem('preference', KEY, { title: 'Columnas de la watchlist', content: JSON.stringify({ hidden: next }), format: 'json', visibility: 'private' }).catch(() => {});
  };
  return { hidden, toggle };
}
