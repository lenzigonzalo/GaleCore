import React from 'react';
import { render, screen } from '@testing-library/react';
import { ShadowOverview } from './ShadowOverview';
import { fetchShadowMetrics } from '../api/shadow';
import { useAccountStore } from '../store/useAccountStore';
jest.mock('../api/shadow', () => ({ fetchShadowMetrics: jest.fn() }));
const load = fetchShadowMetrics as jest.Mock;
test('conserva pérdidas y advierte valuación parcial sin convertir null en cero', async () => {
  useAccountStore.getState().setPositions([]);
  load.mockResolvedValue([{ contentHash: 'sha256:test', specName: 'PCS', specVersion: '1', positionsOpen: 2,
    positionsClosed: 0, realizedPnl: null, unrealizedPnl: -125.25, openPositionsNotValued: 1 }]);
  render(<ShadowOverview onMonitor={() => {}} />);
  expect(await screen.findByText('-$125.25')).toBeInTheDocument();
  expect(screen.getByText('Sin cierres')).toBeInTheDocument();
  expect(screen.getByText('1 sin valuar · resultado parcial')).toBeInTheDocument();
});

test('fallo de métricas no se confunde con ausencia de ejecuciones', async () => {
  load.mockRejectedValue(new Error('offline'));
  render(<ShadowOverview onMonitor={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron leer los resultados SHADOW.');
  expect(screen.queryByText('No hay métricas de estrategias desplegadas.')).not.toBeInTheDocument();
});
