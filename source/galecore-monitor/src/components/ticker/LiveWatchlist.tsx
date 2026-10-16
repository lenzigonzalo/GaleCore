import React, { useEffect, useRef, useState } from 'react';
import { X, RotateCcw, Bookmark, Plus, RefreshCw, CalendarDays, Bell, FolderPlus } from 'lucide-react';
import { SupervisorAlerts, useStrikeAlerts } from '../layout/SupervisorAlerts';
import { CalendarDock } from '../macro/CalendarDock';
import { TickerGrid } from './TickerGrid';
import { WatchlistSearch } from './WatchlistSearch';
import { fetchSpace, saveSpaceItem } from '../../api/space';
import { Watchlist, WATCHLIST_KEY, parseWatchlist, resolveWatchlist, addSymbol, removeSymbol, restoreSymbol, moveSymbol, createGroup, renameGroup, deleteGroup } from './watchlistPrefs';
import { useGexStore } from '../../store/useGexStore';
import { useAppConfigStore } from '../../store/useAppConfigStore';
import type { ConnectionStatus } from '../../socket/useMarketSocket';
import './LiveWatchlist.css';
import { AccountMenu } from '../layout/AccountMenu';

const CACHE = 'galecore.watchlist';
const readCache = (): Watchlist | null => { try { return parseWatchlist(JSON.parse(localStorage.getItem(CACHE) || 'null')); } catch { return null; } };

/** Watchlist de la cuenta (preferencia `watchlist`): grupos, agregados y quitados sobreviven a recargar. Quitar un
 *  ticker de la plataforma no toca su universo: sólo lo saca de esta lista. */
