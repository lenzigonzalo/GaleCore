import React from 'react';
import { render, screen } from '@testing-library/react';
import { Resumen, Calendario } from './Resumen';
import { useAccountStore } from '../store/useAccountStore';
import { useMarketStore } from '../store/useMarketStore';
jest.mock('../api/client', () => ({ __esModule: true, default: { get: jest.fn().mockResolvedValue({ data: { data: [] } }) } }));

beforeEach(() => { useAccountStore.getState().reset(); useMarketStore.setState({ tickers: {} }); });

const overview = {
  asOf: '2026-10-15T17:00:00Z', netLiq: 2525.63, cash: 2663.63, buyingPower: 663.63, dayPnl: 6.5, dayPnlPct: 0.26, openPnl: 3.5,
  maxRisk: 1860, maxRiskPct: 73.64, maxRiskLimitPct: 4.5,
  exposure: { spyEquivalentShares: 6.23, spyEquivalentDollars: 4796.7, theta: 2.52, vega: -17.13,
    byUnderlying: [{ symbol: 'SPY', dollarDelta: 4796.7, beta: 1, maxRisk: 1860 }] },
  attention: [{ kind: 'gestion', title: 'SPY put spread · vence 20/11: llegó a la toma de ganancia (52 % del crédito)' },
    { kind: 'evento', title: 'Hoy: precios mayoristas de EE. UU. (PPI)' }],
  positions: [{ id: 'SPY|2026-11-20', symbol: 'SPY', structure: 'PUT_CS', expiration: '2026-11-20', dte: 36, quantity: 1,
    shortPutStrike: 730, longPutStrike: 710, shortCallStrike: null, longCallStrike: null, spot: 770, pnl: 8, pnlPct: 5.7,
    takeProfit: 70, stopLoss: -280, targetSource: 'reglas' }],
  missing: [],
};

test('Inicio muestra lo que calcula la API: cuenta, riesgo, exposición y lo que pide atención', async () => {
  const api = require('../api/client').default;
  api.get.mockImplementation((url: string) => Promise.resolve({ data: url.includes('Overview') ? overview : { data: [] } }));
  render(<Resumen onNavigate={() => {}} />);
  expect(await screen.findByText('$2,526')).toBeInTheDocument();
  expect(screen.getByText('+$6.50')).toBeInTheDocument();
  expect(screen.getByText(/\$1,860/)).toHaveClass('neg');
  expect(screen.getByText('6.2 SPY · $4,797')).toBeInTheDocument();
  expect(screen.getByText('Put spread')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Strikes 710 / 730, precio 770.00' })).toBeInTheDocument();
  expect(screen.getByText('20/11 · 36 d')).toBeInTheDocument();
  expect(screen.getByText('+$70.00')).toBeInTheDocument();
  expect(screen.getByText('-$280.00')).toBeInTheDocument();
  expect(screen.getByText(/llegó a la toma de ganancia/)).toBeInTheDocument();
  expect(screen.getByText('Hoy: precios mayoristas de EE. UU. (PPI)')).toBeInTheDocument();
  expect(screen.queryByText(/SHADOW|Concentración/)).not.toBeInTheDocument();
});

test('sin cuenta vinculada lo dice en vez de mostrar una cuenta vacía', async () => {
  const api = require('../api/client').default;
  api.get.mockImplementation((url: string) => url.includes('Overview')
    ? Promise.reject({ response: { data: { code: 'broker_account_not_linked' } } }) : Promise.resolve({ data: { data: [] } }));
  render(<Resumen onNavigate={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/No tenés una cuenta de bróker configurada/);
  expect(screen.queryByText('$0')).not.toBeInTheDocument();
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

