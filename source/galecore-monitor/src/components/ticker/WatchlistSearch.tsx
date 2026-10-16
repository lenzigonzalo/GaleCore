import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { searchSymbols } from '../../api/marketdata';
import { SymbolSearchResult } from '../../types/api';

/** Buscador del panel: escribir, elegir (clic o Enter) y el ticker va al grupo elegido. */
export function WatchlistSearch({ groups, onPick, onClose, minQueryLength = 1, maxResults = 8, instrumentTypes }: {
  groups: string[]; onPick: (symbol: string, group: string) => void; onClose: () => void;
  minQueryLength?: number; maxResults?: number; instrumentTypes?: string[];
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState(groups[groups.length - 1] ?? '');
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { if (!groups.includes(group)) setGroup(groups[groups.length - 1] ?? ''); }, [groups, group]);
  useEffect(() => {
    const id = ++request.current;
    const q = query.trim();
    if (q.length < Math.max(1, minQueryLength)) { setResults([]); setState('idle'); return; }
    setState('loading');
    const timer = setTimeout(() => {
      searchSymbols(q, instrumentTypes)
        .then(items => { if (id === request.current) { setResults(items.slice(0, maxResults)); setActive(0); setState('done'); } })
        .catch(() => { if (id === request.current) { setResults([]); setState('error'); } });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, minQueryLength, maxResults, instrumentTypes?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (symbol: string) => { onPick(symbol, group); setQuery(''); setResults([]); setState('idle'); input.current?.focus(); };
  return <div className="lw-add">
    <div className="lw-add-row">
      <Search size={16} aria-hidden="true" />
      <input ref={input} value={query} placeholder="Buscar ticker…" aria-label="Buscar ticker" spellCheck={false} autoComplete="off"
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
          if (e.key === 'Enter' && results[active]) pick(results[active].symbol);
        }} />
      {groups.length > 1 && <select aria-label="Grupo donde se agrega" value={group} onChange={e => setGroup(e.target.value)}>
        {groups.map(g => <option key={g} value={g}>{g}</option>)}
      </select>}
      <button className="lw-close" aria-label="Cerrar buscador" onClick={onClose}><X size={16} /></button>
    </div>
    {state !== 'idle' && <ul className="lw-add-results" role="listbox" aria-label="Resultados">
      {state === 'loading' && <li className="lw-add-note">Buscando…</li>}
      {state === 'error' && <li className="lw-add-note">No se pudo buscar; probá de nuevo.</li>}
      {state === 'done' && !results.length && <li className="lw-add-note">Sin resultados</li>}
      {state === 'done' && results.map((r, i) => <li key={r.symbol} role="option" aria-selected={i === active}
        className={i === active ? 'active' : undefined} onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); pick(r.symbol); }}>
        <b>{r.symbol}</b><span>{r.description}</span></li>)}
    </ul>}
  </div>;
}
