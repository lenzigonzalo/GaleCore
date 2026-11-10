import React, { useState } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { cssPx, cssRect } from '../../utils/appZoom';

/** Sólo cambia el espacio de la lista: no altera sus datos ni suscripciones. */
export function MarketWatchlist({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(380);
  const clamp = (value: number) => Math.max(300, Math.min(620, value));
  return <aside className={'market-watchlist-panel' + (collapsed ? ' collapsed' : '')}
    aria-label="Watchlist" style={{ width: collapsed ? 48 : width }}>
    {!collapsed && <div className="watchlist-resize" role="separator" tabIndex={0}
      aria-label="Ancho de watchlist" aria-orientation="vertical" aria-valuemin={300} aria-valuemax={620} aria-valuenow={width}
      onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth(w => clamp(w + (e.key === 'ArrowLeft' ? 20 : -20))); } }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { const right = cssRect(e.currentTarget.parentElement!).right; setWidth(clamp(right - cssPx(e.clientX))); } }}
      onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} />}
    <div className="market-watchlist-heading">
      {!collapsed && <h2>Watchlist</h2>}
      <button aria-label={collapsed ? 'Expandir watchlist' : 'Contraer watchlist'} onClick={() => setCollapsed(v => !v)}>
        {collapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
      </button>
    </div>
    <div style={{ display: collapsed ? 'none' : 'block' }}>{children}</div>
  </aside>;
}
