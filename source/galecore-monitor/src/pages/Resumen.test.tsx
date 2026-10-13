import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { Resumen, Calendario } from './Resumen';
import { useAccountStore } from '../store/useAccountStore';
jest.mock('../api/client', () => ({ __esModule: true, default: { get: jest.fn().mockResolvedValue({ data: { data: [] } }) } }));

beforeEach(() => useAccountStore.getState().reset());

test('el resumen usa la cuenta del operador y no capital ni posiciones SHADOW', async () => {
  useAccountStore.getState().setBalances({ accountNumber: 'test', netLiquidatingValue: 12345, buyingPower: 2345, cash: 345 } as any);
  useAccountStore.getState().setPositions([{ symbol: 'SPY', underlyingSymbol: 'SPY', quantity: 2, quantityDirection: 'Long', closePrice: 101, averageOpenPrice: 100, multiplier: 1, instrumentType: 'Equity' }] as any);
  render(<Resumen onNavigate={() => {}} />);
  expect(screen.getByText('$12,345')).toBeInTheDocument();
  expect(screen.getByText('$2.00')).toBeInTheDocument();
  expect(screen.getByText('+1.00%')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Ver cartera/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/SHADOW|capital de referencia|Riesgo abierto/)).not.toBeInTheDocument();
});

test('sin lectura y ante error no presenta una cuenta vacía como lectura real', async () => {
  const { rerender } = render(<Resumen onNavigate={() => {}} />);
  expect(screen.getByText('Sin lectura de posiciones disponible.')).toBeInTheDocument();
  expect(screen.getByText('Sin lectura de la cuenta')).toBeInTheDocument();
  act(() => useAccountStore.getState().failPositions());
  rerender(<Resumen onNavigate={() => {}} />);
  expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron leer las posiciones');
  expect(screen.queryByText('Sin posiciones en la última lectura.')).not.toBeInTheDocument();
});

 test('macro muestra calendario semanal y eventos de GaleCore', async () => {
  const api = require('../api/client').default;
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-15`;
  api.get.mockResolvedValue({ data: { data: [{ date: iso, releaseName: 'Consumer Price Index' }] } });
  render(<Calendario page />);
  expect(await screen.findByText('Inflación (CPI)')).toBeInTheDocument();
  expect(screen.getByText('Lun')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mes anterior' })).toBeDisabled();
 });
