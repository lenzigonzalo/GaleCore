import React from 'react';
import { useAccountStore } from '../../store/useAccountStore';
import { groupPositions, fmtPnl } from '../../utils/formatters';

export function AccountPositionsList() {
  const { positions, loadingPositions } = useAccountStore();

  if (loadingPositions) {
    return (
      <div className="space-y-1 mt-1">
        {[...Array(2)].map((_, i) => (
          <div
            key={i}
            className="h-10 rounded animate-pulse"
            style={{ backgroundColor: 'var(--bg-tertiary)' }}
          />
        ))}
      </div>
    );
  }

  if (!positions.length) {
    return (
      <div className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>
        Sin posiciones abiertas
      </div>
    );
  }

  const groups     = groupPositions(positions);
  const totalPnl   = groups.reduce((s, g) => s + g.unrealizedPnl, 0);
  const totalReal  = groups.reduce((s, g) => s + g.realizedToday, 0);
  const totalLegs  = positions.length;

  return (
    <div>
      {/* Header */}
      <div
        className="flex items-center justify-between mb-2"
        style={{ borderTop: '1px solid var(--border-dark)', paddingTop: 10, marginTop: 6 }}
      >
        <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>
          Positions
        </span>
        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          {groups.length} sym · {totalLegs} leg{totalLegs !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Groups */}
      <div className="space-y-1">
        {groups.map((g) => (
          <div
            key={g.underlyingSymbol}
            className="rounded px-2 py-1.5"
            style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-dark)' }}
          >
            {/* Symbol + type + legs */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                {g.underlyingSymbol}
              </span>
              <span className="text-xs font-mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {g.typeLabel} · {g.legCount}L
              </span>
            </div>
            {/* P&L */}
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                P&L
              </span>
              <span
                className="text-xs font-mono"
                style={{ color: g.unrealizedPnl >= 0 ? 'var(--green-gc)' : 'var(--red-gc)' }}
              >
                {fmtPnl(g.unrealizedPnl)}
              </span>
            </div>
            {/* Realized today — only if non-zero */}
            {g.realizedToday !== 0 && (
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Real. hoy
                </span>
                <span
                  className="text-xs font-mono"
                  style={{ color: g.realizedToday >= 0 ? 'var(--green-gc)' : 'var(--red-gc)' }}
                >
                  {fmtPnl(g.realizedToday)}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Net totals */}
      <div
        className="mt-2 pt-2 space-y-1"
        style={{ borderTop: '1px solid var(--border-dark)' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            Net P&L
          </span>
          <span
            className="text-xs font-mono font-semibold"
            style={{ color: totalPnl >= 0 ? 'var(--green-gc)' : 'var(--red-gc)' }}
          >
            {fmtPnl(totalPnl)}
          </span>
        </div>
        {totalReal !== 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Real. hoy total
            </span>
            <span
              className="text-xs font-mono"
              style={{ color: totalReal >= 0 ? 'var(--green-gc)' : 'var(--red-gc)' }}
            >
              {fmtPnl(totalReal)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
