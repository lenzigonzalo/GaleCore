import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { searchSymbols } from '../../api/marketdata';
import { useGexStore } from '../../store/useGexStore';
import type { SymbolSearchResult } from '../../types/api';
import type { Tab } from './TabNav';

const SECTIONS: Array<[Tab, string]> = [['inicio', 'Main'], ['gex', 'Mercado'], ['monitor', 'Cartera'],
  ['estrategias', 'Estrategias'], ['lab', 'Lab'], ['agentes', 'Agentes'], ['inteligencia', 'Biblioteca'], ['config', 'Configuración']];

/** Busca sólo colecciones existentes: destinos locales y símbolos de GaleCore. */
export function WorkspaceSearch({ onNavigate, onSymbol }: { onNavigate: (tab: Tab) => void; onSymbol: (symbol: string) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const id = ++request.current;
    setResults([]); setError(null); setLoading(false);
    if (!open || !query.trim()) return;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const store = useGexStore.getState();
        if (!store.rules) await store.loadRules();
        const config = useGexStore.getState();
        if (config.rulesError) throw new Error('No se pudo leer la configuración de búsqueda.');
        if (!config.adHocSearch?.enabled || query.trim().length < (config.adHocSearch.min_query_length ?? 1)) {
          if (alive && id === request.current) setLoading(false);
          return;
        }
        const items = await searchSymbols(query.trim(), config.adHocSearch.allowed_instrument_types);
        if (alive && id === request.current) setResults(items.slice(0, config.adHocSearch.max_results ?? 8));
      } catch { if (alive && id === request.current) setError('No se pudieron buscar símbolos.'); }
      finally { if (alive && id === request.current) setLoading(false); }
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, open]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const sections = SECTIONS.filter(([, label]) => label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="workspace-search" ref={wrap}>
    <Search size={17} />
    <input aria-label="Buscar símbolo o sección" placeholder="Buscar símbolo o sección" value={query}
      onFocus={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setOpen(true); }}
      onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }} />
    {open && <div className="workspace-search-results">
      {sections.map(([tab, label]) => <button key={tab} onClick={() => { onNavigate(tab); setOpen(false); setQuery(''); }}>{label}</button>)}
      {loading && <p>Buscando…</p>}{error && <p role="alert">{error}</p>}
      {results.map(r => <button key={r.symbol} onClick={async () => {
        try { await onSymbol(r.symbol); setOpen(false); setQuery(''); }
        catch (e) { setError(e instanceof Error ? e.message : 'No se pudo abrir el símbolo.'); }
      }}><strong>{r.symbol}</strong><span>{r.description}</span></button>)}
      {!loading && !error && query.trim() && !sections.length && !results.length && <p>Sin resultados</p>}
    </div>}
  </div>;
}
