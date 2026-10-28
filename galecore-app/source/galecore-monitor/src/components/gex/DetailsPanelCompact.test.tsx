import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DetailsPanel } from './DetailsPanel';
import { GexAnalysisResponse } from '../../types/gex';

test('las referencias compactas se abren con foco y cursor y se cierran al salir', () => {
  const data = { macroRegime: { checks: { gexTotal: { value: 12, threshold: 0 } } } } as GexAnalysisResponse;
  render(<DetailsPanel compact data={data} groupIds={['gamma']} />);
  const metric = screen.getByText('GEX Global').parentElement!;
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  act(() => metric.focus());
  expect(metric).toHaveFocus();
  expect(screen.getByRole('tooltip')).toHaveTextContent('ref: gamma positivo');
  expect(screen.getByRole('tooltip').id).toBe(metric.getAttribute('aria-describedby'));
  act(() => metric.blur());
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.mouseEnter(metric);
  expect(screen.getByRole('tooltip')).toBeVisible();
  fireEvent.mouseLeave(metric);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});
