import React, { useEffect, useRef, useState } from 'react';
import { X, ChevronDown, ChevronRight, ArrowRightLeft, Pencil, Trash2, MoreHorizontal } from 'lucide-react';
import { TickerState } from '../../types/market';
import { calcChange, fmtPct, fmtPrice, fmtTime, isStale } from '../../utils/formatters';
import { PremarketQuote } from '../../api/marketdata';
import { PremarketCell } from './PremarketCell';
import { WATCHLIST_COLUMNS, WatchlistColumn } from './watchlistColumns';

interface Props {
  tickers: TickerState[];
  showPremarket?: boolean;
  /** Columnas que el usuario ocultó (menú «⋯» del panel). */
  hiddenColumns?: WatchlistColumn[];
  premarket?: Record<string, PremarketQuote>;
  premarketLoading?: boolean;
  premarketError?: boolean;
  sections?: {label:string; symbols:string[]}[];
  selectedSymbol: string | null;
  onSelect: (symbol: string | null) => void;
  removableSymbols?: string[];
  onRemoveSymbol?: (symbol: string) => void;
  /** Grupos editables (watchlist guardada): mover tickers, renombrar y borrar grupos. */
  groupActions?: { onMove: (symbol: string, group: string, target?: string, after?: boolean) => void; onMoveGroup?: (name: string, target: string, after: boolean) => void; onRename: (from: string, to: string) => void; onDelete: (name: string) => void };
}

