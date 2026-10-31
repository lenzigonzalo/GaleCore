import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { TickerGrid } from './TickerGrid';
import { fetchMarketDataBatch, fetchPremarketBatch, PremarketQuote } from '../../api/marketdata';
import { useMarketStore } from '../../store/useMarketStore';

jest.mock('../../api/marketdata', () => ({ fetchMarketDataBatch: jest.fn(), fetchPremarketBatch: jest.fn() }));
jest.mock('./TickerCard', () => ({ TickerCard: () => <div>Tarjeta</div> }));

// Cotizaciones sintéticas y reloj controlado: prueban el ciclo de refresco, no disponibilidad del proveedor.
const quote: PremarketQuote = {
  symbol: 'SPY', price: 98, previousClose: 100, previousCloseDate: '2026-10-29', changePercent: -2,
  timestamp: '2026-10-30T12:00:00Z', session: 'premarket', sessionDate: '2026-10-30',
  source: 'DXLink Trade (ETH)/Summary', freshness: 'fresh', reason: null,
};
const props = { symbols: ['SPY'], selectedSymbol: null, onSelect: () => {} };

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-30T12:00:00Z'));
  useMarketStore.setState({ tickers: {} });
  (fetchMarketDataBatch as jest.Mock).mockResolvedValue([
    { symbol: 'SPY', last: 101, open: 99, prevClose: 100, volume: 10, bid: 100, ask: 102 },
  ]);
});
afterEach(() => { jest.useRealTimers(); });

test('premarket consulta sólo la lista activa, espera el pedido y conserva dato viejo ante error', async () => {
  let resolveFirst!: (value: PremarketQuote[]) => void;
  (fetchPremarketBatch as jest.Mock).mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
    .mockRejectedValueOnce(new Error('offline'));
  const { rerender } = render(<TickerGrid {...props} active={false} layout="list" />);
  expect(fetchPremarketBatch).not.toHaveBeenCalled();
  await act(async () => { rerender(<TickerGrid {...props} layout="cards" />); });
  expect(fetchPremarketBatch).not.toHaveBeenCalled();
  await act(async () => { rerender(<TickerGrid {...props} layout="list" />); });
  expect(fetchPremarketBatch).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Premarket no computado')).toBeEmptyDOMElement();
  await act(async () => { jest.advanceTimersByTime(90_000); });
  expect(fetchPremarketBatch).toHaveBeenCalledTimes(1);
  await act(async () => { resolveFirst([quote]); });
  expect(screen.getByText('-2.00%')).toBeInTheDocument();
  expect(screen.getByText('+1.00%')).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(29_999); });
  expect(fetchPremarketBatch).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(fetchPremarketBatch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('-2.00%')).toBeInTheDocument();
  expect(screen.getByText('-2.00%').closest('td')).toHaveAttribute('title', expect.stringContaining('Dato viejo'));
  expect(screen.getByText('-2.00%').closest('td')).toHaveAttribute('title', expect.stringContaining('Falló la actualización'));
  await act(async () => { rerender(<TickerGrid {...props} active={false} layout="list" />); });
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(fetchPremarketBatch).toHaveBeenCalledTimes(2);
});

test('una respuesta posterior al desmontaje no reactiva el polling premarket', async () => {
  let resolveRequest!: (value: PremarketQuote[]) => void;
  (fetchPremarketBatch as jest.Mock).mockReturnValueOnce(new Promise(resolve => { resolveRequest = resolve; }));
  const { unmount } = render(<TickerGrid {...props} layout="list" />);
  await act(async () => {});
  expect(fetchPremarketBatch).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => { resolveRequest([quote]); jest.advanceTimersByTime(120_000); });
  expect(fetchPremarketBatch).toHaveBeenCalledTimes(1);
});

