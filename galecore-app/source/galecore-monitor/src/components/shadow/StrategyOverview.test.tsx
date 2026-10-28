import React from 'react';
import { render, screen } from '@testing-library/react';
import { StrategyOverview } from './StrategyOverview';

test('restores the complete hypothesis and objective block in the original order alongside strategy facts', () => {
  const { container } = render(<StrategyOverview strategy={{ current: { ref: 'v1', approved: true, purpose: '', spec_hash: '', hypothesis: { mechanism: 'Hipótesis completa sin recorte', expected_result: 'Objetivo completo sin recorte', capture: '', failure_conditions: [] }, spec: { universe: { symbols: ['SPY'] }, candidate_construction: { constraints: { min_dte: 30, max_dte: 45 } } } } }} />);
  const panel = screen.getByRole('region', { name: 'Hipótesis y objetivo' });
  expect(panel).toHaveClass('lab-design-overview');
  expect(panel).toHaveTextContent('HIPÓTESISHipótesis completa sin recorteOBJETIVOObjetivo completo sin recorte');
  expect(screen.getByText('30–45 días')).toBeInTheDocument();
  expect(container.querySelector('details')).toBeNull();
});
test('no project means no invented hypothesis block', () => {
  const { container } = render(<StrategyOverview strategy={null} />);
  expect(container).toBeEmptyDOMElement();
});
