import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { AlgorithmSpec, CompactStrategyDesign } from './CompactStrategyDesign';
import type { StrategyView } from '../../pages/LabStrategySheet';

test('compact design shows conditions, management and values without Lab metadata or rule ids', () => {
  const strategy: StrategyView = { current: { ref: 'v1', approved: true, purpose: 'hidden purpose', spec_hash: 'hidden hash',
    spec: { entry_filters: { gate_layer: { gates: [{ id: 'G1', label: 'VIX', metric_ref: 'vix', operator: 'LT', threshold: { value: 25 }, on_no_data: 'BLOCK' }, { id: 'G2', label: 'IV Rank', metric_ref: 'iv_rank', operator: 'GTE', threshold: { value: 30 } }] } } },
    management: [{ id: 'X1', kind: 'exit', trigger: 'la prima cae a la mitad', action: 'cerrar', rules: ['X1'] }],
    rules: [{ id: 'X1', block: 'exit', text: 'Cerrar al objetivo', parameter: '', runtime: 'implemented', rationale: 'Fundamento guardado', sources: ['hidden source'] }],
    parameters: [{ name: 'Crédito mínimo', value: '0.50', unit: 'USD', reasonable_range: 'Rango declarado', depends_on: '', would_found: '', status: 'grounded', rules: ['G1'], sources: [] }] } };
  const { container } = render(<CompactStrategyDesign strategy={strategy} />);
  expect(screen.getByText('VIX').closest('tr')).toHaveTextContent('25Bloquear si falta dato');
  expect(screen.getByText('IV Rank').closest('tr')).toHaveTextContent('≥30');
  expect(screen.getByText(/Cuando la prima cae a la mitad/)).toHaveTextContent('→ cerrar');
  expect(screen.getByText('Cerrar al objetivo').closest('tr')).toHaveAttribute('title', 'Fundamento guardado');
  expect(screen.getByText('0.50 USD')).toBeInTheDocument();
  expect(screen.queryByText('X1')).not.toBeInTheDocument();
  expect(screen.queryByText(/Versión|Aprobada|Definiciones pendientes|Fundamento y alcance|hidden/)).not.toBeInTheDocument();
  expect(container.querySelector('details')).toBeNull();
});
test('algorithm view preserves structured exit thresholds and does not derive numeric thresholds from narratives', () => {
  const spec: AlgorithmSpec = { exits: { deterministic: { take_profit: { pct_of_credit: 40 }, stop_loss: { pct_of_credit: 175 }, time_exit: { max_dte: 19 }, defensive_roll: { enabled: false } } }, risk_limits: { max_concurrent_positions: 7, min_minutes_between_entries: 0, max_loss_per_trade_usd: 450 }, data_quality: { max_quote_age_seconds: 15 } };
  const strategy: StrategyView = { current: { ref: 'v1', approved: true, purpose: '', spec_hash: '', spec, rules: [{ id: 'E9', block: 'entry', text: 'Entrar según un criterio por definir', parameter: '', runtime: 'unsupported' }] } };
  render(<CompactStrategyDesign strategy={strategy} />);
  const exits = screen.getByRole('heading', { name: 'Salida' }).closest('section')!;
  expect(within(exits).getByText('Ganancia sobre el crédito').closest('tr')).toHaveTextContent('≥40 % del créditoCerrar por objetivo');
  expect(within(exits).getByText('Pérdida sobre el crédito').closest('tr')).toHaveTextContent('≥175 % del créditoCerrar por stop');
  expect(within(exits).getByText('Días restantes').closest('tr')).toHaveTextContent('≤19 DTECerrar por tiempo');
  expect(screen.getByText('Tiempo entre entradas').closest('tr')).toHaveTextContent('0 minutos');
  expect(screen.queryByText('Edad de cotización configurada')).not.toBeInTheDocument();
  expect(screen.queryByText('150 segundos')).not.toBeInTheDocument();
  expect(screen.getByText('Entrar según un criterio por definir').closest('tr')).toHaveTextContent('—');
});
