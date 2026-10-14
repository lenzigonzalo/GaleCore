import React from 'react';
import { LiveSpread, AlertType } from '../../types/position';
import { useMarketStore } from '../../store/useMarketStore';
import { useAppConfigStore } from '../../store/useAppConfigStore';
import { StrikeLadder } from './StrikeLadder';
import { PositionHeading, PositionLeg, useUnderlyingPrice } from '../positions/PositionRow';
import { GammaExposureResponse } from '../../types/api';
import { fmtPrice, fmtPnl } from '../../utils/formatters';
import { legMid } from '../../utils/streamerSymbol';

interface Props {
  spread: LiveSpread;
  gexData: Record<string, GammaExposureResponse>;
}

const ALERT_CFG: Record<NonNullable<AlertType>, { label: string; bg: string; text: string }> = {
  CERRAR:        { label: 'CLOSE',        bg: '#16a34a', text: '#fff' },
  STOP_LOSS:     { label: 'STOP LOSS',    bg: '#dc2626', text: '#fff' },
  TIME_EXIT:     { label: 'TIME EXIT',    bg: '#d97706', text: '#fff' },
  EVALUAR_ROLL:  { label: 'EVALUATE ROLL',bg: '#ea580c', text: '#fff' },
  DELTA_BREACH:  { label: 'DELTA BREACH', bg: '#dc2626', text: '#fff' },
  MACRO_PROXIMO: { label: 'MACRO EVENT',  bg: '#d97706', text: '#fff' },
};

