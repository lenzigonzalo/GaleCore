import React from 'react';
import { LiveSpread, AlertType } from '../../types/position';
import { useMarketStore } from '../../store/useMarketStore';
import { useAppConfigStore } from '../../store/useAppConfigStore';
import { StrikeLadder } from './StrikeLadder';
import { PositionHeading, PositionLeg, useUnderlyingPrice } from '../positions/PositionRow';
import { GammaExposureResponse } from '../../types/api';
import { fmtPrice, fmtPnl } from '../../utils/formatters';
import { AccountSpreadRisk } from '../../api/account';
import { legMid } from '../../utils/streamerSymbol';
import './PositionCard.css';

interface Props {
  spread: LiveSpread;
  /** Pérdida máxima, POP y griegas netas, calculados por la API. */
  risk?: AccountSpreadRisk;
  gexData: Record<string, GammaExposureResponse>;
}

const ALERT_CFG: Record<NonNullable<AlertType>, { label: string; bg: string; text: string }> = {
  CERRAR:        { label: 'Cerrar',            bg: '#16a34a', text: '#fff' },
  STOP_LOSS:     { label: 'Stop loss',         bg: '#dc2626', text: '#fff' },
  TIME_EXIT:     { label: 'Salida por tiempo', bg: '#d97706', text: '#fff' },
  EVALUAR_ROLL:  { label: 'Evaluar roll',      bg: '#ea580c', text: '#fff' },
  DELTA_BREACH:  { label: 'Delta excedido',    bg: '#dc2626', text: '#fff' },
  MACRO_PROXIMO: { label: 'Evento macro',      bg: '#d97706', text: '#fff' },
};