/** Logo del instrumento, como en TradingView (owner 17/10); si la imagen no está, la inicial. */
function TickerLogo({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="watchlist-ticker-icon" aria-hidden="true">{failed ? symbol.slice(0, 1)
    : <img src={'https://financialmodelingprep.com/image-stock/' + encodeURIComponent(symbol.split(/[ /]/)[0]) + '.png'} alt="" draggable={false} loading="lazy" onError={() => setFailed(true)}/>}</span>;
}

interface RowContext {
  onSelect: Props['onSelect']; onRemoveSymbol?: Props['onRemoveSymbol']; groupActions?: Props['groupActions'];
  setMoving: React.Dispatch<React.SetStateAction<string | null>>;
  startDrag: (e:React.DragEvent, kind:'ticker' | 'group', name:string) => void; endDrag: () => void;
  drop: (group:string, symbol?:string) => React.HTMLAttributes<HTMLTableRowElement>;
}

interface RowProps {
  ticker: TickerState; ctx: React.MutableRefObject<RowContext>; stale: boolean; selected: boolean; removable: boolean;
  editable: boolean; group?: string; namesKey: string; moving: boolean; dropClass: string; showPremarket: boolean;
  columnCount: number; showLast: boolean; showChg: boolean; showChgPct: boolean; premarket?: PremarketQuote; premarketLoading?: boolean; premarketError?: boolean;
}

/** Una fila; se re-dibuja sólo si cambia su ticker, su vigencia o su estado de edición. */
const WatchlistRow = React.memo(function WatchlistRow({ ticker, ctx, stale, selected, removable, editable, group, namesKey, moving, dropClass, showPremarket, columnCount, showLast, showChg, showChgPct, premarket, premarketLoading, premarketError }: RowProps) {
  // Los callbacks se leen del ref al ocurrir el evento: la fila puede no re-dibujarse entre renders.
  const c = () => ctx.current;
  const dropHandlers = (group:string, symbol:string): React.HTMLAttributes<HTMLTableRowElement> => ({
    onDragOver: e => c().drop(group, symbol).onDragOver?.(e as React.DragEvent<HTMLTableRowElement>),
    onDragLeave: e => c().drop(group, symbol).onDragLeave?.(e as React.DragEvent<HTMLTableRowElement>),
    onDrop: e => c().drop(group, symbol).onDrop?.(e as React.DragEvent<HTMLTableRowElement>),
  });
  const names: string[] = JSON.parse(namesKey);
  const hasPrice = Number.isFinite(ticker.price) && ticker.price > 0;
  const hasClose = ticker.prevClose != null && Number.isFinite(ticker.prevClose) && ticker.prevClose > 0;
  const change = hasPrice && !ticker.error.price && hasClose ? calcChange(ticker.price, ticker.prevClose!) : null;
  const color = change == null || change.abs === 0 ? 'var(--text-secondary)'
    : change.abs > 0 ? 'var(--green)' : 'var(--red-gc)';
  return (
    <React.Fragment>
    <tr className={(selected ? 'selected' : '') + dropClass} draggable={editable || undefined}
      onClick={e => { if (!(e.target as HTMLElement).closest('button')) c().onSelect(ticker.symbol); }}   // el precio y la variación también abren el símbolo
      onDragStart={editable ? e => c().startDrag(e, 'ticker', ticker.symbol) : undefined} onDragEnd={() => c().endDrag()}
      {...(editable && group ? dropHandlers(group, ticker.symbol) : {})}
      title={ticker.lastUpdate ? 'Recepción ' + fmtTime(ticker.lastUpdate) + ' ET' + (stale ? ' · lectura anterior' : '') : 'Sin fecha de recepción'}>
      <th scope="row">
        <button className="watchlist-symbol" aria-label={ticker.symbol} aria-pressed={selected}
          onClick={() => c().onSelect(selected ? null : ticker.symbol)}><TickerLogo symbol={ticker.symbol}/>{ticker.symbol}</button>
        {hasPrice && ticker.error.price && <span className="watchlist-price-error" role="status" title={ticker.error.price}>Lectura anterior</span>}
      </th>
      {showLast && <td className="numeric tabular-nums" title={ticker.error.price || undefined}>
        {hasPrice ? fmtPrice(ticker.price) : ticker.error.price ? 'Sin datos' : ticker.loading.price ? 'Cargando…' : '—'}
      </td>}
      {showChg && <td className="numeric tabular-nums" style={{ color }} title={hasClose ? 'Contra cierre previo' : 'Sin cierre previo: no se calcula la variación'}>
        {change ? (change.abs > 0 ? '+' : '') + fmtPrice(change.abs) : '—'}
      </td>}
      {showChgPct && <td className="numeric tabular-nums" style={{ color }}>{change ? fmtPct(change.pct) : '—'}</td>}
      {showPremarket && <PremarketCell quote={premarket} loading={premarketLoading} error={premarketError} />}
      <td className="numeric tabular-nums watchlist-received"
        style={{ color: stale ? 'var(--yellow-gc)' : undefined }}
        title="Hora de recepción en el monitor; no acredita la hora de origen del precio">
        {ticker.lastUpdate ? fmtTime(ticker.lastUpdate) : '—'}
      </td>
      <td className="watchlist-action">
        {editable && names.length > 1 && <button className="watchlist-remove" aria-label={'Mover ' + ticker.symbol + ' a otro grupo'} aria-expanded={moving}
          onClick={() => c().setMoving(m => m === ticker.symbol ? null : ticker.symbol)}><ArrowRightLeft size={15} /></button>}
        {removable && <button className="watchlist-remove" aria-label={'Quitar ' + ticker.symbol + ' del seguimiento'}
          onClick={() => c().onRemoveSymbol?.(ticker.symbol)}><X size={16} /></button>}
      </td>
    </tr>
    {moving && editable && <tr className="watchlist-move"><td colSpan={columnCount}>
      <span>Mover a</span>{names.filter(n => n !== group).map(n => <button key={n} onClick={() => { c().groupActions?.onMove(ticker.symbol, n); c().setMoving(null); }}>{n}</button>)}
    </td></tr>}
    </React.Fragment>
  );
});

/** Menú «⋯» del encabezado del panel: qué columnas se ven. */
export function ColumnsMenu({ hidden, onToggle }: { hidden: WatchlistColumn[]; onToggle: (id: WatchlistColumn) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return <div className="watchlist-columns" ref={ref}>
    <button className="lw-close" data-close aria-label="Columnas" aria-expanded={open} title="Columnas" onClick={() => setOpen(v => !v)}><MoreHorizontal size={20}/></button>
    {open && <div className="watchlist-columns-menu" role="group" aria-label="Columnas visibles">
      {WATCHLIST_COLUMNS.map(c => <label key={c.id}><input type="checkbox" checked={!hidden.includes(c.id)} onChange={() => onToggle(c.id)}/>{c.label}</label>)}
    </div>}
  </div>;
}

/** Presentación compacta del mismo store de las tarjetas; no consulta ni suscribe datos. */
export function TickerWatchlist({ tickers, showPremarket = true, hiddenColumns = [], premarket, premarketLoading, premarketError, selectedSymbol, onSelect, removableSymbols, onRemoveSymbol, sections, groupActions }: Props) {
  const show = (id: WatchlistColumn) => !hiddenColumns.includes(id);
  const columnCount = 3 + (['last', 'chg', 'chgPct'] as WatchlistColumn[]).filter(show).length + (showPremarket ? 1 : 0);
  const [collapsed,setCollapsed] = useState<string[]>([]);
  const [moving,setMoving] = useState<string | null>(null);
  const [renaming,setRenaming] = useState<string | null>(null);
  const dragged = useRef<{kind:'ticker' | 'group'; name:string} | null>(null);
  const [dropOn,setDropOn] = useState<{key:string; after:boolean} | null>(null);
  const names = sections?.map(s => s.label) ?? [];
  const groupOf = (symbol:string) => sections?.find(s => s.symbols.includes(symbol))?.label;
  const endDrag = () => { dragged.current = null; setDropOn(null); };
  const startDrag = (e:React.DragEvent, kind:'ticker' | 'group', name:string) => {
    if ((e.target as HTMLElement).closest('input, .watchlist-group-tools')) { e.preventDefault(); return; }
    dragged.current = {kind,name};
    e.dataTransfer.setData(kind === 'ticker' ? 'text/x-ticker' : 'text/x-watchlist-group', name);
    e.dataTransfer.effectAllowed = 'move';
  };
  const position = (e:React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY >= rect.top + rect.height / 2;
  };
  const dropClass = (key:string) => dropOn?.key === key ? (dropOn.after ? ' watchlist-drop-after' : ' watchlist-drop-before') : '';
  const drop = (group:string, symbol?:string) => ({
    onDragOver: (e:React.DragEvent) => {
      if (!groupActions || !dragged.current || (dragged.current.kind === 'group' && (!groupActions.onMoveGroup || symbol))) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      setDropOn({key:symbol ? 'ticker:' + symbol : 'group:' + group, after:!symbol && dragged.current.kind === 'ticker' ? true : position(e)});
    },
    onDragLeave: (e:React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn(null); },
    onDrop: (e:React.DragEvent) => {
      const source = dragged.current;
      if (!groupActions || !source || (source.kind === 'group' && symbol)) return;
      e.preventDefault(); e.stopPropagation();
      if (source.kind === 'group') groupActions.onMoveGroup?.(source.name, group, position(e));
      else groupActions.onMove(source.name, group, symbol ?? sections?.find(s => s.label === group)?.symbols[0], symbol ? position(e) : false);
      endDrag();
    },
  });
  // Lo que la fila necesita del render vigente; por ref, para que la fila memoizada no dependa de
  // la identidad de los callbacks y un Quote de un símbolo no re-dibuje todas las filas (WS-0070).
  const ctx = useRef<RowContext>({ onSelect, onRemoveSymbol, groupActions, setMoving, startDrag, endDrag, drop });
  ctx.current = { onSelect, onRemoveSymbol, groupActions, setMoving, startDrag, endDrag, drop };
  const namesKey = JSON.stringify(names);
  const renderTicker = (ticker:TickerState) => <WatchlistRow key={ticker.symbol} ticker={ticker} ctx={ctx}
    stale={!!ticker.lastUpdate && isStale(ticker.lastUpdate)} selected={selectedSymbol === ticker.symbol}
    removable={!!(removableSymbols?.includes(ticker.symbol) && onRemoveSymbol)} editable={!!groupActions}
    group={groupOf(ticker.symbol)} namesKey={namesKey} moving={moving === ticker.symbol} dropClass={dropClass('ticker:' + ticker.symbol)}
    showPremarket={showPremarket} columnCount={columnCount} showLast={show('last')} showChg={show('chg')} showChgPct={show('chgPct')} premarket={premarket?.[ticker.symbol]} premarketLoading={premarketLoading} premarketError={premarketError} />;
  const header = (label:string) => {
    const open = !collapsed.includes(label);
    const toggle = <button aria-expanded={open} onClick={() => setCollapsed(v => v.includes(label) ? v.filter(s => s !== label) : [...v,label])}>{open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}{label}</button>;
    if (!groupActions) return <tr className="watchlist-group"><td colSpan={columnCount}>{toggle}</td></tr>;
    return <tr className={'watchlist-group' + dropClass('group:' + label)} {...drop(label)}
      draggable={!!groupActions.onMoveGroup && renaming !== label} onDragStart={e => startDrag(e, 'group', label)} onDragEnd={endDrag}
      title="Arrastrá el encabezado para ordenar los grupos"><td colSpan={columnCount}>
      {renaming === label
        ? <input className="watchlist-rename" aria-label={'Nombre del grupo ' + label} defaultValue={label} autoFocus
            onBlur={e => { groupActions.onRename(label, e.target.value); setRenaming(null); }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); } }} />
        : <div className="watchlist-group-row">{toggle}
            <span className="watchlist-group-tools">
              <button aria-label={'Renombrar grupo ' + label} onClick={() => setRenaming(label)}><Pencil size={13}/></button>
              {names.length > 1 && <button aria-label={'Borrar grupo ' + label} title="Sus tickers pasan al primer grupo" onClick={() => groupActions.onDelete(label)}><Trash2 size={13}/></button>}
            </span></div>}
    </td></tr>;
  };
  return (
    <div className="ticker-watchlist">
      <table aria-label="Seguimiento de instrumentos">
        <thead><tr>
          <th scope="col">Symbol</th>
          {show('last') && <th scope="col" className="numeric">Last</th>}
          {show('chg') && <th scope="col" className="numeric">Chg</th>}
          {show('chgPct') && <th scope="col" className="numeric">Chg%</th>}
          {showPremarket && <th scope="col" className="numeric" title="Variación premarket contra el cierre regular anterior">Premarket</th>}
          <th scope="col" className="numeric watchlist-received">Recepción (ET)</th>
          <th scope="col"><span className="sr-only">Acciones</span></th>
        </tr></thead>
        <tbody>{sections ? sections.map(section => <React.Fragment key={section.label}>{header(section.label)}{!collapsed.includes(section.label) && section.symbols.map(symbol => tickers.find(t => t.symbol === symbol)).filter((t): t is TickerState => !!t).map(renderTicker)}{groupActions && !section.symbols.length && <tr className={'watchlist-empty' + dropClass('group:' + section.label)} {...drop(section.label)}><td colSpan={columnCount}>Vacío · arrastrá un ticker acá o agregalo con el buscador</td></tr>}</React.Fragment>) : tickers.map(renderTicker)}</tbody>
      </table>
      <details className="watchlist-note"><summary>Datos</summary>GaleCore · Cambio contra cierre previo · La hora indica recepción, no origen del precio regular (ET). Premarket usa hora de origen y cierre regular fechado; sin dato no equivale a 0%.</details>
    </div>
  );
}
