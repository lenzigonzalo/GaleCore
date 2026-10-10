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
  expect(load).not.toHaveBeenCalled();
  expect(screen.queryByText('Resultados de estrategias')).not.toBeInTheDocument();
  expect(screen.getByText(/No se pudieron leer las posiciones/)).toBeInTheDocument();
  expect(screen.queryByText('La última lectura no contiene posiciones abiertas.')).not.toBeInTheDocument();
});
test('distingue falta de lectura y lleva a destinos reales', async () => {
  load.mockResolvedValue([]); const navigate = jest.fn();
  render(<Main onNavigate={navigate} />);
  expect(screen.getByText('Todavía no se leyeron las posiciones.')).toBeInTheDocument();
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir Mercado' })); expect(navigate).toHaveBeenCalledWith('gex');
});

test('cuenta sin vincular ofrece conexión y evita errores de posiciones duplicados', async () => {
  useAccountStore.getState().setErrorBalances({ message: 'not linked', brokerAccountIssue: 'not_linked' });
  useAccountStore.getState().failPositions(); load.mockResolvedValue([]);
  const connect = jest.fn(); render(<Main onNavigate={() => {}} onConnectBroker={connect} />);
  fireEvent.click(screen.getByRole('button', { name: 'Vincular cuenta' })); expect(connect).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/No se pudieron leer las posiciones/)).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Posiciones abiertas' })).not.toBeInTheDocument();
  expect(load).not.toHaveBeenCalled();
});

test('enruta al laboratorio y no publica avisos simulados en gestión', () => {
  const navigate = jest.fn(); render(<Main onNavigate={navigate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir Lab' }));
  expect(navigate).toHaveBeenCalledWith('lab');
  expect(screen.queryByText('Claves del día')).not.toBeInTheDocument();
  expect(screen.getByText('Historia no disponible')).toBeInTheDocument();
});
