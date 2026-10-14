import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { LivePositionRow, PositionRow, PositionRowData } from './PositionRow';
import { StrikeLadder } from '../monitor/StrikeLadder';
import { useMarketStore } from '../../store/useMarketStore';
import { fetchQuote } from '../../api/marketdata';

jest.mock('../../api/marketdata', () => ({ fetchQuote: jest.fn() }));
const legs = [
  { side: 'BUY', type: 'CALL', strike: 294 }, { side: 'SELL', type: 'PUT', strike: 255 },
  { side: 'BUY', type: 'PUT', strike: 250 }, { side: 'SELL', type: 'CALL', strike: 289 },
];
const position: PositionRowData = { symbol: 'IWM', structure: 'iron_condor', expiration: '2026-11-20', dte: 37, legs, entryAt: '2026-10-14T14:31:00Z', credit: 1.16, currentValue: 1.14, pnl: 2.5, risk: 384 };
beforeEach(() => { useMarketStore.setState({ tickers: {} }); (fetchQuote as jest.Mock).mockImplementation(async symbol => ({ data: [{ eventSymbol: symbol, bidPrice: 269, askPrice: 271, midPrice: 270 }] })); });

test('sorts legs by strike without changing input and uses fixed side colors', () => {
  const { container } = render(<StrikeLadder legs={legs} />);
  const nodes = Array.from(container.querySelectorAll('.strike-leg'));
  expect(nodes.map(node => node.querySelector('strong')!.textContent)).toEqual(['250', '255', '289', '294']);
  expect(nodes.map(node => node.className)).toEqual(['strike-leg buy', 'strike-leg sell', 'strike-leg sell', 'strike-leg buy']);
  expect(legs[0].strike).toBe(294);
  expect(screen.getAllByText(/VENTA/)).toHaveLength(2); expect(screen.getAllByText(/COMPRA/)).toHaveLength(2);
});
test.each([[272, false], [240, true], [300, true]])('places spot %s inside or outside the short-strike range', (spot, outside) => {
  const { container } = render(<StrikeLadder legs={legs} spot={spot} />);
  const marker = container.querySelector('.strike-spot') as HTMLElement;
  expect(marker.classList.contains('outside')).toBe(outside);
  const x = parseFloat(marker.style.left);
  expect(outside ? x < 30 || x > 70 : x >= 30 && x <= 70).toBe(true);
  expect(marker).toHaveTextContent(spot.toFixed(2));
});
test.each([null, undefined, 0, NaN])('does not draw a fabricated spot when price is %s', spot => {
  const { container } = render(<StrikeLadder legs={legs} spot={spot} />);
  expect(container.querySelector('.strike-spot')).toBeNull();
  expect(container.querySelectorAll('.strike-leg')).toHaveLength(4);
});
test('credit spreads have a one-sided range', () => {
  const { container, rerender } = render(<StrikeLadder legs={legs.filter(leg => leg.type === 'PUT')} spot={270} />);
  expect(container.querySelector('.strike-spot')).not.toHaveClass('outside');
  rerender(<StrikeLadder legs={legs.filter(leg => leg.type === 'PUT')} spot={252} />);
  expect(container.querySelector('.strike-spot')).toHaveClass('outside');
  rerender(<StrikeLadder legs={legs.filter(leg => leg.type === 'CALL')} spot={295} />);
  expect(container.querySelector('.strike-spot')).toHaveClass('outside');
});
test('row formats API values, leaves risk neutral and keeps the current marker out of compact logs', () => {
  const { container, rerender } = render(<PositionRow position={{ ...position, spot: 270 }} />);
  expect(screen.getByText('IRON CONDOR')).toBeInTheDocument();
  expect(screen.getByText('37 DTE')).toBeInTheDocument();
  expect(screen.getByText('$384.00').style.color).toBe('');
  expect(screen.getByText('+$2.50')).toBeInTheDocument();
  rerender(<PositionRow compact position={{ ...position, spot: 270 }} />);
  expect(container.querySelector('.strike-spot')).toBeNull(); expect(screen.queryByText('Resultado abierto')).not.toBeInTheDocument();
});
test('fallback requests one quote per symbol across rows, then the stream overrides it', async () => {
  const data = { ...position, symbol: 'TEST-QUOTE' };
  const { container } = render(<React.StrictMode><LivePositionRow position={data} /><LivePositionRow position={data} /></React.StrictMode>);
  await waitFor(() => expect(container.querySelectorAll('.strike-spot')).toHaveLength(2));
  expect(fetchQuote).toHaveBeenCalledTimes(1);
  expect(within(screen.getAllByRole('article')[0]).getByText('270.00')).toBeInTheDocument();
  act(() => useMarketStore.getState().updatePrice('TEST-QUOTE', { price: 275 } as any));
  expect(within(screen.getAllByRole('article')[0]).getByText('275.00')).toBeInTheDocument();
});
