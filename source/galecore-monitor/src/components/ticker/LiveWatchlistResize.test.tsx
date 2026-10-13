import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LiveWatchlist } from './LiveWatchlist';
import { useGexStore } from '../../store/useGexStore';
jest.mock('../../api/gex', () => ({ fetchGexRules: jest.fn(), fetchGexAnalysis: jest.fn() }));
jest.mock('./TickerGrid', () => ({ TickerGrid: () => <div>Cotizaciones</div> }));

test('ajusta el panel con límites y conserva su ancho al contraer y volver a abrir', () => {
  useGexStore.setState({ rules: {} as any, rulesError: null, tickers: [] });
  function Panel({ open }: { open: boolean }) {
    const [width, setWidth] = useState(420);
    return <LiveWatchlist open={open} enabled width={width} onWidthChange={setWidth} onClose={() => {}} onSelect={() => {}} socketStatus="disconnected" subscribeSymbol={() => {}} unsubscribeSymbol={() => {}} />;
  }
  const { rerender } = render(<Panel open />);
  const edge = screen.getByRole('separator', { name: 'Ancho de watchlist' });
  fireEvent.keyDown(edge, { key: 'ArrowLeft' });
  expect(screen.getByRole('complementary')).toHaveStyle({ width: '440px' });
  fireEvent.keyDown(edge, { key: 'End' });
  fireEvent.keyDown(edge, { key: 'ArrowLeft' });
  expect(edge).toHaveAttribute('aria-valuenow', '720');
  fireEvent.keyDown(edge, { key: 'Home' });
  fireEvent.keyDown(edge, { key: 'ArrowRight' });
  expect(edge).toHaveAttribute('aria-valuenow', '360');
  rerender(<Panel open={false} />);
  rerender(<Panel open />);
  expect(screen.getByRole('complementary')).toHaveStyle({ width: '360px' });
  fireEvent.doubleClick(edge);
  expect(edge).toHaveAttribute('aria-valuenow', '420');
});
