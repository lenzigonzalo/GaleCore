import React from 'react';
import { render, screen } from '@testing-library/react';
import { StrategyOverview } from './StrategyOverview';

test('hipótesis y objetivo completos, en orden, con los datos de la estrategia en una línea', () => {
  const { container } = render(<StrategyOverview strategy={{ current: { ref: 'v1', approved: true, purpose: '', spec_hash: '', hypothesis: { mechanism: 'Hipótesis completa sin recorte', expected_result: 'Objetivo completo sin recorte', capture: '', failure_conditions: [] }, spec: { universe: { symbols: ['SPY'] }, candidate_construction: { constraints: { min_dte: 30, max_dte: 45 } } } } }} />);
  const panel = screen.getByRole('region', { name: 'Hipótesis y objetivo' });
  expect(panel).toHaveClass('compact');
  expect(panel).toHaveTextContent('HipótesisHipótesis completa sin recorteObjetivoObjetivo completo sin recorte');
  expect(panel).toHaveTextContent('30–45 días');
  expect(container.querySelector('details')).toBeNull();
});
test('no project means no invented hypothesis block', () => {
  const { container } = render(<StrategyOverview strategy={null} />);
  expect(container).toBeEmptyDOMElement();
});
