import React from 'react';
import { render, screen } from '@testing-library/react';
import { CompactStrategyDesign } from './CompactStrategyDesign';
import type { StrategyView } from '../../pages/LabStrategySheet';

test('compact design shows conditions, management and values without Lab metadata or rule ids', () => {
  const strategy: StrategyView = { current: { ref: 'v1', approved: true, purpose: 'hidden purpose', spec_hash: 'hidden hash',
    spec: { entry_filters: { gate_layer: { gates: [{ id: 'G1', label: 'VIX', metric_ref: 'vix', operator: 'LT', threshold: { value: 25 }, on_no_data: 'BLOCK' }, { id: 'G2', label: 'IV Rank', metric_ref: 'iv_rank', operator: 'GTE', threshold: { value: 30 } }] } } },
    management: [{ id: 'X1', kind: 'exit', trigger: 'la prima cae a la mitad', action: 'cerrar', rules: ['X1'] }],
    rules: [{ id: 'X1', block: 'exit', text: 'Cerrar al objetivo', parameter: '', runtime: 'implemented', rationale: 'Fundamento guardado', sources: ['hidden source'] }],
    parameters: [{ name: 'Crédito mínimo', value: '0.50', unit: 'USD', reasonable_range: 'Rango declarado', depends_on: '', would_found: '', status: 'grounded', rules: ['G1'], sources: [] }] } };
  const { container } = render(<CompactStrategyDesign strategy={strategy} />);
  expect(screen.getByText(/VIX < 25/)).toHaveTextContent('bloquea');
  expect(screen.getByText('IV Rank ≥ 30')).toBeInTheDocument();
  expect(screen.getByText(/Cuando la prima cae a la mitad/)).toHaveTextContent('→ cerrar');
  expect(screen.getByText('Cerrar al objetivo')).toHaveAttribute('title', 'Fundamento guardado');
  expect(screen.getByText('0.50 USD')).toBeInTheDocument();
  expect(screen.queryByText('X1')).not.toBeInTheDocument();
  expect(screen.queryByText(/Versión|Aprobada|Definiciones pendientes|Fundamento y alcance|hidden/)).not.toBeInTheDocument();
  expect(container.querySelector('details')).toBeNull();
});
