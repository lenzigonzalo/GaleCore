import React from 'react';
import type { StrategyView } from '../../pages/LabStrategySheet';

const structures: Record<string, string> = { iron_condor: 'Iron condor', put_credit_spread: 'Put credit spread', call_credit_spread: 'Call credit spread' };
export function StrategyOverview({ strategy }: { strategy: StrategyView | null }) {
  const current = strategy?.current;
  if (!current?.hypothesis) return null;
  const spec = current.spec, constraints = spec?.candidate_construction?.constraints, operational = spec?.operational;
  const facts = [
    ['Subyacentes', spec?.universe?.symbols?.join(', ')],
    ['Instrumentos', spec?.universe?.instrument_types?.map(type => type === 'EQUITY_OPTION' ? 'Opciones sobre acciones / ETF' : type).join(', ')],
    ['Estructura', structures[spec?.structure?.default_structure || ''] || spec?.structure?.default_structure],
    ['Vencimiento', constraints?.min_dte !== undefined && constraints?.max_dte !== undefined ? `${constraints.min_dte}–${constraints.max_dte} días` : undefined],
    ['Sesión', operational?.session_hours?.start && operational?.session_hours?.end ? `${operational.session_hours.start}–${operational.session_hours.end} · ${operational.timezone || '—'}` : undefined],
    ['Moneda', operational?.currency],
  ];
  return <section className="lab-design-overview strategy-overview" aria-label="Hipótesis y objetivo">
    <div><span className="lab-eyebrow">HIPÓTESIS</span><p title={current.hypothesis.mechanism || undefined}>{current.hypothesis.mechanism || '—'}</p><span className="lab-eyebrow">OBJETIVO</span><p title={current.hypothesis.expected_result || undefined}>{current.hypothesis.expected_result || '—'}</p></div>
    <dl className="lab-design-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
  </section>;
}
