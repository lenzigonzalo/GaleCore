import React, { useState } from 'react';
import { X, ChevronDown, ChevronRight, ArrowRightLeft, Pencil, Trash2 } from 'lucide-react';
import { TickerState } from '../../types/market';
import { calcChange, fmtPct, fmtPrice, fmtTime, isStale } from '../../utils/formatters';
import { PremarketQuote } from '../../api/marketdata';
import { PremarketCell } from './PremarketCell';

interface Props {
  tickers: TickerState[];
  showPremarket?: boolean;
  premarket?: Record<string, PremarketQuote>;
  premarketLoading?: boolean;
  premarketError?: boolean;
  sections?: {label:string; symbols:string[]}[];
  selectedSymbol: string | null;
  onSelect: (symbol: string | null) => void;
  removableSymbols?: string[];
  onRemoveSymbol?: (symbol: string) => void;
  /** Grupos editables (watchlist guardada): mover tickers, renombrar y borrar grupos. */
  groupActions?: { onMove: (symbol: string, group: string) => void; onRename: (from: string, to: string) => void; onDelete: (name: string) => void };
}

/** Logo del instrumento, como en TradingView (owner 17/10); si la imagen no está, la inicial. */
function TickerLogo({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="watchlist-ticker-icon" aria-hidden="true">{failed ? symbol.slice(0, 1)
    : <img src={'https://financialmodelingprep.com/image-stock/' + encodeURIComponent(symbol.split(/[ /]/)[0]) + '.png'} alt="" loading="lazy" onError={() => setFailed(true)}/>}</span>;
}

/** Presentación compacta del mismo store de las tarjetas; no consulta ni suscribe datos. */
export function TickerWatchlist({ tickers, showPremarket = true, premarket, premarketLoading, premarketError, selectedSymbol, onSelect, removableSymbols, onRemoveSymbol, sections, groupActions }: Props) {
  const columnCount = showPremarket ? 7 : 6;
  const [collapsed,setCollapsed] = useState<string[]>([]);
  const [moving,setMoving] = useState<string | null>(null);
  const [renaming,setRenaming] = useState<string | null>(null);
  const [dropOn,setDropOn] = useState<string | null>(null);
  const names = sections?.map(s => s.label) ?? [];
  const groupOf = (symbol:string) => sections?.find(s => s.symbols.includes(symbol))?.label;
  const drop = (group:string) => ({
    onDragOver: (e:React.DragEvent) => { if (groupActions && e.dataTransfer.types.includes('text/x-ticker')) { e.preventDefault(); setDropOn(group); } },
    onDragLeave: () => setDropOn(null),
    onDrop: (e:React.DragEvent) => { const symbol = e.dataTransfer.getData('text/x-ticker'); setDropOn(null); if (symbol && groupActions && groupOf(symbol) !== group) groupActions.onMove(symbol, group); },
  });
  const renderTicker = (ticker:TickerState) => {
          const hasPrice = Number.isFinite(ticker.price) && ticker.price > 0;
          const hasClose = ticker.prevClose != null && Number.isFinite(ticker.prevClose) && ticker.prevClose > 0;
          const change = hasPrice && !ticker.error.price && hasClose ? calcChange(ticker.price, ticker.prevClose!) : null;
          const color = change == null || change.abs === 0 ? 'var(--text-secondary)'
            : change.abs > 0 ? 'var(--green)' : 'var(--red-gc)';
          const selected = selectedSymbol === ticker.symbol;
          const removable = removableSymbols?.includes(ticker.symbol) && onRemoveSymbol;
          return (
            <React.Fragment key={ticker.symbol}>
            <tr className={selected ? 'selected' : undefined} draggable={!!groupActions || undefined}
              onDragStart={groupActions ? e => { e.dataTransfer.setData('text/x-ticker', ticker.symbol); e.dataTransfer.effectAllowed = 'move'; } : undefined}
              {...(groupActions && groupOf(ticker.symbol) ? drop(groupOf(ticker.symbol)!) : {})}
              title={ticker.lastUpdate ? 'Recepción ' + fmtTime(ticker.lastUpdate) + ' ET' + (isStale(ticker.lastUpdate) ? ' · lectura anterior' : '') : 'Sin fecha de recepción'}>
              <th scope="row">
                <button className="watchlist-symbol" aria-label={ticker.symbol} aria-pressed={selected}
                  onClick={() => onSelect(selected ? null : ticker.symbol)}><TickerLogo symbol={ticker.symbol}/>{ticker.symbol}</button>
                {hasPrice && ticker.error.price && <span className="watchlist-price-error" role="status" title={ticker.error.price}>Lectura anterior</span>}
              </th>
              <td className="numeric tabular-nums" title={ticker.error.price || undefined}>
                {hasPrice ? fmtPrice(ticker.price) : ticker.error.price ? 'Sin datos' : ticker.loading.price ? 'Cargando…' : '—'}
              </td>
              <td className="numeric tabular-nums" style={{ color }} title={hasClose ? 'Contra cierre previo' : 'Sin cierre previo: no se calcula la variación'}>
                {change ? (change.abs > 0 ? '+' : '') + fmtPrice(change.abs) : '—'}
              </td>
              <td className="numeric tabular-nums" style={{ color }}>{change ? fmtPct(change.pct) : '—'}</td>
              {showPremarket && <PremarketCell quote={premarket?.[ticker.symbol]} loading={premarketLoading} error={premarketError} />}
              <td className="numeric tabular-nums watchlist-received"
                style={{ color: ticker.lastUpdate && isStale(ticker.lastUpdate) ? 'var(--yellow-gc)' : undefined }}
                title="Hora de recepción en el monitor; no acredita la hora de origen del precio">
                {ticker.lastUpdate ? fmtTime(ticker.lastUpdate) : '—'}
              </td>
              <td className="watchlist-action">
                {groupActions && names.length > 1 && <button className="watchlist-remove" aria-label={'Mover ' + ticker.symbol + ' a otro grupo'} aria-expanded={moving === ticker.symbol}
                  onClick={() => setMoving(m => m === ticker.symbol ? null : ticker.symbol)}><ArrowRightLeft size={15} /></button>}
                {removable && <button className="watchlist-remove" aria-label={'Quitar ' + ticker.symbol + ' del seguimiento'}
                  onClick={() => onRemoveSymbol?.(ticker.symbol)}><X size={16} /></button>}
              </td>
            </tr>
            {moving === ticker.symbol && groupActions && <tr className="watchlist-move"><td colSpan={columnCount}>
              <span>Mover a</span>{names.filter(n => n !== groupOf(ticker.symbol)).map(n => <button key={n} onClick={() => { groupActions.onMove(ticker.symbol, n); setMoving(null); }}>{n}</button>)}
            </td></tr>}
            </React.Fragment>
          );
  };
  const header = (label:string) => {
    const open = !collapsed.includes(label);
    const toggle = <button aria-expanded={open} onClick={() => setCollapsed(v => v.includes(label) ? v.filter(s => s !== label) : [...v,label])}>{open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}{label}</button>;
    if (!groupActions) return <tr className="watchlist-group"><td colSpan={columnCount}>{toggle}</td></tr>;
    return <tr className={'watchlist-group' + (dropOn === label ? ' drop' : '')} {...drop(label)}><td colSpan={columnCount}>
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
          <th scope="col" className="numeric">Last</th>
          <th scope="col" className="numeric">Chg</th>
          <th scope="col" className="numeric">Chg%</th>
          {showPremarket && <th scope="col" className="numeric" title="Variación premarket contra el cierre regular anterior">Premarket</th>}
          <th scope="col" className="numeric watchlist-received">Recepción (ET)</th>
          <th scope="col"><span className="sr-only">Acciones</span></th>
        </tr></thead>
        <tbody>{sections ? sections.map(section => <React.Fragment key={section.label}>{header(section.label)}{!collapsed.includes(section.label) && section.symbols.map(symbol => tickers.find(t => t.symbol === symbol)).filter((t): t is TickerState => !!t).map(renderTicker)}{groupActions && !section.symbols.length && <tr className="watchlist-empty"><td colSpan={columnCount}>Vacío · arrastrá un ticker acá o agregalo con el buscador</td></tr>}</React.Fragment>) : tickers.map(renderTicker)}</tbody>
      </table>
      <details className="watchlist-note"><summary>Datos</summary>GaleCore · Cambio contra cierre previo · La hora indica recepción, no origen del precio regular (ET). Premarket usa hora de origen y cierre regular fechado; sin dato no equivale a 0%.</details>
    </div>
  );
}
