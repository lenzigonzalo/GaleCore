import React, { useEffect, useRef, useState } from 'react';
import { X, RotateCcw, Bookmark, Plus, RefreshCw, CalendarDays, Bell } from 'lucide-react';
import { SupervisorAlerts } from '../layout/SupervisorAlerts';
import { CalendarDock } from '../macro/CalendarDock';
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
  const { tickers: platformTickers, loading: platformLoading, error: platformError } = useAppConfigStore();
  const [hidden,setHidden] = useState<string[]>([]);
  const [added,setAdded] = useState<string[]>([]);
  const [searchOpen,setSearchOpen] = useState(false);
  const [message,setMessage] = useState('');
  const [refreshKey,setRefreshKey] = useState(0);
  const [panelMode, setPanelMode] = useState<'watchlist' | 'calendar' | 'alerts'>('watchlist');
  const calendarMode = panelMode === 'calendar';
  const alertsMode = panelMode === 'alerts';
  const togglePanel = (next: typeof panelMode) => { setPanelMode(next); if (!open || panelMode === next) (onToggle ?? onClose)(); };
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{x:number; width:number} | null>(null);
  const resize = (next:number) => onWidthChange?.(Math.max(360, Math.min(720, next)));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => { if (enabled && open && panelMode === 'watchlist' && !rules && !rulesError) loadRules(); },[enabled,open,panelMode,rules,rulesError,loadRules]);
  const baseSymbols = Array.from(new Set([...platformTickers,...tickers]));
  const symbols = Array.from(new Set([...baseSymbols,...added,...adHocSymbols])).filter(s => !hidden.includes(s));
  const extrasKey = symbols.filter(s => !platformTickers.includes(s)).join(',');
  // Un único dueño de suscripciones extra: Gex usa externalWatchlist en este recorrido.
  useEffect(() => {
    if (!enabled || !open || panelMode !== 'watchlist' || socketStatus !== 'connected') return;
    const extras = extrasKey ? extrasKey.split(',') : [];
    extras.forEach(symbol => subscribeSymbol(symbol));
    return () => extras.forEach(symbol => unsubscribeSymbol(symbol));
  },[enabled,open,panelMode,socketStatus,extrasKey,subscribeSymbol,unsubscribeSymbol]);
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
    if (!baseSymbols.includes(normalized)) setAdded(v => v.includes(normalized) ? v : [...v,normalized]);
    setHidden(v => v.filter(s => s !== normalized)); setMessage(''); setSearchOpen(false);
  };
  const select = (symbol:string|null) => {
    if (!symbol) return;
    if (!tickers.includes(symbol) && !adHocSearch?.enabled) {setMessage('La búsqueda GEX no está habilitada para este símbolo.');return;}
    const pinned=pinAdHoc(symbol);
    if (pinned) {setSelectedSymbol(pinned);setMessage('');onSelect();}
  };
  return <>
    {enabled && <nav className="lw-tools" aria-label="Paneles de mercado"><button aria-label="Abrir watchlist" aria-expanded={open && panelMode === 'watchlist'} aria-controls="lw-panel" className={open && panelMode === 'watchlist' ? "active" : ""} onClick={() => togglePanel('watchlist')}><Bookmark size={23}/></button>
      <button aria-label="Abrir calendario" aria-expanded={open && calendarMode} aria-controls="lw-panel" className={open && calendarMode ? 'active' : ''} onClick={() => togglePanel('calendar')}><CalendarDays size={23}/></button>
      <button aria-label="Abrir avisos" aria-expanded={open && alertsMode} aria-controls="lw-panel" className={open && alertsMode ? 'active' : ''} onClick={() => togglePanel('alerts')}><Bell size={23}/></button>
      {onOpenSettings&&<div className="lw-account"><AccountMenu docked onOpenSettings={onOpenSettings} onLogout={onLogout} active={accountActive}/></div>}</nav>}
    <aside id="lw-panel" ref={panel} className="lw-drawer" style={{width}} aria-labelledby="lw-title" hidden={!open || !enabled}>
      <div className="lw-resize" role="separator" tabIndex={0} aria-label={alertsMode ? 'Ancho de avisos' : calendarMode ? 'Ancho de calendario' : 'Ancho de watchlist'} aria-orientation="vertical" aria-valuemin={360} aria-valuemax={720} aria-valuenow={width}
        title="Arrastrá para ajustar el ancho · doble clic para restablecer"
        onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); drag.current={x:e.clientX,width}; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (drag.current) resize(drag.current.width + drag.current.x - e.clientX); }}
        onPointerUp={e => { drag.current=null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={() => { drag.current=null; }} onLostPointerCapture={() => { drag.current=null; }}
        onDoubleClick={() => resize(420)}
        onKeyDown={e => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault(); resize(e.key==='Home' ? 360 : e.key==='End' ? 720 : width + (e.key==='ArrowLeft' ? 20 : -20)); } }}/>
      <header><h2 id="lw-title">{alertsMode ? 'Avisos' : calendarMode ? 'Calendario' : 'Watchlist'}</h2><div>{panelMode === 'watchlist' && <><button className="lw-close" aria-label="Actualizar cotizaciones" title="Actualizar cotizaciones" onClick={() => setRefreshKey(v => v + 1)}><RefreshCw size={18}/></button>{adHocSearch?.enabled && <button className="lw-close" aria-label="Agregar símbolo a la watchlist" onClick={() => setSearchOpen(v => !v)}><Plus size={21}/></button>}</>}<button className="lw-close" data-close aria-label={alertsMode ? 'Cerrar avisos' : calendarMode ? 'Cerrar calendario' : 'Cerrar panel de watchlist'} onClick={onClose}><X size={21}/></button></div></header>
      <div className="lw-content">
        {enabled && open && calendarMode && <CalendarDock />}
        {enabled && alertsMode && <SupervisorAlerts embedded />}
        {enabled && panelMode === 'watchlist' && <>
          {adHocSearch?.enabled && searchOpen && <div className="lw-search"><SymbolSearchCard compact initialOpen minQueryLength={adHocSearch.min_query_length} maxResults={adHocSearch.max_results} instrumentTypes={adHocSearch.allowed_instrument_types} onPick={pick}/></div>}
          {message && <p role="status">{message}</p>}
          <TickerGrid layout="list" active={open && enabled} refreshKey={refreshKey} symbols={symbols} selectedSymbol={selectedSymbol}
            loading={!symbols.length && platformLoading && rulesLoading} error={!symbols.length ? platformError || rulesError : null}
            onSelect={select}
            sections={[{label:"ETF",symbols:symbols.filter(s => ["SPY","QQQ","IWM","TLT"].includes(s))},{label:"Instrumentos",symbols:symbols.filter(s => !["SPY","QQQ","IWM","TLT"].includes(s))}].filter(g => g.symbols.length > 0)}
            removableSymbols={symbols}
            onRemoveSymbol={symbol => { setAdded(v => v.filter(s => s !== symbol)); if (adHocSymbols.includes(symbol)) unpinAdHoc(symbol); if (baseSymbols.includes(symbol)) setHidden(v => [...v,symbol]); if (selectedSymbol === symbol) setSelectedSymbol(null); }}
          />
          {hidden.length > 0 && <div className="lw-hidden"><span>Quitados de esta lista</span>{hidden.map(s => <button key={s} onClick={() => setHidden(v => v.filter(x => x !== s))}><RotateCcw size={14}/>{s}</button>)}</div>}
          {rulesError && <button className="btn" onClick={loadRules}>Reintentar lectura</button>}
        </>}
      </div>

    </aside>
  </>;
}
