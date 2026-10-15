import React from 'react';
import { LiveSpread } from '../../types/position';
import { useAccountStore } from '../../store/useAccountStore';
import { useAppConfigStore } from '../../store/useAppConfigStore';
import { fmtCurrency, fmtPct } from '../../utils/formatters';
import { computeCurrentNetCredit } from '../../utils/streamerSymbol';

interface Props {
  spreads: LiveSpread[];
  onRefresh: () => void;
  refreshing: boolean;
}

export function PortfolioRiskBar({ spreads, onRefresh, refreshing }: Props) {
  const { balances } = useAccountStore();
  const { config }   = useAppConfigStore();

  const netLiq    = balances?.netLiquidatingValue ?? 0;
  const buyingPwr = balances?.buyingPower ?? 0;

  // Límites de riesgo del portafolio — nodo `monitor` del config de la app
  const maxPositions = config?.monitor?.risk_limits?.max_concurrent_positions ?? 3;
  const heatMaxPct   = config?.monitor?.risk_limits?.portfolio_heat_max_pct ?? 0.045;

  const killSwitchThreshold = config?.monitor?.trade_management?.daily_kill_switch
    ?.daily_portfolio_mtm_loss_pct_net_liq_max ?? 0.015;

  // ── Portfolio totals (sum across ALL open positions) ─────────────────────
  // Total open P&L = since entry.  Daily P&L = change vs previous close.
  const totalPnl = spreads.reduce((s, p) => s + (p.currentPnl ?? 0), 0);
  const pnlPct   = netLiq > 0 ? (totalPnl / netLiq) * 100 : 0;
  const hasAnyPnl = spreads.some(p => p.currentPnl != null);

  const dailyPnl = spreads.reduce((sum, p) => {
    if (p.currentNetCredit == null) return sum;
    const closeNet = computeCurrentNetCredit(
      p.type, p.shortPutClose ?? null, p.longPutClose ?? null, p.shortCallClose ?? null, p.longCallClose ?? null,
    );
    if (closeNet == null) return sum;
    // Short premium: P&L rises as the net cost to close falls.
    return sum + (closeNet - p.currentNetCredit) * (p.multiplier ?? 100) * p.contracts;
  }, 0);
  const dailyPct   = netLiq > 0 ? (dailyPnl / netLiq) * 100 : 0;
  const hasAnyDaily = spreads.some(p => p.currentNetCredit != null);

  // Portfolio heat = Σ max loss per spread / net liq
  // Max loss per spread = (spread_width - initialCredit) × 100 × contracts
  // Width = |shortStrike - longStrike| for each side
  const totalMaxLoss = spreads.reduce((sum, s) => {
    let width = 0;
    if (s.shortPutStrike != null && s.longPutStrike != null)
      width += Math.abs(s.shortPutStrike - s.longPutStrike);
    if (s.shortCallStrike != null && s.longCallStrike != null)
      width += Math.abs(s.longCallStrike - s.shortCallStrike);
    const maxLoss = Math.max(0, (width - s.initialCredit)) * (s.multiplier ?? 100) * s.contracts;
    return sum + maxLoss;
  }, 0);

  const heatPct = netLiq > 0 ? totalMaxLoss / netLiq : 0;

  // Kill switch is a DAILY mark-to-market loss limit → use daily P&L.
  const killSwitchActive = hasAnyDaily && netLiq > 0 && dailyPct < -(killSwitchThreshold * 100);

  const heatColor =
    heatPct >= heatMaxPct * 0.9  ? 'var(--red-gc)'    :
    heatPct >= heatMaxPct * 0.65 ? 'var(--yellow-gc)' :
    'var(--green)';

  const pnlColor = totalPnl >= 0 ? 'var(--green)' : 'var(--red-gc)';

  return (
    <div style={{ borderBottom: '1px solid var(--border-dark)' }}>
      {killSwitchActive && (
        <div
          className="px-4 py-1.5 text-xs font-bold text-center uppercase tracking-widest"
          style={{ backgroundColor: '#7f1d1d', color: '#fca5a5' }}
        >
          KILL SWITCH — pérdida diaria supera {(killSwitchThreshold * 100).toFixed(1)}% · No abrir nuevas posiciones
        </div>
      )}

      <div
        className="flex items-start gap-8 px-5 py-3 flex-wrap"
        style={{ backgroundColor: 'var(--bg-secondary)', fontFamily: 'var(--font-mono)' }}
      >
        <MetricBlock label="Valor de la cuenta" value={fmtCurrency(netLiq)} />
        <Divider />
        <MetricBlock label="Poder de compra" value={fmtCurrency(buyingPwr)} />
        <Divider />
        <MetricBlock
          label="Resultado"
          value={hasAnyPnl ? `${totalPnl >= 0 ? '+' : ''}${fmtCurrency(totalPnl)}` : '—'}
          color={hasAnyPnl ? pnlColor : 'var(--text-muted)'}
          sub={hasAnyPnl ? fmtPct(pnlPct) : undefined}
        />
        <Divider />
        <MetricBlock
          label="Resultado del día"
          value={hasAnyDaily ? `${dailyPnl >= 0 ? '+' : ''}${fmtCurrency(dailyPnl)}` : '—'}
          color={hasAnyDaily ? (dailyPnl >= 0 ? 'var(--green)' : 'var(--red-gc)') : 'var(--text-muted)'}
          sub={hasAnyDaily ? fmtPct(dailyPct) : undefined}
        />
        <Divider />

        {/* Heat gauge */}
        <div className="flex flex-col gap-1">
          <span style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500 }}>
            Riesgo de cartera
          </span>
          <div className="flex items-center gap-2">
            <span style={{ color: heatColor, fontSize: 22, fontWeight: 700 }}>
              {(heatPct * 100).toFixed(1)}%
            </span>
            <div style={{ width: 72, height: 6, borderRadius: 3, backgroundColor: 'var(--bg-tertiary)', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(100, (heatPct / heatMaxPct) * 100)}%`,
                height: '100%',
                backgroundColor: heatColor,
                transition: 'width 0.3s ease',
              }} />
            </div>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>/{(heatMaxPct * 100).toFixed(0)}%</span>
          </div>
        </div>

        <Divider />
        <MetricBlock
          label="Posiciones"
          value={`${spreads.length}/${maxPositions}`}
          color={spreads.length >= maxPositions ? 'var(--yellow-gc)' : 'var(--text-primary)'}
        />

        {/* Refresh button */}
        <div className="ml-auto">
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 rounded"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              color: refreshing ? 'var(--text-muted)' : 'var(--text-secondary)',
              border: '1px solid var(--border-dark)',
              cursor: refreshing ? 'default' : 'pointer',
              fontSize: 14,
            }}
          >
            {refreshing ? 'Actualizando…' : '↻ Actualizar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricBlock({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1" style={{ minWidth: 110 }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{ color: color ?? 'var(--text-primary)', fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>
        {value}
      </span>
      {sub && <span style={{ color: color ?? 'var(--text-secondary)', fontSize: 13 }}>{sub}</span>}
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 38, backgroundColor: 'var(--border)', flexShrink: 0 }} />;
}
