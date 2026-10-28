import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { searchSymbols } from '../../api/marketdata';
import { useGexStore } from '../../store/useGexStore';
import type { SymbolSearchResult } from '../../types/api';
import type { Tab } from './TabNav';
import { DESTINATIONS } from './navigation';

const SECTIONS: Array<[Tab, string]> = [...DESTINATIONS.map(({ id, label }) => [id, label] as [Tab, string]), ['config', 'Configuración']];

/** Busca sólo colecciones existentes: destinos locales y símbolos de GaleCore. */
export function WorkspaceSearch({ onNavigate, onSymbol, expanded = false }: { onNavigate: (tab: Tab) => void; onSymbol: (symbol: string) => Promise<void>; expanded?: boolean }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(v => !v); }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, []);
  useEffect(() => { if (open) input.current?.focus(); else launcher.current?.focus(); }, [open]);
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
  return <div className={'workspace-search-launcher' + (expanded ? ' workspace-search-expanded' : '')} ref={wrap}>
    <button ref={launcher} className={expanded ? 'workspace-search-box' : 'workspace-icon-button'} aria-label="Buscar en GaleCore" title="Buscar · Ctrl K" onClick={() => setOpen(true)}><Search size={20} />{expanded && <span>Buscar ticker</span>}</button>
    {open && <div className="workspace-search-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}><section className="workspace-command" role="dialog" aria-modal="true" aria-label="Buscar en GaleCore"
      onKeyDown={e => { if (e.key !== 'Tab') return; const controls = e.currentTarget.querySelectorAll<HTMLElement>('input,button'); const first = controls[0], last = controls[controls.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }}>
    <div className="workspace-command-input"><Search size={20} /><input ref={input} aria-label="Buscar símbolo o sección" placeholder="Buscar símbolo o sección" value={query}
      onFocus={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setOpen(true); }}
      onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }} /><button aria-label="Cerrar búsqueda" onClick={() => setOpen(false)}><X size={20} /></button></div>
    <div className="workspace-search-results">
      {sections.map(([tab, label]) => <button key={tab} onClick={() => { onNavigate(tab); setOpen(false); setQuery(''); }}>{label}</button>)}
      {loading && <p>Buscando…</p>}{error && <p role="alert">{error}</p>}
      {results.map(r => <button key={r.symbol} onClick={async () => {
        try { await onSymbol(r.symbol); setOpen(false); setQuery(''); }
        catch (e) { setError(e instanceof Error ? e.message : 'No se pudo abrir el símbolo.'); }
      }}><strong>{r.symbol}</strong><span>{r.description}</span></button>)}
      {!loading && !error && query.trim() && !sections.length && !results.length && <p>Sin resultados</p>}
    </div></section></div>}
  </div>;
}