export function LiveWatchlist({ open, enabled, onClose, onToggle, onSelect, socketStatus, subscribeSymbol, unsubscribeSymbol, onOpenSettings, onLogout, accountActive, width = 420, onWidthChange }: {
  open:boolean; enabled:boolean; onClose:()=>void; onToggle?:()=>void; onSelect:()=>void; socketStatus:ConnectionStatus;
  subscribeSymbol:(symbol:string)=>void; unsubscribeSymbol:(symbol:string)=>void;
  onOpenSettings?:()=>void; onLogout?:()=>void; accountActive?:boolean;
  width?:number; onWidthChange?:(width:number)=>void;
}) {
  const { tickers, rules, rulesLoading, rulesError, loadRules, adHocSearch, adHocSymbols, pinAdHoc, unpinAdHoc, selectedSymbol, setSelectedSymbol } = useGexStore();
  const { tickers: platformTickers, loading: platformLoading, error: platformError } = useAppConfigStore();
  const [saved,setSaved] = useState<Watchlist | null>(readCache);
  const [storageError,setStorageError] = useState(false);
  const changed = useRef(false);
  const [searchOpen,setSearchOpen] = useState(false);
  const [message,setMessage] = useState('');
  const [refreshKey,setRefreshKey] = useState(0);
  const [panelMode, setPanelMode] = useState<'watchlist' | 'calendar' | 'alerts'>('watchlist');
  const calendarMode = panelMode === 'calendar';
  const alertsMode = panelMode === 'alerts';
  const togglePanel = (next: typeof panelMode) => { setPanelMode(next); if (!open || panelMode === next) (onToggle ?? onClose)(); };
  const openRef = useRef(open);
  openRef.current = open;
  // El aviso del strike pide decidir ya: suena y abre la campana, esté donde esté el usuario.
  const { alerts: strike, notice: strikeNotice } = useStrikeAlerts(enabled, () => { setPanelMode('alerts'); if (!openRef.current) (onToggle ?? onClose)(); });
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{x:number; width:number} | null>(null);
  const resize = (next:number) => onWidthChange?.(Math.max(360, Math.min(720, next)));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => { if (enabled && open && panelMode === 'watchlist' && !rules && !rulesError) loadRules(); },[enabled,open,panelMode,rules,rulesError,loadRules]);
  const baseSymbols = Array.from(new Set([...platformTickers,...tickers,...adHocSymbols]));
  const list = resolveWatchlist(saved, baseSymbols);
  const symbols = Array.from(new Set(list.groups.flatMap(g => g.symbols)));
  const edit = (change:(old:Watchlist)=>Watchlist) => { changed.current = true; setSaved(change(list)); };
  // Lo guardado en la cuenta manda; hasta que llega se muestra la copia local. Sólo se escribe lo que el usuario cambió.
  // Se lee al abrir el panel (ya con sesión) hasta lograrlo; antes de leer la cuenta no se escribe, para no pisarla.
  const [accountRead,setAccountRead] = useState(false);
  useEffect(() => {
    if (!enabled || !open || accountRead) return;
    let alive = true;
    fetchSpace().then(({ items }) => {
      if (!alive) return;
      const item = items.find(i => i.kind === 'preference' && i.key === WATCHLIST_KEY && i.isOwn);
      if (item && !changed.current) { try { const parsed = parseWatchlist(JSON.parse(item.content)); if (parsed) setSaved(parsed); } catch { /* ilegible: queda la local */ } }
      setAccountRead(true);
    }).catch(() => undefined);
    return () => { alive = false; };
  },[enabled,open,accountRead]);
  useEffect(() => {
    if (!saved || !changed.current || !accountRead) return;
    try { localStorage.setItem(CACHE, JSON.stringify(saved)); } catch { /* sólo caché */ }
    const timer = setTimeout(() => {
      saveSpaceItem('preference', WATCHLIST_KEY, { title: 'Watchlist', content: JSON.stringify(saved), format: 'json', visibility: 'private' })
        .then(() => setStorageError(false)).catch(() => setStorageError(true));
    }, 600);
    return () => clearTimeout(timer);
  },[saved,accountRead]);
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
  const pick = (symbol:string, group:string) => {
    const normalized=symbol.trim().toUpperCase();
    if (!normalized) return;
    // La lista de cotizaciones no limita su tamaño por max_pinned del barrido GEX.
    edit(old => addSymbol(old, normalized, group)); setMessage('');
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
      <button aria-label="Abrir avisos" aria-expanded={open && alertsMode} aria-controls="lw-panel" className={open && alertsMode ? 'active' : ''} onClick={() => togglePanel('alerts')}><Bell size={23}/>{(strike.length > 0 || strikeNotice) && <i className="lw-badge" aria-label={`${strike.length} cerca del strike`} />}</button>
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
      <header><h2 id="lw-title">{alertsMode ? 'Avisos' : calendarMode ? 'Calendario' : 'Watchlist'}</h2><div>{panelMode === 'watchlist' && <><button className="lw-close" aria-label="Actualizar cotizaciones" title="Actualizar cotizaciones" onClick={() => setRefreshKey(v => v + 1)}><RefreshCw size={18}/></button><button className="lw-close" aria-label="Agregar símbolo a la watchlist" aria-expanded={searchOpen} onClick={() => setSearchOpen(v => !v)}><Plus size={21}/></button></>}<button className="lw-close" data-close aria-label={alertsMode ? 'Cerrar avisos' : calendarMode ? 'Cerrar calendario' : 'Cerrar panel de watchlist'} onClick={onClose}><X size={21}/></button></div></header>
      <div className="lw-content">
        {enabled && open && calendarMode && <CalendarDock />}
        {enabled && alertsMode && <SupervisorAlerts embedded strike={strike} strikeNotice={strikeNotice} />}
        {enabled && panelMode === 'watchlist' && <>
          {searchOpen && <WatchlistSearch groups={list.groups.map(g => g.name)} onPick={pick} onClose={() => setSearchOpen(false)}
            minQueryLength={adHocSearch?.min_query_length} maxResults={adHocSearch?.max_results} instrumentTypes={adHocSearch?.allowed_instrument_types} />}
          {storageError && <p role="status" className="lw-warn">No se pudo guardar en la cuenta; queda en este navegador y se reintenta con el próximo cambio.</p>}
          {message && <p role="status">{message}</p>}
          <TickerGrid layout="list" active={open && enabled} refreshKey={refreshKey} symbols={symbols} selectedSymbol={selectedSymbol}
            loading={!symbols.length && platformLoading && rulesLoading} error={!symbols.length ? platformError || rulesError : null}
            onSelect={select}
            sections={list.groups.map(g => ({label:g.name,symbols:g.symbols}))}
            removableSymbols={symbols}
            onRemoveSymbol={symbol => { edit(old => removeSymbol(old, symbol, baseSymbols)); if (adHocSymbols.includes(symbol)) unpinAdHoc(symbol); if (selectedSymbol === symbol) setSelectedSymbol(null); }}
            groupActions={{ onMove: (symbol, group) => edit(old => moveSymbol(old, symbol, group)), onRename: (from, to) => edit(old => renameGroup(old, from, to)), onDelete: name => edit(old => deleteGroup(old, name)) }}
          />
          <button className="lw-new-group" onClick={() => edit(old => createGroup(old))}><FolderPlus size={15}/>Nuevo grupo</button>
          {list.hidden.length > 0 && <div className="lw-hidden"><span>Quitados de esta lista</span>{list.hidden.map(s => <button key={s} onClick={() => edit(old => restoreSymbol(old, s))}><RotateCcw size={14}/>{s}</button>)}</div>}
          {rulesError && <button className="btn" onClick={loadRules}>Reintentar lectura</button>}
        </>}
      </div>

    </aside>
  </>;
}
