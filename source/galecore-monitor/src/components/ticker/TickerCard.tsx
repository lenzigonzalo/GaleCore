import React from 'react';
import { X } from 'lucide-react';
import { TickerState } from '../../types/market';
import { fmtPrice, fmtPct, calcChange, fmtTime, isStale } from '../../utils/formatters';

interface Props {
  ticker: TickerState;
  selected: boolean;
  onClick: () => void;
  /**
   * Sacar esta card de la grilla. Solo lo traen las que no son del universo declarado: las del JSON
   * no se sacan desde la pantalla, se editan en el JSON.
   */
  onRemove?: () => void;
}

function MarketStatusBadge({ extendedTradingHours }: { extendedTradingHours: boolean | null | undefined }) {
  const isOpen = extendedTradingHours === false;
  const isClosed = extendedTradingHours === true;
  const cfg = isOpen
    ? { color: '#22c55e', bg: 'var(--green-muted)', border: 'var(--green-border)', label: 'OPEN' }
    : isClosed
    ? { color: '#f43f5e', bg: 'var(--red-muted)', border: 'var(--red-border)', label: 'CLOSED' }
    : { color: '#f59e0b', bg: 'var(--yellow-muted)', border: 'var(--yellow-border)', label: '—' };
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
      padding: '3px 8px', borderRadius: 20,
      color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.border}`,
      fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', lineHeight: 1.4,
    }}>
      {cfg.label}
    </span>
  );
}

export function TickerCard({ ticker, selected, onClick, onRemove }: Props) {
  // Use prevClose as change basis (like TradingView); fallback to open
  const basis      = ticker.prevClose && ticker.prevClose > 0 ? ticker.prevClose : ticker.open;
  const { abs: changeAbs, pct: changePct } = calcChange(ticker.price, basis);
  const positive   = changeAbs >= 0;
  const changeColor = positive ? 'var(--green)' : 'var(--red-gc)';
  const stale      = isStale(ticker.lastUpdate);
  const hasPrice   = ticker.price > 0;

  return (
    <button
      onClick={onClick}
      className="w-full text-left card-interactive"
      style={{
        backgroundColor: selected ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
        border: `1px solid ${selected ? 'var(--blue-gc)' : 'var(--border)'}`,
        boxShadow: selected ? 'var(--shadow-glow-blue)' : 'var(--shadow-sm)',
        borderRadius: 10,
        padding: '14px 16px',
        minWidth: 210,
        display: 'block',
      }}
    >
      {/* Symbol + Signal */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 15, letterSpacing: '0.05em' }}>
          {ticker.symbol}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <MarketStatusBadge extendedTradingHours={ticker.extendedTradingHours} />
          {/* Un <button> adentro de otro <button> es HTML inválido y React lo advierte: la card
              entera ya es el botón de selección, así que la × es un span con su propio handler. */}
          {onRemove && (
            <span
              role="button"
              title="Sacar de la grilla"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              style={{ display: 'inline-flex', cursor: 'pointer', color: 'var(--text-muted)' }}
            >
              <X size={12} />
            </span>
          )}
        </span>
      </div>

      {/* Price + change */}
      {hasPrice ? (
        <div style={{ marginBottom: 12 }}>
          <div className="flex items-center justify-between">
            <div className="tabular-nums" style={{
              fontSize: 30, fontWeight: 700,
              color: 'var(--text-primary)',
              fontFamily: 'JetBrains Mono, monospace',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
            }}>
              {fmtPrice(ticker.price)}
            </div>
          </div>
          <div className="tabular-nums" style={{ fontSize: 14, fontWeight: 500, color: changeColor, fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
            {positive ? '+' : ''}{fmtPrice(changeAbs, 2)}{' '}
            <span style={{ opacity: 0.85 }}>({fmtPct(changePct)})</span>
          </div>
          {/* Bid / Ask / Volume */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums" style={{ marginTop: 5, fontSize: 13, fontFamily: 'JetBrains Mono, monospace' }}>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>Bid </span>
              <span style={{ color: 'var(--blue-gc)' }}>
                {ticker.bid > 0 ? fmtPrice(ticker.bid, 2) : '—'}
              </span>
            </span>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>Ask </span>
              <span style={{ color: 'var(--red-gc)' }}>
                {ticker.ask > 0 ? fmtPrice(ticker.ask, 2) : '—'}
              </span>
            </span>
            {ticker.volume != null && ticker.volume > 0 && (
              <span style={{ marginLeft: 'auto' }}>
                <span style={{ color: 'var(--text-muted)' }}>Vol </span>
                <span style={{ color: 'var(--text-secondary)' }}>{(ticker.volume / 1e6).toFixed(1)}M</span>
              </span>
            )}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <div className="skeleton" style={{ height: 28, width: '60%', marginBottom: 4 }} />
          <div className="skeleton" style={{ height: 14, width: '38%' }} />
          <div className="skeleton" style={{ height: 12, width: '55%', marginTop: 5 }} />
        </div>
      )}

      {/* Timestamp */}
      <div style={{ textAlign: 'right', marginTop: 10, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: stale ? 'var(--yellow-gc)' : 'var(--text-muted)' }}>
        {ticker.lastUpdate ? fmtTime(ticker.lastUpdate) : 'Sin datos'}
        {!ticker.isStreaming && ticker.price > 0 && <span style={{ color: 'var(--yellow-gc)', marginLeft: 4 }}>⚠ REST</span>}
      </div>
    </button>
  );
}
