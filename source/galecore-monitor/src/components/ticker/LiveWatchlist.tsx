import React, { useEffect, useRef, useState } from 'react';
import { X, RotateCcw, Bookmark, Plus } from 'lucide-react';
import { TickerGrid } from './TickerGrid';
import { SymbolSearchCard } from './SymbolSearchCard';
import { useGexStore } from '../../store/useGexStore';
import { useAppConfigStore } from '../../store/useAppConfigStore';
import type { ConnectionStatus } from '../../socket/useMarketSocket';
import './LiveWatchlist.css';
import { AccountMenu } from '../layout/AccountMenu';

/** Lista real del universo existente. Quitar un ticker del JSON sólo oculta su fila en esta sesión. */
export function LiveWatchlist({ open, enabled, onClose, onToggle, onSelect, socketStatus, subscribeSymbol, unsubscribeSymbol, onOpenSettings, onLogout, accountActive, width = 420, onWidthChange }: {
  open:boolean; enabled:boolean; onClose:()=>void; onToggle?:()=>void; onSelect:()=>void; socketStatus:ConnectionStatus;
  subscribeSymbol:(symbol:string)=>void; unsubscribeSymbol:(symbol:string)=>void;
  onOpenSettings?:()=>void; onLogout?:()=>void; accountActive?:boolean;
  width?:number; onWidthChange?:(width:number)=>void;
}) {
  const { tickers, rules, rulesLoading, rulesError, loadRules, adHocSearch, adHocSymbols, pinAdHoc, unpinAdHoc, selectedSymbol, setSelectedSymbol } = useGexStore();
  const platformTickers = useAppConfigStore(s => s.tickers);
  const [hidden,setHidden] = useState<string[]>([]);
  const [added,setAdded] = useState<string[]>([]);
  const [searchOpen,setSearchOpen] = useState(false);
  const [message,setMessage] = useState('');
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{x:number; width:number} | null>(null);
  const resize = (next:number) => onWidthChange?.(Math.max(360, Math.min(720, next)));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => { if (enabled && open && !rules && !rulesError) loadRules(); },[enabled,open,rules,rulesError,loadRules]);
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
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); }

    };
    document.addEventListener('keydown',keys);
    return () => { document.removeEventListener('keydown',keys); previous?.focus(); };
  },[open,enabled]);
  const pick = (symbol:string) => {
    const normalized=symbol.trim().toUpperCase();
    if (!normalized) return;
    // La lista de cotizaciones no limita su tamaño por max_pinned del barrido GEX.
    if (!tickers.includes(normalized)) setAdded(v => v.includes(normalized) ? v : [...v,normalized]);
    setHidden(v => v.filter(s => s !== normalized)); setMessage(''); setSearchOpen(false);
  };
  const select = (symbol:string|null) => {
    if (!symbol) return;
    if (!tickers.includes(symbol) && !adHocSearch?.enabled) {setMessage('La búsqueda GEX no está habilitada para este símbolo.');return;}
    const pinned=pinAdHoc(symbol);
    if (pinned) {setSelectedSymbol(pinned);setMessage('');onSelect();}
  };
  return <>
    {enabled && <nav className="lw-tools" aria-label="Paneles de mercado"><button aria-label="Abrir watchlist" aria-expanded={open} aria-controls="lw-panel" className={open ? "active" : ""} onClick={onToggle ?? onClose}><Bookmark size={23}/></button>{onOpenSettings&&<div className="lw-account"><AccountMenu docked onOpenSettings={onOpenSettings} onLogout={onLogout} active={accountActive}/></div>}</nav>}
    <aside id="lw-panel" ref={panel} className="lw-drawer" style={{width}} aria-labelledby="lw-title" hidden={!open || !enabled}>
      <div className="lw-resize" role="separator" tabIndex={0} aria-label="Ancho de watchlist" aria-orientation="vertical" aria-valuemin={360} aria-valuemax={720} aria-valuenow={width}
        title="Arrastrá para ajustar el ancho · doble clic para restablecer"
        onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); drag.current={x:e.clientX,width}; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (drag.current) resize(drag.current.width + drag.current.x - e.clientX); }}
        onPointerUp={e => { drag.current=null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={() => { drag.current=null; }} onLostPointerCapture={() => { drag.current=null; }}
        onDoubleClick={() => resize(420)}
        onKeyDown={e => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault(); resize(e.key==='Home' ? 360 : e.key==='End' ? 720 : width + (e.key==='ArrowLeft' ? 20 : -20)); } }}/>
      <header><h2 id="lw-title">Watchlist</h2><div>{adHocSearch?.enabled && <button className="lw-close" aria-label="Agregar símbolo a la watchlist" onClick={() => setSearchOpen(v => !v)}><Plus size={21}/></button>}<button className="lw-close" data-close aria-label="Cerrar panel de watchlist" onClick={onClose}><X size={21}/></button></div></header>
      <div className="lw-content">
        {enabled && <>
          {adHocSearch?.enabled && searchOpen && <div className="lw-search"><SymbolSearchCard compact initialOpen minQueryLength={adHocSearch.min_query_length} maxResults={adHocSearch.max_results} instrumentTypes={adHocSearch.allowed_instrument_types} onPick={pick}/></div>}
          {message && <p role="status">{message}</p>}
          <TickerGrid layout="list" symbols={symbols} selectedSymbol={selectedSymbol}
            loading={rulesLoading} error={rulesError}
            onSelect={select}
            sections={[{label:"ETF",symbols:symbols.filter(s => ["SPY","QQQ","IWM","TLT"].includes(s))},{label:"Instrumentos",symbols:symbols.filter(s => !["SPY","QQQ","IWM","TLT"].includes(s))}].filter(g => g.symbols.length > 0)}
            removableSymbols={symbols}
            onRemoveSymbol={symbol => { setAdded(v => v.filter(s => s !== symbol)); if (adHocSymbols.includes(symbol)) unpinAdHoc(symbol); if (tickers.includes(symbol)) setHidden(v => [...v,symbol]); if (selectedSymbol === symbol) setSelectedSymbol(null); }}
          />
          {hidden.length > 0 && <div className="lw-hidden"><span>Quitados de esta lista</span>{hidden.map(s => <button key={s} onClick={() => setHidden(v => v.filter(x => x !== s))}><RotateCcw size={14}/>{s}</button>)}</div>}
          {rulesError && <button className="btn" onClick={loadRules}>Reintentar lectura</button>}
        </>}
      </div>

    </aside>
  </>;
}
