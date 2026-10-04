import React, { useEffect, useState } from 'react';
import { fetchRpfRulesRaw } from '../../api/rules';
import { tint } from '../../utils/formatters';
import { SectionTitle, Card, CollapsibleCard, Stat, TH, TD } from './ReferencePrimitives';

/**
 * Panel de Definiciones de RPF. Se muestra dentro del modal de Referencias de la pestaña RPF
 * (ver ReferencesModal); con `embedded` se le saca el chrome de página (header propio + scroll),
 * porque el modal ya pone el marco y el título.
 */
export function StrategyReference({ embedded = false }: { embedded?: boolean }) {
  const [rules, setRules] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (attempt = 0) => {
      fetchRpfRulesRaw()
        .then((r) => { if (!cancelled) setRules(r); })
        .catch((e) => {
          if (cancelled) return;
          if (attempt < 3) setTimeout(() => load(attempt + 1), 1000 * (attempt + 1));
          else setErr(String(e?.message ?? e));
        });
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const meta = rules?._meta;
  const scope = rules?.strategy_scope;
  const universe = rules?.universe;
  const l2cfg = rules?.position_builder?.layers?.find((l: any) => l.name === 'strike_engine')?.config;
  const l3cfg = rules?.position_builder?.layers?.find((l: any) => l.name === 'microstructure');
  const l4cfg = rules?.position_builder?.layers?.find((l: any) => l.name === 'risk_and_sizing')?.config;
  const gatesDef = rules?.signal_gates?.gates ?? {};
  const tm = rules?.trade_management ?? {};
  const sm = rules?.state_machine;
  const orch = rules?.orchestration;
  const checks = rules?.macro_regime?.checks ?? [];
  const edgeBars = gatesDef?.edge?.bars_by_regime;
  const expectedMetrics = meta?.expected_metrics;

  return (
    <div style={embedded
      ? { fontFamily: 'var(--font-sans)' }
      : { padding: '14px 18px 40px', height: '100%', overflowY: 'auto', fontFamily: 'var(--font-sans)' }}>
      {/* Header — solo como página suelta; dentro del modal lo pone el modal. */}
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>RPF Strategy Reference</span>
          {meta && (
            <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.06em',
              color: 'var(--blue-gc)', backgroundColor: tint('var(--blue-gc)', 13), border: `1px solid ${tint('var(--blue-gc)', 27)}`, fontFamily: 'JetBrains Mono, monospace' }}>
              v{meta.version} · {meta.status}
            </span>
          )}
        </div>
      )}

      {err && <div style={{ color: 'var(--red-gc)', fontSize: 13, marginBottom: 12, fontFamily: 'JetBrains Mono, monospace' }}>⚠ {err}</div>}

      {/* A · Definition */}
      <SectionTitle>A · Definition</SectionTitle>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 4 }}>
          <Stat label="Structure" value={scope?.default_structure === 'put_credit_spread' ? 'PCS-only' : scope?.default_structure ?? '—'} hint="put credit spread" />
          <Stat label="Delta target" value={l2cfg?.delta_target?.put_short ?? '0.25'} />
          <Stat label="Width (SPY)" value={l2cfg?.spread_width?.symbol_overrides?.SPY?.default != null ? `$${l2cfg.spread_width.symbol_overrides.SPY.default}` : '$5'} hint="points" />
          <Stat label="DTE" value={l2cfg?.dte_selection?.target ?? 45} hint={l2cfg?.dte_selection ? `${l2cfg.dte_selection.min}–${l2cfg.dte_selection.max}` : ''} />
          <Stat label="Universe" value={(universe?.tickers ?? ['SPY']).join(' · ')} />
        </div>
        {expectedMetrics && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 8 }}>
            <Stat label="Trades / year" value={`~${expectedMetrics.trades_per_year}`} hint="interpolated" />
            <Stat label="Win rate" value={`${(expectedMetrics.win_rate * 100).toFixed(0)}%`} />
            <Stat label="Worst year" value={`$${expectedMetrics.worst_year_usd}`} />
          </div>
        )}
      </Card>

      {/* B · Macro Regime */}
      <CollapsibleCard title="B · Macro regime (4 checks)" titleColor="var(--blue-gc)" defaultOpen>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Check</TH><TH>Label</TH><TH>On fail</TH></tr></thead>
          <tbody>
            {checks.map((c: any) => (
              <tr key={c.id}>
                <TD mono>{c.id}</TD>
                <TD>{c.label}</TD>
                <TD mono color={c.on_fail === 'no_trade' ? 'var(--red-gc)' : 'var(--yellow-gc)'}>{c.on_fail}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsibleCard>

      {/* C · Signal Gates */}
      <CollapsibleCard title="C · Signal gates (5 gates)" titleColor="#a78bfa">
        {Object.entries(gatesDef).map(([id, def]: [string, any]) => {
          const thr = def.min ?? (def.min_usd != null ? `$${def.min_usd}` : undefined) ?? (def.bars_by_regime ? 'by regime' : undefined);
          return (
            <div key={id} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 80px', gap: 10, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border-dark)' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{id}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{def.label ?? '—'}</span>
              <span style={{ fontSize: 12, fontWeight: 700, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace',
                color: def.enabled ? 'var(--green)' : 'var(--text-muted)' }}>
                {def.enabled ? (thr ?? 'ON') : 'OFF'}
              </span>
            </div>
          );
        })}
        {edgeBars && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Edge bars by regime</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(edgeBars).map(([regime, bar]: [string, any]) => (
                <div key={regime} style={{
                  padding: '4px 10px', borderRadius: 4, fontSize: 13, fontFamily: 'JetBrains Mono, monospace',
                  backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-dark)',
                }}>
                  <span style={{ color: 'var(--text-muted)' }}>{regime}: </span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>≥ {bar}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CollapsibleCard>

      {/* D · Trade Management */}
      <CollapsibleCard title="D · Trade management" titleColor="var(--yellow-gc)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          {tm.take_profit?.pct_of_initial_credit != null && <Stat label="Take profit" value={`${Math.round(tm.take_profit.pct_of_initial_credit * 100)}%`} hint="of initial credit" />}
          {tm.hard_defense?.trigger_any?.short_leg_delta_abs_gt != null && <Stat label="Hard defense" value={`Δ ${tm.hard_defense.trigger_any.short_leg_delta_abs_gt}`} hint="short delta" />}
          {tm.hard_defense?.trigger_any?.unrealized_loss_pct_of_initial_credit_gte != null && <Stat label="Loss trigger" value={`${Math.round(tm.hard_defense.trigger_any.unrealized_loss_pct_of_initial_credit_gte * 100)}%`} hint="unrealized / credit" />}
          {tm.defensive_roll?.trigger_unrealized_loss_pct_of_initial_credit_gte != null && <Stat label="Defensive roll" value={`${Math.round(tm.defensive_roll.trigger_unrealized_loss_pct_of_initial_credit_gte * 100)}%`} hint={`min ${tm.defensive_roll.min_dte_remaining} DTE · max ${tm.defensive_roll.max_rolls_per_position} roll`} />}
          {tm.daily_kill_switch?.daily_portfolio_mtm_loss_pct_net_liq_max != null && <Stat label="Kill switch" value={`${(tm.daily_kill_switch.daily_portfolio_mtm_loss_pct_net_liq_max * 100).toFixed(1)}%`} hint="MtM / NetLiq" />}
        </div>
        {tm.time_exit && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Time exit: {tm.time_exit.enabled ? 'enabled' : 'disabled'}{tm.time_exit.reason ? ` — ${tm.time_exit.reason.slice(0, 80)}…` : ''}
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Evaluation priority</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(tm.evaluation_priority ?? []).map((step: string, i: number) => (
              <div key={step} style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 4,
                fontSize: 12, fontFamily: 'JetBrains Mono, monospace',
                backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-dark)', color: 'var(--text-primary)',
              }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}</span> {step}
              </div>
            ))}
          </div>
        </div>
      </CollapsibleCard>

      {/* E · Risk & Sizing */}
      <CollapsibleCard title="E · Risk & sizing" titleColor="var(--green)">
        {l4cfg && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            <Stat label="Risk / trade" value={`${(l4cfg.risk_per_trade_pct * 100).toFixed(1)}%`} hint={`max ${(l4cfg.risk_per_trade_max_pct * 100).toFixed(0)}%`} />
            <Stat label="Max positions" value={l4cfg.max_positions} hint={l4cfg.portfolio_variant ?? ''} />
            <Stat label="Max heat" value={`${(l4cfg.max_heat_pct_net_liq * 100).toFixed(0)}%`} hint="of net liq" />
            <Stat label="MaxDD cap" value={`${(l4cfg.maxdd_cap_pct * 100).toFixed(0)}%`} />
            <Stat label="Capital base" value={`$${(l4cfg.capital?.base_reference_usd ?? 0).toLocaleString()}`} />
            <Stat label="Live target" value={`$${(l4cfg.capital?.live_funding_target_usd ?? 0).toLocaleString()}`} />
          </div>
        )}
      </CollapsibleCard>

      {/* F · State Machine */}
      <CollapsibleCard title="F · State machine (7 states)" titleColor="#f59e0b">
        {sm && (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Precedence (top wins)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              {(sm.precedence ?? []).map((state: string, i: number) => {
                const desc = sm.states?.[state] ?? '';
                const colors: Record<string, string> = {
                  VETOED: 'var(--red-gc)', TRIGGERED: 'var(--green)', ARMED: 'var(--blue-gc)',
                  COOLDOWN: '#a78bfa', WAITING_CAPACITY: 'var(--yellow-gc)',
                };
                const c = colors[state] ?? 'var(--text-muted)';
                return (
                  <div key={state} style={{
                    display: 'grid', gridTemplateColumns: '24px 150px 1fr', gap: 8, alignItems: 'center',
                    padding: '4px 8px', borderRadius: 4, backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-dark)',
                  }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{i + 1}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: c, fontFamily: 'JetBrains Mono, monospace' }}>{state}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{desc}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CollapsibleCard>

      {/* G · Microstructure */}
      <CollapsibleCard title="G · Microstructure checks" titleColor="var(--text-muted)">
        {l3cfg?.checks && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><TH>Check</TH><TH>Label</TH><TH>Threshold</TH><TH>On fail</TH></tr></thead>
            <tbody>
              {l3cfg.checks.map((c: any) => (
                <tr key={c.id}>
                  <TD mono>{c.id}</TD>
                  <TD>{c.label}</TD>
                  <TD mono>{c.threshold?.value ?? '—'}</TD>
                  <TD mono color={c.on_fail === 'discard_side' ? 'var(--red-gc)' : 'var(--yellow-gc)'}>{c.on_fail}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CollapsibleCard>

      {/* H · Orchestration */}
      {orch && (
        <CollapsibleCard title="H · Orchestration" titleColor="var(--text-muted)">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            <Stat label="Tier A refresh" value={`${orch.tier_a_refresh_seconds}s`} hint="macro + VRP + tail + GEX" />
            <Stat label="Tier B tick" value={`${orch.tier_b_tick_seconds}s`} hint="strikes + edge + cupo" />
            <Stat label="Cooldown" value={`${orch.cooldown_seconds}s`} hint="anti double-fire" />
          </div>
        </CollapsibleCard>
      )}
    </div>
  );
}
