import React from 'react';
import type { StrategyView } from '../../pages/LabStrategySheet';

const operators: Record<string, string> = { LT: '<', LTE: '≤', GT: '>', GTE: '≥', EQ: '=', BETWEEN: 'entre' };
export function CompactStrategyDesign({ strategy }: { strategy: StrategyView | null }) {
  const current = strategy?.current;
  if (!current) return <p>Diseño todavía sin guardar</p>;
  const gates = [...(current.spec?.entry_filters?.gate_layer?.gates || []), ...(current.spec?.entry_filters?.signal_layer?.gates || [])];
  return <div className="compact-design performance-block">
    <div><section><h3>Entrada</h3><ul>{gates.map(gate => <li key={gate.id} title={gate.metric_ref}>{gate.label} {operators[gate.operator] || gate.operator} {gate.threshold?.value ?? (gate.threshold?.min !== undefined && gate.threshold?.max !== undefined ? `${gate.threshold.min} y ${gate.threshold.max}` : '—')}{gate.on_no_data === 'BLOCK' && <span className="design-no-data" title="Si falta el dato, se bloquea la entrada"> · bloquea</span>}</li>)}{!gates.length && <li>—</li>}</ul></section>
      <section><h3>Reglas</h3><ul>{(current.rules || []).map(rule => <li key={rule.id} title={[rule.rationale, rule.runtime_note].filter(Boolean).join('\n') || undefined}>{rule.text}</li>)}{!current.rules?.length && <li>—</li>}</ul></section></div>
    <div><section><h3>Salida y gestión</h3><ul>{(current.management || []).map(step => <li key={step.id}>Cuando {step.trigger} <span aria-hidden="true">→</span> {step.action}</li>)}{!current.management?.length && <li>—</li>}</ul></section>
      <section><h3>Parámetros</h3><dl>{(current.parameters || []).map((parameter, index) => <div key={index} title={[parameter.reasonable_range, parameter.depends_on, parameter.would_found].filter(Boolean).join('\n') || undefined}><dt>{parameter.name}</dt><dd>{parameter.value || '—'}{parameter.unit && ` ${parameter.unit}`}</dd></div>)}{!current.parameters?.length && <div><dt>—</dt><dd>—</dd></div>}</dl></section></div>
  </div>;
}