export function PositionCard({ spread: s, risk, gexData }: Props) {
  const { config }    = useAppConfigStore();
  const spotPrice     = useUnderlyingPrice(s.underlyingSymbol);
  const tickers       = useMarketStore(st => st.tickers);

  // Rule thresholds — nodo `monitor` del config de la app (transversal a estrategias)
  const tm = config?.monitor?.trade_management;
  const takeProfitPct  = tm?.take_profit?.pct_of_initial_credit ?? 0.5;
  const stopLossPct    = tm?.hard_defense?.trigger_any?.unrealized_loss_pct_of_initial_credit_gte ?? 2.0;
  const rollTrigPct    = tm?.defensive_roll?.trigger_unrealized_loss_pct_of_initial_credit_gte ?? 1.0;
  const timeExitDte    = tm?.time_exit?.dte_threshold ?? 21;

  // Colors
  const dteColor    = s.dte <= timeExitDte ? '#f59e0b' : s.dte <= timeExitDte + 7 ? '#f97316' : 'var(--text-secondary)';
  const pnlColor    = s.currentPnl == null ? 'var(--text-muted)' : s.currentPnl >= 0 ? 'var(--green)' : 'var(--red-gc)';
  const alertCfg    = s.alert ? ALERT_CFG[s.alert] : null;

  const ladderLegs: PositionLeg[] = [];
  if (s.longPutStrike != null) ladderLegs.push({ side: 'BUY', type: 'PUT', strike: s.longPutStrike });
  if (s.shortPutStrike != null) ladderLegs.push({ side: 'SELL', type: 'PUT', strike: s.shortPutStrike });
  if (s.shortCallStrike != null) ladderLegs.push({ side: 'SELL', type: 'CALL', strike: s.shortCallStrike });
  if (s.longCallStrike != null) ladderLegs.push({ side: 'BUY', type: 'CALL', strike: s.longCallStrike });

  const g = risk?.greeks ?? null;
  const ivRank = useMarketStore(st => st.tickers[s.underlyingSymbol]?.ivRank);

  // ── Management triggers — progress bars only (fill = current vs its limit) ─
  // Execution text comes later from the API/JSON, not computed in front.
  type Trig = { label: string; pct: number; marker: string; color: string };
  const triggers: Trig[] = [];
  const pnlPct = s.pnlPct ?? 0;

  // P&L-driven triggers only make sense with a live quote (else pnlPct is stale).
  if (s.hasLiveQuote && s.pnlPct != null && s.pnlPct >= 0) {
    triggers.push({
      label: `Toma de ganancia · ${(takeProfitPct * 100).toFixed(0)}%`,
      pct: pnlPct / (takeProfitPct * 100),
      marker: `${pnlPct.toFixed(0)}%`,
      color: 'var(--green)',
    });
  }
  if (s.hasLiveQuote && s.pnlPct != null && s.pnlPct < 0) {
    triggers.push({
      label: `Roll · pérdida ${(rollTrigPct * 100).toFixed(0)}%`,
      pct: Math.abs(pnlPct) / (rollTrigPct * 100),
      marker: `${pnlPct.toFixed(0)}%`,
      color: '#f97316',
    });
    triggers.push({
      label: `Defensa · pérdida ${(stopLossPct * 100).toFixed(0)}%`,
      pct: Math.abs(pnlPct) / (stopLossPct * 100),
      marker: `${pnlPct.toFixed(0)}%`,
      color: 'var(--red-gc)',
    });
  }
  triggers.push({
    label: `Salida por tiempo · ${timeExitDte} d`,
    pct: timeExitDte / Math.max(s.dte, 1),
    marker: `${s.dte}d`,
    color: dteColor,
  });

  const money = (n: number) => `$${fmtPrice(n, 0)}`;
  const groups: { group: string; items: [string, string, string?, string?][] }[] = [
    { group: 'Resultado', items: [
      ['Crédito', money(s.initialCredit * 100), s.contracts > 1 ? `${money(s.initialPremium)} en total` : undefined],
      ['Resultado', s.currentPnl != null && s.hasLiveQuote ? fmtPnl(s.currentPnl) : '—', s.hasLiveQuote && s.pnlPct != null ? `${s.pnlPct >= 0 ? '+' : ''}${s.pnlPct.toFixed(1)}%` : undefined, s.hasLiveQuote ? pnlColor : undefined],
      ['Ganancia máxima', risk ? money(risk.maxProfit) : '—', undefined, 'var(--green)'],
      ['Pérdida máxima', risk ? `−${money(risk.maxLoss)}` : '—', undefined, 'var(--red-gc)'],
    ] },
    { group: 'Griegas', items: [
      ['Delta', fmtSigned(g?.delta ?? null, 1)],
      ['Theta por día', fmtMoney(g?.theta ?? null), undefined, signColor(g?.theta ?? null)],
      ['Vega por punto de vol.', fmtMoney(g?.vega ?? null), undefined, signColor(g?.vega ?? null)],
      ['Gamma', fmtSigned(g?.gamma ?? null, 1)],
    ] },
    { group: 'Probabilidad', items: [
      ['De ganar', risk?.pop != null ? `${risk.pop.toFixed(0)}%` : '—', risk?.pop != null ? (risk.popBasis === 'vivo' ? 'al vencimiento' : 'a la entrada') : undefined],
      ['De llegar al 50%', risk?.pop50 != null ? `${risk.pop50.toFixed(0)}%` : '—'],
      ['IV Rank', ivRank != null ? ivRank.toFixed(0) : '—', g?.shortLegIv != null ? `IV pata vendida ${(g.shortLegIv * 100).toFixed(0)}%` : undefined],
    ] },
  ];
  return (
    <section className="position-monitor" style={alertCfg ? { borderColor: alertCfg.bg + '88' } : undefined}>
      <header className="position-monitor-head">
        <PositionHeading structure={s.type} symbol={s.underlyingSymbol} expiration={s.expiration} dte={s.dte} />
        {s.contracts > 1 && <span className="position-monitor-contracts">×{s.contracts} contratos</span>}
        {alertCfg && <span className="position-monitor-alert" style={{ backgroundColor: alertCfg.bg, color: alertCfg.text }}>{alertCfg.label}</span>}
      </header>
      {!s.hasLiveQuote && <p className="position-monitor-stale" title="Fuera de horario o sin stream de opciones: los valores son del cierre anterior.">Sin cotización en vivo · valores del cierre anterior</p>}
      <StrikeLadder legs={ladderLegs} spot={spotPrice} putWall={gexData[s.underlyingSymbol]?.putWall} callWall={gexData[s.underlyingSymbol]?.callWall} />
      <div className="position-monitor-body">
        <div className="position-monitor-metrics">{groups.map(group => <dl key={group.group}><dt className="group">{group.group}</dt>
          {group.items.map(([label, value, sub, color]) => <div key={label} className="metric-row"><dt>{label}</dt><dd style={color ? { color } : undefined}>{value}{sub && <small>{sub}</small>}</dd></div>)}</dl>)}</div>
        <div className="position-monitor-rules"><h3>Reglas de gestión</h3>{triggers.map(t => <TriggerBar key={t.label} {...t} />)}</div>
      </div>
      <LegDetails spread={s} tickers={tickers} />
    </section>
  );
}

