import React, { useState } from 'react';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import { TickerState } from '../../types/market';
import { calcChange, fmtPct, fmtPrice, fmtTime, isStale } from '../../utils/formatters';

interface Props {
  tickers: TickerState[];
  sections?: {label:string; symbols:string[]}[];
  selectedSymbol: string | null;
  onSelect: (symbol: string | null) => void;
  removableSymbols?: string[];
  onRemoveSymbol?: (symbol: string) => void;
}

/** Presentación compacta del mismo store de las tarjetas; no consulta ni suscribe datos. */
export function TickerWatchlist({ tickers, selectedSymbol, onSelect, removableSymbols, onRemoveSymbol, sections }: Props) {
  const [collapsed,setCollapsed] = useState<string[]>([]);
  const renderTicker = (ticker:TickerState) => {
          const hasPrice = Number.isFinite(ticker.price) && ticker.price > 0 && !ticker.error.price;
          const hasClose = ticker.prevClose != null && Number.isFinite(ticker.prevClose) && ticker.prevClose > 0;
          const change = hasPrice && hasClose ? calcChange(ticker.price, ticker.prevClose!) : null;
          const color = change == null || change.abs === 0 ? 'var(--text-secondary)'
            : change.abs > 0 ? 'var(--green)' : 'var(--red-gc)';
          const selected = selectedSymbol === ticker.symbol;
          const removable = removableSymbols?.includes(ticker.symbol) && onRemoveSymbol;
          return (
            <tr key={ticker.symbol} className={selected ? 'selected' : undefined} title={ticker.lastUpdate ? 'Recepción ' + fmtTime(ticker.lastUpdate) + ' ET' + (isStale(ticker.lastUpdate) ? ' · lectura anterior' : '') : 'Sin fecha de recepción'}>
              <th scope="row">
                <button className="watchlist-symbol" aria-label={ticker.symbol} aria-pressed={selected}
                  onClick={() => onSelect(selected ? null : ticker.symbol)}><span className="watchlist-ticker-icon" aria-hidden="true">{ticker.symbol.slice(0,1)}</span>{ticker.symbol}</button>
              </th>
              <td className="numeric tabular-nums" title={ticker.error.price || undefined}>
                {hasPrice ? fmtPrice(ticker.price) : ticker.error.price ? 'Sin datos' : ticker.loading.price ? 'Cargando…' : '—'}
              </td>
              <td className="numeric tabular-nums" style={{ color }} title={hasClose ? 'Contra cierre previo' : 'Sin cierre previo: no se calcula la variación'}>
                {change ? (change.abs > 0 ? '+' : '') + fmtPrice(change.abs) : '—'}
              </td>
              <td className="numeric tabular-nums" style={{ color }}>{change ? fmtPct(change.pct) : '—'}</td>
              <td className="numeric tabular-nums watchlist-received"
                style={{ color: ticker.lastUpdate && isStale(ticker.lastUpdate) ? 'var(--yellow-gc)' : undefined }}
                title="Hora de recepción en el monitor; no acredita la hora de origen del precio">
                {ticker.lastUpdate ? fmtTime(ticker.lastUpdate) : '—'}
              </td>
              <td className="watchlist-action">
                {removable && <button className="watchlist-remove" aria-label={'Quitar ' + ticker.symbol + ' del seguimiento'}
                  onClick={() => onRemoveSymbol?.(ticker.symbol)}><X size={16} /></button>}
              </td>
            </tr>
          );
  };
  return (
    <div className="ticker-watchlist">
      <table aria-label="Seguimiento de instrumentos">
        <thead><tr>
          <th scope="col">Symbol</th>
          <th scope="col" className="numeric">Last</th>
          <th scope="col" className="numeric">Chg</th>
          <th scope="col" className="numeric">Chg%</th>
          <th scope="col" className="numeric watchlist-received">Recepción (ET)</th>
          <th scope="col"><span className="sr-only">Acciones</span></th>
        </tr></thead>
        <tbody>{sections ? sections.map(section => <React.Fragment key={section.label}><tr className="watchlist-group"><td colSpan={6}><button aria-expanded={!collapsed.includes(section.label)} onClick={() => setCollapsed(v => v.includes(section.label) ? v.filter(s => s !== section.label) : [...v,section.label])}>{collapsed.includes(section.label) ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}{section.label}</button></td></tr>{!collapsed.includes(section.label) && tickers.filter(t => section.symbols.includes(t.symbol)).map(renderTicker)}</React.Fragment>) : tickers.map(renderTicker)}</tbody>
      </table>
      <details className="watchlist-note"><summary>Datos</summary>GaleCore · Cambio contra cierre previo · La hora indica recepción, no origen del precio (ET).</details>
    </div>
  );
}
