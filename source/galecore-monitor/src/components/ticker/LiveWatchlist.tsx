import React, { useEffect, useRef, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { TickerGrid } from './TickerGrid';
import { SymbolSearchCard } from './SymbolSearchCard';
import { useGexStore } from '../../store/useGexStore';
import { useAppConfigStore } from '../../store/useAppConfigStore';
import type { ConnectionStatus } from '../../socket/useMarketSocket';
import './LiveWatchlist.css';

/** Lista real del universo existente. Quitar un ticker del JSON sólo oculta su fila en esta sesión. */
export function LiveWatchlist({ open, enabled, onClose, onSelect, socketStatus, subscribeSymbol, unsubscribeSymbol }: {
  open:boolean; enabled:boolean; onClose:()=>void; onSelect:()=>void; socketStatus:ConnectionStatus;
  subscribeSymbol:(symbol:string)=>void; unsubscribeSymbol:(symbol:string)=>void;
}) {
  const { tickers, rules, rulesLoading, rulesError, loadRules, adHocSearch, adHocSymbols, pinAdHoc, unpinAdHoc, selectedSymbol, setSelectedSymbol } = useGexStore();
  const platformTickers = useAppConfigStore(s => s.tickers);
  const [hidden,setHidden] = useState<string[]>([]);
  const [added,setAdded] = useState<string[]>([]);
  const [message,setMessage] = useState('');
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { if (enabled && !rules && !rulesError) loadRules(); },[enabled,rules,rulesError,loadRules]);
  const symbols = Array.from(new Set([...tickers,...added,...adHocSymbols])).filter(s => !hidden.includes(s));
  const extrasKey = symbols.filter(s => !platformTickers.includes(s)).join(',');
  // Un único dueño de suscripciones extra: Gex usa externalWatchlist en este recorrido.
  useEffect(() => {
    if (!enabled || socketStatus !== 'connected') return;
    const extras = extrasKey ? extrasKey.split(',') : [];
    extras.forEach(symbol => subscribeSymbol(symbol));
    return () => extras.forEach(symbol => unsubscribeSymbol(symbol));
  },[enabled,socketStatus,extrasKey,subscribeSymbol,unsubscribeSymbol]);
  useEffect(() => {
    if (!open || !enabled) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('[data-close]')?.focus();
    const keys = (e:KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"], summary') ?? []);
      const first=nodes[0], last=nodes[nodes.length-1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown',keys);
    return () => { document.removeEventListener('keydown',keys); previous?.focus(); };
  },[open,enabled,onClose]);
  const pick = (symbol:string) => {
    const normalized=symbol.trim().toUpperCase();
    if (!normalized) return;
    // La lista de cotizaciones no limita su tamaño por max_pinned del barrido GEX.
    if (!tickers.includes(normalized)) setAdded(v => v.includes(normalized) ? v : [...v,normalized]);
    setHidden(v => v.filter(s => s !== normalized)); setMessage('');
  };
  const select = (symbol:string|null) => {
    if (!symbol) return;
    if (!tickers.includes(symbol) && !adHocSearch?.enabled) {setMessage('La búsqueda GEX no está habilitada para este símbolo.');return;}
    const pinned=pinAdHoc(symbol);
    if (pinned) {setSelectedSymbol(pinned);setMessage('');onSelect();}
  };
  return <>
    {open && enabled && <button className="lw-backdrop" aria-label="Cerrar watchlist" tabIndex={-1} onClick={onClose}/>}
    <aside id="lw-panel" ref={panel} className="lw-drawer" role="dialog" aria-modal="true" aria-labelledby="lw-title" hidden={!open || !enabled}>
      <header><div><h2 id="lw-title">Watchlist</h2><span>GaleCore · cotizaciones reales · USD</span></div><button className="lw-close" data-close aria-label="Cerrar panel de watchlist" onClick={onClose}><X size={22}/></button></header>
      <div className="lw-content">
        {enabled && <>
          {adHocSearch?.enabled && <div className="lw-search"><SymbolSearchCard compact minQueryLength={adHocSearch.min_query_length} maxResults={adHocSearch.max_results} instrumentTypes={adHocSearch.allowed_instrument_types} onPick={pick}/></div>}
          {message && <p role="status">{message}</p>}
          <TickerGrid layout="list" symbols={symbols} selectedSymbol={selectedSymbol}
            loading={rulesLoading} error={rulesError}
            onSelect={select}
            removableSymbols={symbols}
            onRemoveSymbol={symbol => { setAdded(v => v.filter(s => s !== symbol)); if (adHocSymbols.includes(symbol)) unpinAdHoc(symbol); if (tickers.includes(symbol)) setHidden(v => [...v,symbol]); if (selectedSymbol === symbol) setSelectedSymbol(null); }}
          />
          {hidden.length > 0 && <div className="lw-hidden"><span>Quitados de esta lista</span>{hidden.map(s => <button key={s} onClick={() => setHidden(v => v.filter(x => x !== s))}><RotateCcw size={14}/>{s}</button>)}</div>}
          {rulesError && <button className="btn" onClick={loadRules}>Reintentar lectura</button>}
        </>}
      </div>
      <footer>Cambio contra cierre previo. Agregar y quitar modifica el seguimiento de esta sesión.</footer>
    </aside>
  </>;
}