test.each(['missing_extended_hours', 'execution_revised'])('sin tick nuevo conserva sólo el cálculo del día; revisión lo invalida: %s', async reason => {
  const unavailable: PremarketQuote = { ...quote, price: null, changePercent: null, timestamp: null,
    sessionDate: null, session: 'unavailable', freshness: 'unavailable', reason };
  (fetchPremarketBatch as jest.Mock).mockResolvedValueOnce([quote]).mockResolvedValue([unavailable]);
  await act(async () => { render(<TickerGrid {...props} layout="list" />); });
  expect(screen.getByText('-2.00%')).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(30_000); });
  if (reason === 'missing_extended_hours') {
    const cell = screen.getByText('-2.00%').closest('td')!;
    expect(cell).toHaveAttribute('title', expect.stringContaining('Dato viejo'));
    expect(cell).toHaveAttribute('title', expect.stringContaining(quote.timestamp!));
  } else {
    expect(screen.queryByText('-2.00%')).toBeNull();
    expect(screen.getByLabelText('Operación corregida o cancelada; esperando un nuevo dato')).toBeEmptyDOMElement();
  }
  jest.setSystemTime(new Date('2026-10-31T12:00:00Z'));
  await act(async () => { jest.advanceTimersByTime(30_000); });
  expect(screen.queryByText('-2.00%')).toBeNull();
});

test('al abrir se quita toda la columna y se detiene su polling; al cerrar reaparece sin recargar', async () => {
  jest.setSystemTime(new Date('2026-10-30T13:29:59Z'));
  (fetchPremarketBatch as jest.Mock).mockResolvedValue([quote]);
  await act(async () => { render(<TickerGrid {...props} layout="list" />); });
  expect(screen.getByRole('columnheader', { name: 'Premarket' })).toBeInTheDocument();
  expect(fetchPremarketBatch).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(screen.queryByRole('columnheader', { name: 'Premarket' })).toBeNull();
  expect(screen.queryByText('-2.00%')).toBeNull();
  expect(screen.getAllByRole('columnheader')).toHaveLength(6);
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(fetchPremarketBatch).toHaveBeenCalledTimes(1);
  jest.setSystemTime(new Date('2026-10-30T20:00:00Z'));
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(screen.getByRole('columnheader', { name: 'Premarket' })).toBeInTheDocument();
  expect(fetchPremarketBatch).toHaveBeenCalledTimes(2);
});

test.each([false, true])('dentro del horario no muestra premarket con apertura confirmada o sin señal: %s', async confirmed => {
  const now = new Date('2026-10-30T14:00:00Z');
  jest.setSystemTime(now);
  if (confirmed) useMarketStore.getState().updatePrice('SPY', {
    price: 101, size: 1, timestamp: now.toISOString(), extendedTradingHours: false,
  });
  await act(async () => { render(<TickerGrid {...props} layout="list" />); });
  expect(screen.queryByRole('columnheader', { name: 'Premarket' })).toBeNull();
  expect(fetchPremarketBatch).not.toHaveBeenCalled();
});

test('una señal reciente del proveedor permite mostrarla si confirma cierre dentro del horario habitual', async () => {
  const now = new Date('2026-10-30T17:30:00Z');
  jest.setSystemTime(now);
  useMarketStore.getState().updatePrice('SPY', {
    price: 101, size: 1, timestamp: now.toISOString(), extendedTradingHours: true,
  });
  (fetchPremarketBatch as jest.Mock).mockResolvedValue([]);
  await act(async () => { render(<TickerGrid {...props} layout="list" />); });
  expect(screen.getByRole('columnheader', { name: 'Premarket' })).toBeInTheDocument();
  expect(fetchPremarketBatch).toHaveBeenCalledTimes(1);
});

test('reactivar después de la apertura usa la hora actual sin iniciar consultas premarket', async () => {
  jest.setSystemTime(new Date('2026-10-30T13:29:00Z'));
  const { rerender } = render(<TickerGrid {...props} active={false} layout="list" />);
  jest.setSystemTime(new Date('2026-10-30T13:31:00Z'));
  await act(async () => { rerender(<TickerGrid {...props} layout="list" />); });
  expect(screen.queryByRole('columnheader', { name: 'Premarket' })).toBeNull();
  expect(fetchPremarketBatch).not.toHaveBeenCalled();
});
