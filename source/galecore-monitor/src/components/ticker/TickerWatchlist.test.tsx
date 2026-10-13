import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TickerWatchlist } from './TickerWatchlist';
import { TickerState } from '../../types/market';

// Datos sintéticos de prueba; no son snapshots de mercado ni evidencia en vivo.
const ticker: TickerState = {
  symbol: 'SPY', price: 101, open: 90, prevClose: 100, bid: 100, ask: 102,
  lastUpdate: null, isStreaming: false,
  loading: { price: false, ivRank: false, iv: false, gex: false }, error: {},
};

test('no sustituye cierre previo por apertura ni inventa cambio sin precio', () => {
  const { rerender } = render(<TickerWatchlist tickers={[{ ...ticker, prevClose: undefined }]}
    selectedSymbol={null} onSelect={() => {}} />);
  const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
  expect(cells[0]).toHaveTextContent('101.00');
  expect(cells[1]).toHaveTextContent('—');
  expect(cells[2]).toHaveTextContent('—');
  rerender(<TickerWatchlist tickers={[{ ...ticker, price: 0, error: { price: 'Fuente no disponible' } }]}
    selectedSymbol={null} onSelect={() => {}} />);
  expect(screen.getByText('Sin datos')).toHaveAttribute('title', 'Fuente no disponible');
  expect(cells[1]).toHaveTextContent('—');
});

test('muestra cambio contra cierre y conserva selección y retiro como acciones distintas', () => {
  const select = jest.fn(); const remove = jest.fn();
  render(<TickerWatchlist tickers={[ticker]} selectedSymbol="SPY" onSelect={select}
    removableSymbols={['SPY']} onRemoveSymbol={remove} />);
  expect(screen.getByText('+1.00')).toBeInTheDocument();
  expect(screen.getByText('+1.00%')).toBeInTheDocument();
  const symbol = screen.getByRole('button', { name: 'SPY' });
  expect(symbol).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(symbol); expect(select).toHaveBeenCalledWith(null);
  select.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Quitar SPY del seguimiento' }));
  expect(remove).toHaveBeenCalledWith('SPY'); expect(select).not.toHaveBeenCalled();
});

test('no ofrece retirar instrumentos del universo y distingue recepción de origen', () => {
  render(<TickerWatchlist tickers={[ticker]} selectedSymbol={null} onSelect={() => {}} />);
  expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Recepción (ET)' })).toBeInTheDocument();
  expect(screen.getByText(/La hora indica recepción, no origen/)).toBeInTheDocument();
});

test('un error posterior no oculta el último precio disponible',()=>{
  render(<TickerWatchlist tickers={[{...ticker,error:{price:'Falló el refresco'}}]}
    selectedSymbol={null} onSelect={()=>{}}/>);
  expect(screen.getByText('101.00')).toHaveAttribute('title','Falló el refresco');
});
