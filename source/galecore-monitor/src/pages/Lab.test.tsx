import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Lab } from './Lab';
import apiClient from '../api/client';
import { fetchShadowMetrics } from '../api/shadow';
import { useTerminalStore } from '../store/useTerminalStore';
jest.mock('../api/shadow', () => ({ fetchShadowMetrics: jest.fn().mockResolvedValue([]) }));
jest.mock('./Today', () => ({ Today: () => <div>Actividad del Lab</div> }));
jest.mock('../api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
beforeEach(() => { (fetchShadowMetrics as jest.Mock).mockResolvedValue([]); });
test('versiones cargadas no implican aprobación; abrir conversación no sustituye sesión', async () => {
  (apiClient.get as jest.Mock).mockResolvedValue({ data: [{ id: 'pcs', name: 'pcs', displayName: 'PCS', version: '1', contentHash: 'sha256:exact', eligibleModes: ['SHADOW'], symbols: ['SPY'], structure: 'PCS' }] });
  useTerminalStore.getState().start('workspace', 'pedido original'); useTerminalStore.getState().setOpen(false);
  const original = useTerminalStore.getState().session;
  render(<Lab onMonitor={() => {}} />);
  expect(await screen.findByText('sha256:exact')).toBeInTheDocument();
  expect(await screen.findByText('No hay métricas de estrategias desplegadas.')).toBeInTheDocument();
  expect(screen.getByText('Cargada no significa aprobada ni en ejecución.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir conversación' }));
  expect(useTerminalStore.getState().session).toBe(original); expect(useTerminalStore.getState().open).toBe(true);
  expect(screen.queryByRole('button', { name: 'Activar' })).not.toBeInTheDocument();
});
test('falla de versiones no afirma que no hay estrategias', async () => {
  (apiClient.get as jest.Mock).mockRejectedValue(new Error('offline'));
  render(<Lab onMonitor={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron leer las versiones.');
  expect(screen.queryByText('No hay versiones cargadas.')).not.toBeInTheDocument();
});
