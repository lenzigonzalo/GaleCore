import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Main } from './Main';
import { useAccountStore } from '../store/useAccountStore';
import { fetchShadowMetrics } from '../api/shadow';
jest.mock('../components/account/AccountSummary', () => ({ AccountSummary: () => <div>Lectura de cuenta</div> }));
jest.mock('./Today', () => ({ Today: () => <div>Claves del día</div> }));
jest.mock('../api/shadow', () => ({ fetchShadowMetrics: jest.fn() }));
const load = fetchShadowMetrics as jest.Mock;
beforeEach(() => { useAccountStore.getState().reset(); load.mockReset(); });
test('no confunde fallo de posiciones o métricas con cuenta vacía', async () => {
  useAccountStore.getState().failPositions(); load.mockRejectedValue(new Error('offline'));
  render(<Main onNavigate={() => {}} />);
  expect(await screen.findByText('No se pudieron leer los resultados SHADOW.')).toBeInTheDocument();
  expect(screen.getByText(/No se pudieron leer las posiciones/)).toBeInTheDocument();
  expect(screen.queryByText('La última lectura no contiene posiciones abiertas.')).not.toBeInTheDocument();
});
test('distingue falta de lectura y lleva a destinos reales', async () => {
  load.mockResolvedValue([]); const navigate = jest.fn();
  render(<Main onNavigate={navigate} />);
  expect(screen.getByText('Todavía no se leyeron las posiciones.')).toBeInTheDocument();
  expect(await screen.findByText('No hay métricas de estrategias desplegadas.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mercado y gráficos' })); expect(navigate).toHaveBeenCalledWith('gex');
});
test('conserva pérdidas y advierte valuación parcial sin convertir null en cero', async () => {
  useAccountStore.getState().setPositions([]);
  load.mockResolvedValue([{ contentHash: 'sha256:test', specName: 'PCS', specVersion: '1', positionsOpen: 2,
    positionsClosed: 0, realizedPnl: null, unrealizedPnl: -125.25, openPositionsNotValued: 1 }]);
  render(<Main onNavigate={() => {}} />);
  expect(await screen.findByText('-$125.25')).toBeInTheDocument();
  expect(screen.getByText('Sin cierres')).toBeInTheDocument();
  expect(screen.getByText('1 sin valuar · resultado parcial')).toBeInTheDocument();
  expect(screen.getByText('La última lectura no contiene posiciones abiertas.')).toBeInTheDocument();
});