export function PositionCard({ spread: s, gexData }: Props) {
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
  const borderColor = alertCfg ? alertCfg.bg + '88' : 'var(--border-dark)';

  const ladderLegs: PositionLeg[] = [];
  if (s.longPutStrike != null) ladderLegs.push({ side: 'BUY', type: 'PUT', strike: s.longPutStrike });
  if (s.shortPutStrike != null) ladderLegs.push({ side: 'SELL', type: 'PUT', strike: s.shortPutStrike });
  if (s.shortCallStrike != null) ladderLegs.push({ side: 'SELL', type: 'CALL', strike: s.shortCallStrike });
  if (s.longCallStrike != null) ladderLegs.push({ side: 'BUY', type: 'CALL', strike: s.longCallStrike });

  // Width of the spread
  const putWidth  = (s.shortPutStrike  != null && s.longPutStrike  != null) ? Math.abs(s.shortPutStrike  - s.longPutStrike)  : 0;
  const callWidth = (s.shortCallStrike != null && s.longCallStrike != null) ? Math.abs(s.longCallStrike  - s.shortCallStrike) : 0;
  const totalWidth = putWidth + callWidth;
  const mult       = s.multiplier ?? 100;
  const maxLossPerContract = Math.max(0, totalWidth - s.initialCredit);

  // ── POP (live, credit/width proxy — Tastytrade 1/3 rule) ──────────────────
  // POP ≈ 1 − credit/width.  Uses live net credit so it updates as the trade moves.
  // POP50 ≈ (1 + POP)/2  — touch-style approximation of reaching the 50% profit target.
  // When there's no live quote we use the entry credit so POP reflects entry,
  // not a stale previous-close value presented as "live".
  const popCredit   = s.hasLiveQuote && s.currentNetCredit != null ? s.currentNetCredit : s.initialCredit;
  const creditRatio = totalWidth > 0 ? popCredit / totalWidth : 0;
  const pop   = clampPct((1 - creditRatio) * 100);
  const pop50 = clampPct((100 + pop) / 2);
  const popSub = s.hasLiveQuote ? 'at expiration' : 'at entry';

  // Cost to close the spread right now (debit to buy it back)
  // ── Position Greeks (aggregated from live per-leg Greeks via socket) ───────
  // Position greek = Σ sign × legGreek × 100 × contracts.  sign: short −1, long +1.
  const greekLegs: Array<{ sym?: string; sign: number }> = [];
  if (s.shortPutStrike  != null) greekLegs.push({ sym: s.legSymbols.shortPut,  sign: -1 });
  if (s.longPutStrike   != null) greekLegs.push({ sym: s.legSymbols.longPut,   sign: +1 });
  if (s.shortCallStrike != null) greekLegs.push({ sym: s.legSymbols.shortCall, sign: -1 });
  if (s.longCallStrike  != null) greekLegs.push({ sym: s.legSymbols.longCall,  sign: +1 });
  const haveGreeks = greekLegs.length > 0 && greekLegs.every(l => l.sym != null && tickers[l.sym]?.delta != null);
  const sumGreek = (field: 'delta' | 'gamma' | 'theta' | 'vega'): number =>
    greekLegs.reduce((acc, l) => acc + l.sign * (l.sym ? (tickers[l.sym]?.[field] ?? 0) : 0), 0) * mult * s.contracts;
  const netDelta = haveGreeks ? sumGreek('delta') : null;
  const netGamma = haveGreeks ? sumGreek('gamma') : null;
  const netTheta = haveGreeks ? sumGreek('theta') : null;
  const netVega  = haveGreeks ? sumGreek('vega')  : null;

  // IV Rank (underlying) + short-leg IV
  const ivRank = useMarketStore(st => st.tickers[s.underlyingSymbol]?.ivRank);
  const shortSym = s.type === 'CALL_CS' ? s.legSymbols.shortCall : s.legSymbols.shortPut;
  const shortIv  = shortSym ? tickers[shortSym]?.iv : undefined;

  // ── Management triggers — progress bars only (fill = current vs its limit) ─
  // Execution text comes later from the API/JSON, not computed in front.
  type Trig = { label: string; pct: number; marker: string; color: string };
  const triggers: Trig[] = [];
  const pnlPct = s.pnlPct ?? 0;

  // P&L-driven triggers only make sense with a live quote (else pnlPct is stale).
  if (s.hasLiveQuote && s.pnlPct != null && s.pnlPct >= 0) {
    triggers.push({
      label: `Take Profit · ${(takeProfitPct * 100).toFixed(0)}%`,
      pct: pnlPct / (takeProfitPct * 100),
      marker: `${pnlPct.toFixed(0)}%`,
      color: 'var(--green)',
    });
  }
  if (s.hasLiveQuote && s.pnlPct != null && s.pnlPct < 0) {
    triggers.push({
      label: `Roll · ${(rollTrigPct * 100).toFixed(0)}% loss`,
      pct: Math.abs(pnlPct) / (rollTrigPct * 100),
      marker: `${pnlPct.toFixed(0)}%`,
      color: '#f97316',
    });
    triggers.push({
      label: `Hard Defense · ${(stopLossPct * 100).toFixed(0)}% loss`,
      pct: Math.abs(pnlPct) / (stopLossPct * 100),
      marker: `${pnlPct.toFixed(0)}%`,
      color: 'var(--red-gc)',
    });
  }
  triggers.push({
    label: `Time Exit · ${timeExitDte}d`,
    pct: timeExitDte / Math.max(s.dte, 1),
    marker: `${s.dte}d`,
    color: dteColor,
  });

  return (
    <div
      className="rounded"
      style={{ border: `1px solid ${borderColor}`, backgroundColor: 'var(--bg-secondary)', overflow: 'hidden' }}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: '1px solid var(--border-dark)', backgroundColor: 'var(--bg-tertiary)' }}
      >
        <div className="flex items-center gap-6 flex-wrap">
          <PositionHeading structure={s.type} symbol={s.underlyingSymbol} expiration={s.expiration} dte={s.dte} />
          {s.contracts > 1 && (
            <HeaderField label="Contracts" value={`×${s.contracts}`} />
          )}
          {!s.hasLiveQuote && (
            <span
              className="px-2 py-0.5 rounded"
              style={{ color: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}
              title="No live option quotes (after-hours or stream down). Values use the previous close."
            >
              STALE · PREV CLOSE
            </span>
          )}
        </div>

        {alertCfg && (
          <span
            className="px-2.5 py-1 rounded font-bold uppercase tracking-wide ml-2 flex-shrink-0"
            style={{ backgroundColor: alertCfg.bg, color: alertCfg.text, fontSize: 14 }}
          >
            {alertCfg.label}
          </span>
        )}
      </div>

      <div className="px-4 py-3 flex flex-col gap-4">
        {/* ── Strike Ladder ──────────────────────────────────────────────── */}
        <StrikeLadder legs={ladderLegs} spot={spotPrice} putWall={gexData[s.underlyingSymbol]?.putWall} callWall={gexData[s.underlyingSymbol]?.callWall} />

        {/* Stale-data warning — the account API only exposes the previous close;
            without live option quotes the P&L below can be wrong. Don't pretend. */}
        {!s.hasLiveQuote && (
          <div className="rounded px-3 py-2" style={{ backgroundColor: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)' }}>
            <span style={{ color: '#f59e0b', fontSize: 14 }}>
              No live option quotes (after-hours or stream down). P&amp;L and live metrics use the <strong>previous close</strong> and may not reflect the current position.
            </span>
          </div>
        )}

        {/* ── Stat cards (left, 3 rows) + Management triggers (right) ─────── */}
        <div className="flex items-start gap-8 flex-wrap">
          {/* All metrics as uniform cards — rows: money / greeks / probabilities */}
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(4, minmax(136px, 1fr))' }}>
            {/* Row 1 — money */}
            <StatCard label="Credit"     value={`$${fmtPrice(s.initialCredit * 100, 0)}`}
              sub={s.contracts > 1 ? `$${fmtPrice(s.initialPremium, 0)} total` : undefined} />
            <StatCard label="P&L"        value={s.currentPnl != null ? fmtPnl(s.currentPnl) : '—'}
              sub={!s.hasLiveQuote ? 'prev close' : (s.pnlPct != null ? `${s.pnlPct >= 0 ? '+' : ''}${s.pnlPct.toFixed(1)}%` : undefined)}
              valueColor={s.hasLiveQuote ? pnlColor : 'var(--text-muted)'} />
            <StatCard label="Max Profit" value={`$${fmtPrice(s.initialCredit * mult * s.contracts, 0)}`} valueColor="var(--green)" />
            <StatCard label="Max Loss"   value={`-$${fmtPrice(maxLossPerContract * mult * s.contracts, 0)}`} valueColor="var(--red-gc)" />
            {/* Row 2 — greeks (aggregated from live per-leg Greeks) */}
            <StatCard label="Net Delta"  value={fmtSigned(netDelta, 1)} />
            <StatCard label="Theta"      value={fmtMoney(netTheta)} valueColor={signColor(netTheta)} sub="/ day" />
            <StatCard label="Vega"       value={fmtMoney(netVega)}  valueColor={signColor(netVega)}  sub="/ 1 vol" />
            <StatCard label="Gamma"      value={fmtSigned(netGamma, 1)} />
            {/* Row 3 — probabilities */}
            <StatCard label="POP"        value={`${pop.toFixed(0)}%`}   sub={popSub} valueColor="var(--green)" />
            <StatCard label="Prob. +50%" value={`${pop50.toFixed(0)}%`} sub="reach target" />
            <StatCard label="IV Rank"    value={ivRank != null ? ivRank.toFixed(0) : '—'}
              sub={shortIv != null ? `IV ${(shortIv * 100).toFixed(0)}%` : undefined} />
          </div>

          {/* Management triggers — progress bars, top-aligned to the first card row */}
          <div className="flex-1 flex flex-col gap-2.5" style={{ minWidth: 300 }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Management triggers
            </span>
            {triggers.map(t => (
              <TriggerBar key={t.label} {...t} />
            ))}
          </div>
        </div>

        {/* ── Leg positioning (entry · current · change) ─────────────────── */}
        <LegDetails spread={s} tickers={tickers} />
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HeaderField({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex flex-col" style={{ lineHeight: 1.15 }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <span style={{ color: valueColor ?? 'var(--text-secondary)', fontSize: 20, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}

function TriggerBar({ label, pct, marker, color }: {
  label: string; pct: number; marker: string; color: string;
}) {
  const filled = clampPct(pct * 100);
  return (
    <div className="flex items-center gap-3">
      <span style={{ width: 168, flexShrink: 0, color: 'var(--text-secondary)', fontSize: 14.5, whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div className="flex-1" style={{ height: 14, backgroundColor: 'var(--bg-tertiary)', borderRadius: 5, overflow: 'hidden', border: '1px solid var(--border-dark)' }}>
        <div style={{ width: `${filled}%`, height: '100%', backgroundColor: color, borderRadius: 5, transition: 'width 0.3s ease' }} />
      </div>
      <span style={{ width: 52, flexShrink: 0, textAlign: 'right', color, fontSize: 15.5, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
        {marker}
      </span>
    </div>
  );
}

function StatCard({ label, value, sub, valueColor }: {
  label: string; value: string; sub?: string; valueColor?: string;
}) {
  return (
    <div className="rounded px-2.5 py-2" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-dark)' }}>
      <div style={{ color: 'var(--text-secondary)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </div>
      <div style={{ color: valueColor ?? 'var(--text-primary)', fontSize: 22, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{sub}</div>}
    </div>
  );
}

function LegDetails({ spread: s, tickers }: { spread: LiveSpread; tickers: Record<string, any> }) {
  type Row = { role: string; dir: 'Short' | 'Long'; strike: number; entry?: number; sym?: string };
  const rows: Row[] = [];

  if (s.shortPutStrike  != null) rows.push({ role: 'Short Put',  dir: 'Short', strike: s.shortPutStrike,  entry: s.shortPutEntry,  sym: s.legSymbols.shortPut });
  if (s.longPutStrike   != null) rows.push({ role: 'Long Put',   dir: 'Long',  strike: s.longPutStrike,   entry: s.longPutEntry,   sym: s.legSymbols.longPut  });
  if (s.shortCallStrike != null) rows.push({ role: 'Short Call', dir: 'Short', strike: s.shortCallStrike, entry: s.shortCallEntry, sym: s.legSymbols.shortCall });
  if (s.longCallStrike  != null) rows.push({ role: 'Long Call',  dir: 'Long',  strike: s.longCallStrike,  entry: s.longCallEntry,  sym: s.legSymbols.longCall  });

  return (
    <div style={{ borderTop: '1px solid var(--border-dark)', paddingTop: 10 }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
        Legs
      </span>
      <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {rows.map(r => {
          const cur = r.sym ? legMid(tickers[r.sym]?.bid, tickers[r.sym]?.ask) : null;
          // % change of the option price vs entry, colored by benefit to the position
          const chgPct = (cur != null && r.entry) ? ((cur - r.entry) / r.entry) * 100 : null;
          const benefits = chgPct == null ? null : (r.dir === 'Short' ? chgPct < 0 : chgPct > 0);
          const chgColor = benefits == null ? 'var(--text-muted)' : benefits ? 'var(--green)' : 'var(--red-gc)';
          const dirColor = r.dir === 'Short' ? 'var(--red-gc)' : 'var(--green)';
          return (
            <div
              key={r.role}
              className="rounded px-3 py-2"
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-dark)' }}
            >
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-secondary)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {r.role}
                </span>
                <span style={{ color: dirColor, fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}>
                  {r.dir === 'Short' ? '−1' : '+1'}
                </span>
              </div>
              <div style={{ color: 'var(--text-primary)', fontSize: 20, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, marginTop: 2 }}>
                ${fmtPrice(r.strike, 0)}
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  entry {r.entry != null ? `$${fmtPrice(r.entry, 2)}` : '—'}
                </span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 14, fontFamily: 'JetBrains Mono, monospace' }}>
                  {cur != null ? `$${fmtPrice(cur, 2)}` : '—'}
                </span>
              </div>
              {chgPct != null && (
                <div style={{ color: chgColor, fontSize: 13, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, textAlign: 'right' }}>
                  {chgPct >= 0 ? '+' : ''}{chgPct.toFixed(1)}%
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
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
