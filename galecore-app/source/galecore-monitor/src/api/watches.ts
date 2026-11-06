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
const PRICE_METRICS = ['price', 'gamma_zero', 'call_wall', 'put_wall'];

/** Avisos con unidades de precio de un símbolo; excluye bajas pendientes y reglas inactivas. */
export function priceWatchesFor(content: unknown, symbol: string): Watch[] {
  const state = content as { watches?: unknown; unwatch?: Record<string, unknown>; unwatch_errors?: Record<string, unknown> } | null;
  const list = state?.watches;
  if (!Array.isArray(list)) return [];
  const sym = symbol.trim().toUpperCase();
  return list.filter((w): w is Watch => !!w && typeof w.id === 'string' && w.id !== '' && PRICE_METRICS.includes(w.metric)
    && (w.status === undefined || w.status === 'active')
    && (!state?.unwatch?.[w.id] || !!state?.unwatch_errors?.[w.id])
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
  if (w.metric !== 'price' && typeof w.label === 'string' && w.label.trim()) return w.label.trim();
  const n = w.threshold.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const metric = { gamma_zero: 'Gamma cero', call_wall: 'Techo de calls', put_wall: 'Piso de puts' }[w.metric as 'gamma_zero' | 'call_wall' | 'put_wall'];
  return `${metric ? metric + ' ' : ''}${w.condition === 'above' ? '≥' : '≤'} ${n}`;
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

/** Niveles del símbolo, refrescados cada 60 s; si falla, no hay líneas. `remove` los oculta al instante. */
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
        if (alive) {
          const content = parse(it);
          setAll(priceWatchesFor(content, symbol));
          setRemoved(prev => new Set(Array.from(prev).filter(id => !content.unwatch_errors?.[id])));
        }
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
