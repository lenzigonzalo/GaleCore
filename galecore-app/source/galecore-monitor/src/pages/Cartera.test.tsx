import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { Cartera } from './Cartera';
import { fetchConsolidatedPortfolio } from '../api/portfolio';

jest.mock('../api/portfolio');
const mocked = fetchConsolidatedPortfolio as jest.Mock;

const data = {
  asOf: '2026-11-24T02:14:48Z', baseCurrency: 'USD', totalUsd: 18120.08,
  fx: { pair: 'ARS/USD', name: 'MEP', casa: 'bolsa', rate: 1743.1 },
  brokers: [
    { id: 'ibkr', name: 'IBKR', status: 'ok', isClose: true, reportDate: '2026-11-20', totalUsd: 9773.25, warnings: ['Dato del cierre del 2026-11-20.'] },
    { id: 'tastytrade', name: 'Tastytrade', status: 'error', message: 'Sesión vencida', isClose: false, warnings: [] },
    { id: 'x', name: 'Oculto', status: 'excluded', isClose: false, warnings: [] },
  ],
  positions: [
    { broker: 'ibkr', symbol: 'SPY', description: 'SPDR', quantity: 9.3, lastPrice: 689.81, currency: 'USD', marketValueUsd: 6426.68, pnlUsd: -212.21 },
    { broker: 'iol', symbol: 'YPFD', quantity: 80, lastPrice: 5835, currency: 'ARS', marketValueUsd: 267.8, pnlUsd: 16.52 },
  ],
  cash: [{ broker: 'iol', currency: 'ARS', amount: 1000, account: 'AR' }, { broker: 'iol', currency: 'USD', amount: 0 }],
  notes: [],
};

beforeEach(() => { mocked.mockReset(); mocked.mockResolvedValue(data); });

test('muestra total, cierre de IBKR, broker caído con su mensaje y efectivo sin convertir', async () => {
  render(<Cartera />);
  expect(screen.getByText('Leyendo la cartera…')).toBeInTheDocument();
  expect(await screen.findByText('$18,120.08')).toBeInTheDocument();
  expect(screen.getByText('Cierre del 20/11')).toBeInTheDocument();
  expect(screen.queryByText('Dato del cierre del 2026-11-20.')).toBeNull();
  expect(screen.getByText('Tastytrade')).toBeInTheDocument();
  expect(screen.getByText('Sesión vencida')).toBeInTheDocument();
  expect(screen.queryByText('Oculto')).toBeNull();
  expect(screen.getByText('ARS 5,835.00')).toBeInTheDocument();
  expect(screen.getByText('sin convertir')).toBeInTheDocument();
  expect(screen.getByText(/MEP \(venta\) \$1,743\.10/)).toBeInTheDocument();
});

test('lee una vez al abrir y sin polling', async () => {
  jest.useFakeTimers();
  try {
    render(<Cartera />);
    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(1));
    await act(async () => { jest.advanceTimersByTime(10 * 60_000); });
    expect(mocked).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test('error de la API: una línea de aviso', async () => {
  mocked.mockRejectedValue(new Error('x'));
  render(<Cartera />);
  expect(await screen.findByText('No se pudo leer la cartera.')).toBeInTheDocument();
});
