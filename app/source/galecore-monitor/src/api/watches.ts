import { useCallback, useEffect, useState } from 'react';
import { fetchSpace, saveSpaceItem, SpaceItem } from './space';

/** Avisos de precio (WS-0064): viven en la pieza `agent/supervisor`, campo `watches`; se borran con `unwatch`. */
export interface Watch {
  id: string; symbol: string; metric: string; condition: 'above' | 'below';
  threshold: number; words: string; created_at: string;
  /** Texto ya legible que publica el back (p. ej. «precio de MSFT ≤ 489»). */
  label?: string;
}

const REFRESH_MS = 60_000;

/** Avisos de precio de un símbolo (sin distinguir mayúsculas); descarta lo mal formado. */
export function priceWatchesFor(content: unknown, symbol: string): Watch[] {
  const list = (content as { watches?: unknown } | null)?.watches;
  if (!Array.isArray(list)) return [];
  const sym = symbol.trim().toUpperCase();
  return list.filter((w): w is Watch => !!w && typeof w.id === 'string' && w.metric === 'price'
    && typeof w.symbol === 'string' && w.symbol.trim().toUpperCase() === sym
    && (w.condition === 'above' || w.condition === 'below')
    && typeof w.threshold === 'number' && Number.isFinite(w.threshold));
}

/** Todos los avisos armados, de cualquier métrica; descarta lo mal formado. */
export function allWatches(content: unknown): Watch[] {
  const list = (content as { watches?: unknown } | null)?.watches;
  if (!Array.isArray(list)) return [];
  return list.filter((w): w is Watch => !!w && typeof w.id === 'string' && w.id !== '');
}

/** Rótulo para la lista: el del back; si falta, símbolo + condición + umbral. */
export function watchText(w: Watch): string {
  if (typeof w.label === 'string' && w.label.trim()) return w.label.trim();
  const ok = typeof w.threshold === 'number' && Number.isFinite(w.threshold) && (w.condition === 'above' || w.condition === 'below');
  return [w.symbol, ok ? watchLabel(w) : ''].filter(Boolean).join(' ') || w.id;
}

export function watchLabel(w: Watch): string {
  const n = w.threshold.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  return `${w.condition === 'above' ? '≥' : '≤'} ${n}`;
}

function parse(item: SpaceItem | undefined): Record<string, any> {
  try { return item ? JSON.parse(item.content) ?? {} : {}; } catch { return {}; }
}

/** Marca un aviso como borrado: lo suma al mapa `unwatch` de la pieza (el back lo saca en su próxima pasada). */
export async function removeWatch(ruleId: string): Promise<void> {
  const { items } = await fetchSpace();
  const item = items.find(i => i.kind === 'agent' && i.key === 'supervisor');
  if (!item) return;
  const content = parse(item);
  content.unwatch = { ...(content.unwatch ?? {}), [ruleId]: { at: new Date().toISOString() } };
  await saveSpaceItem('agent', 'supervisor', {
    title: item.title, content: JSON.stringify(content), format: item.format, visibility: item.visibility,
  });
}

/** Avisos de precio del símbolo, refrescados cada 60 s; si falla, no hay líneas. `remove` los oculta al instante. */
export function useWatches(symbol: string | null | undefined): { watches: Watch[]; remove: (id: string) => void } {
  const [all, setAll] = useState<Watch[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!symbol) { setAll([]); return; }
    let alive = true;
    const load = async () => {
      try {
        const { items } = await fetchSpace();
        const it = items.find(i => i.kind === 'agent' && i.key === 'supervisor');
        if (alive) setAll(priceWatchesFor(parse(it), symbol));
      } catch { if (alive) setAll([]); }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, [symbol]);
  const remove = useCallback((id: string) => {
    setRemoved(prev => new Set(prev).add(id));
    removeWatch(id).catch(() => setRemoved(prev => { const n = new Set(prev); n.delete(id); return n; }));
  }, []);
  return { watches: all.filter(w => !removed.has(w.id)), remove };
}
