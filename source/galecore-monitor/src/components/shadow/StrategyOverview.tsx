import React from 'react';
import type { StrategyView } from '../../pages/LabStrategySheet';

const structures: Record<string, string> = { iron_condor: 'Iron condor', put_credit_spread: 'Put credit spread', call_credit_spread: 'Call credit spread' };
export function StrategyOverview({ strategy }: { strategy: StrategyView | null }) {
  const [open, setOpen] = React.useState(false);
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
  const line = facts.filter(([, value]) => value).map(([, value]) => value).join(' · ');
  return <section className={'strategy-overview compact' + (open ? ' open' : '')} aria-label="Hipótesis y objetivo" onClick={() => setOpen(v => !v)} title={open ? 'Clic para achicar' : 'Clic para leer completo'}>
    <p><strong>Hipótesis</strong>{current.hypothesis.mechanism || '—'}</p>
    <p><strong>Objetivo</strong>{current.hypothesis.expected_result || '—'}</p>
    {line && <p className="strategy-facts">{line}</p>}
  </section>;
}