function TriggerBar({ label, pct, marker, color }: { label: string; pct: number; marker: string; color: string }) {
  return <div className="trigger-row"><span>{label}</span><div className="trigger-track"><div style={{ width: `${clampPct(pct * 100)}%`, backgroundColor: color }} /></div><strong style={{ color }}>{marker}</strong></div>;
}

function LegDetails({ spread: s, tickers }: { spread: LiveSpread; tickers: Record<string, any> }) {
  type Row = { role: string; short: boolean; strike: number; entry?: number; sym?: string };
  const rows: Row[] = [];
  if (s.shortPutStrike  != null) rows.push({ role: 'Venta put',   short: true,  strike: s.shortPutStrike,  entry: s.shortPutEntry,  sym: s.legSymbols.shortPut });
  if (s.longPutStrike   != null) rows.push({ role: 'Compra put',  short: false, strike: s.longPutStrike,   entry: s.longPutEntry,   sym: s.legSymbols.longPut });
  if (s.shortCallStrike != null) rows.push({ role: 'Venta call',  short: true,  strike: s.shortCallStrike, entry: s.shortCallEntry, sym: s.legSymbols.shortCall });
  if (s.longCallStrike  != null) rows.push({ role: 'Compra call', short: false, strike: s.longCallStrike,  entry: s.longCallEntry,  sym: s.legSymbols.longCall });
  return <table className="position-monitor-legs"><thead><tr><th>Pata</th><th>Strike</th><th>Entrada</th><th>Actual</th><th>Cambio</th></tr></thead><tbody>
    {rows.map(r => {
      const cur = r.sym ? legMid(tickers[r.sym]?.bid, tickers[r.sym]?.ask) : null;
      const chg = cur != null && r.entry ? ((cur - r.entry) / r.entry) * 100 : null;
      const good = chg == null ? null : r.short ? chg < 0 : chg > 0;
      return <tr key={r.role}><td style={{ color: r.short ? 'var(--red-gc)' : 'var(--green)' }}>{r.role}</td><td>{fmtPrice(r.strike, 0)}</td>
        <td>{r.entry != null ? `$${fmtPrice(r.entry, 2)}` : '—'}</td><td>{cur != null ? `$${fmtPrice(cur, 2)}` : '—'}</td>
        <td style={{ color: good == null ? undefined : good ? 'var(--green)' : 'var(--red-gc)' }}>{chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%` : '—'}</td></tr>;
    })}</tbody></table>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function fmtSigned(n: number | null, decimals = 1): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}`;
}

function fmtMoney(n: number | null): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(1)}`;
}

function signColor(n: number | null): string {
  if (n == null) return 'var(--text-muted)';
  return n >= 0 ? 'var(--green)' : 'var(--red-gc)';
}
