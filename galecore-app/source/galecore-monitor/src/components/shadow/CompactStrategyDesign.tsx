import React from 'react';
import type { StrategyView } from '../../pages/LabStrategySheet';
import { legSelectionLabel } from './panelPresentation';

type ExitPct = { pct_of_credit?: number; pct_of_cost?: number };
export type AlgorithmSpec = NonNullable<NonNullable<StrategyView['current']>['spec']> & {
  exits?: { deterministic?: { take_profit?: ExitPct; stop_loss?: ExitPct; time_exit?: { max_dte?: number; at?: string; days_after_entry?: number }; defensive_roll?: { enabled: boolean } } };
  data_quality?: { max_quote_age_seconds?: number; block_on_crossed_market?: boolean; block_on_missing_critical_data?: boolean };
};
interface Condition { concept: string; comparison: string; threshold: string; action: string; path?: string }
const operators: Record<string, string> = { LT: '<', LTE: '≤', GT: '>', GTE: '≥', EQ: '=', BETWEEN: 'entre' };
const blocks: Record<string, string> = { entry: 'Entrada', monitoring: 'Gestión', adjustment: 'Gestión', exit: 'Salida', risk: 'Riesgo', sizing: 'Tamaño', construction: 'Construcción', invalidation: 'Invalidación', operational: 'Operación' };
const raw = (value: unknown, unit = '') => value === null || value === undefined ? '—' : `${String(value)}${unit ? ` ${unit}` : ''}`;
function Conditions({ title, rows }: { title: string; rows: Condition[] }) {
  return <section className="algorithm-section"><h3>{title}</h3><table><thead><tr><th>Concepto</th><th>Condición</th><th>Umbral</th><th>Acción</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index} title={row.path}><td>{row.concept}</td><td>{row.comparison}</td><td className="font-mono">{row.threshold}</td><td>{row.action}</td></tr>)}{!rows.length && <tr><td colSpan={4}>—</td></tr>}</tbody></table></section>;
}
export function CompactStrategyDesign({ strategy }: { strategy: StrategyView | null }) {
  const current = strategy?.current;
  if (!current) return <p>Diseño todavía sin guardar</p>;
  const spec = current.spec as AlgorithmSpec | undefined;
  const entry: Condition[] = [...(spec?.entry_filters?.gate_layer?.gates || []), ...(spec?.entry_filters?.signal_layer?.gates || [])].map(gate => ({
    concept: gate.label.replace(/\s*(?:<=|>=|<|>|≤|≥|=)\s*-?\d+(?:[.,]\d+)?\s*$/, ''),
    comparison: operators[gate.operator] || gate.operator,
    threshold: gate.threshold?.value !== undefined ? raw(gate.threshold.value) : gate.threshold?.min !== undefined && gate.threshold?.max !== undefined ? `${gate.threshold.min}–${gate.threshold.max}` : '—',
    action: gate.on_no_data === 'BLOCK' ? 'Bloquear si falta dato' : '—', path: gate.metric_ref,
  }));
  const construction: Condition[] = [], management: Condition[] = [], exits: Condition[] = [];
  const constraints = spec?.candidate_construction?.constraints;
  if (constraints?.min_dte !== undefined || constraints?.max_dte !== undefined) construction.push({ concept: 'Días al vencimiento', comparison: 'entre', threshold: `${raw(constraints.min_dte)}–${raw(constraints.max_dte)} días`, action: 'Seleccionar vencimiento', path: 'candidate_construction.constraints.min_dte / max_dte' });
  if (constraints?.min_credit !== undefined) construction.push({ concept: 'Crédito', comparison: '≥', threshold: raw(constraints.min_credit, spec?.operational?.currency), action: 'Aceptar candidato', path: 'candidate_construction.constraints.min_credit' });
  for (const leg of spec?.candidate_construction?.legs || []) {
    const selection = leg.strike_selection;
    construction.push({ concept: `${leg.side === 'SELL' ? 'Venta' : 'Compra'} ${leg.type}`, comparison: selection.method === 'DELTA' ? 'Delta objetivo' : selection.method === 'FIXED_WIDTH' ? 'Ancho' : 'Strike',
      threshold: selection.method === 'DELTA' ? `${raw(selection.target_delta)}${selection.delta_tolerance != null ? ` ± ${selection.delta_tolerance}` : ''}` : selection.method === 'FIXED_WIDTH' ? raw(selection.width, spec?.operational?.currency) : legSelectionLabel(selection), action: 'Seleccionar pata', path: 'candidate_construction.legs.strike_selection' });
  }
  if (spec?.candidate_construction?.sizing?.fixed_contracts !== undefined) construction.push({ concept: 'Contratos', comparison: '=', threshold: raw(spec.candidate_construction.sizing.fixed_contracts), action: 'Tamaño fijo', path: 'candidate_construction.sizing.fixed_contracts' });
  const limits = spec?.risk_limits;
  if (limits?.max_concurrent_positions !== undefined) management.push({ concept: 'Posiciones abiertas', comparison: 'máximo', threshold: raw(limits.max_concurrent_positions), action: 'Bloquear nuevas entradas', path: 'risk_limits.max_concurrent_positions' });
  if (limits?.min_minutes_between_entries !== undefined) management.push({ concept: 'Tiempo entre entradas', comparison: 'mínimo', threshold: raw(limits.min_minutes_between_entries, 'minutos'), action: 'Esperar', path: 'risk_limits.min_minutes_between_entries' });
  if (limits?.max_loss_per_trade_usd !== undefined) management.push({ concept: 'Riesgo por operación', comparison: '≤', threshold: raw(limits.max_loss_per_trade_usd, 'USD'), action: 'No abrir si excede', path: 'risk_limits.max_loss_per_trade_usd' });
  const deterministic = spec?.exits?.deterministic;
  if (deterministic?.defensive_roll) management.push({ concept: 'Roll defensivo habilitado', comparison: '=', threshold: deterministic.defensive_roll.enabled ? 'Sí' : 'No', action: deterministic.defensive_roll.enabled ? '—' : 'Sin ajustes', path: 'exits.deterministic.defensive_roll.enabled' });
  const pctRow = (exit: ExitPct, gain: boolean): Condition => {
    const cost = exit.pct_of_cost !== undefined && exit.pct_of_cost !== null;
    const key = gain ? 'take_profit' : 'stop_loss';
    return { concept: `${gain ? 'Ganancia' : 'Pérdida'} sobre ${cost ? 'el costo' : 'el crédito'}`, comparison: '≥', threshold: raw(cost ? exit.pct_of_cost : exit.pct_of_credit, cost ? '% del costo' : '% del crédito'),
      action: gain ? 'Cerrar por objetivo' : 'Cerrar por stop', path: `exits.deterministic.${key}.${cost ? 'pct_of_cost' : 'pct_of_credit'}` };
  };
  if (deterministic?.stop_loss) exits.push(pctRow(deterministic.stop_loss, false));
  if (deterministic?.take_profit) exits.push(pctRow(deterministic.take_profit, true));
  const timeExit = deterministic?.time_exit;
  if (timeExit?.max_dte !== undefined && timeExit.max_dte !== null) exits.push({ concept: 'Días restantes', comparison: '≤', threshold: raw(timeExit.max_dte, 'DTE'), action: 'Cerrar por tiempo', path: 'exits.deterministic.time_exit.max_dte' });
  if (timeExit?.at) {
    const day = timeExit.days_after_entry;
    exits.push({ concept: 'Hora de cierre', comparison: '≥', threshold: `${timeExit.at} · ${day === undefined || day === null ? 'día del vencimiento' : day === 0 ? 'mismo día' : `${day} ${day === 1 ? 'día' : 'días'} después`}`, action: 'Cerrar por tiempo', path: 'exits.deterministic.time_exit.at' });
  }
  const annotations = (current.rules || []).filter(rule => rule.runtime !== 'supported');
  return <div className="compact-design algorithm-design performance-block">
    <div><Conditions title="Entrada" rows={entry} /><Conditions title="Construcción" rows={construction} /></div>
    <div><Conditions title="Gestión" rows={management} /><Conditions title="Salida" rows={exits} />
      {!!current.management?.length && <section className="algorithm-section"><h3>Gestión declarada</h3><ul>{current.management.map(step => <li key={step.id}>Cuando {step.trigger} → {step.action}</li>)}</ul></section>}
    </div>
    {!!annotations.length && <section className="design-annotations"><h3>Reglas que SHADOW todavía no ejecuta</h3><table><thead><tr><th>Grupo</th><th>Concepto declarado</th><th>Umbral declarado</th></tr></thead><tbody>{annotations.map(rule => <tr key={rule.id} title={[rule.rationale, rule.runtime_note].filter(Boolean).join('\n') || undefined}><td>{blocks[rule.block] || rule.block}</td><td>{rule.text}</td><td title={rule.parameter ? undefined : 'Esta regla no trae un umbral estructurado en el JSON.'}>{rule.parameter || '—'}</td></tr>)}</tbody></table></section>}
    {!!current.parameters?.length && <section className="design-annotations"><h3>Parámetros declarados</h3><dl>{current.parameters.map((parameter, index) => <div key={index} title={[parameter.reasonable_range, parameter.depends_on, parameter.would_found].filter(Boolean).join('\n') || undefined}><dt>{parameter.name}</dt><dd>{parameter.value || '—'}{parameter.unit && ` ${parameter.unit}`}</dd></div>)}</dl></section>}
  </div>;
}
