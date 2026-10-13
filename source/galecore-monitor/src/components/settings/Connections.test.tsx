import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Connections } from './Connections';
import { fetchProviderAuth } from '../../api/terminal';
jest.mock('../../api/terminal', () => ({ fetchProviderAuth: jest.fn() }));
jest.mock('./AuthenticationTerminal', () => ({ AuthenticationTerminal: ({ provider, onEnd, onClose }: any) => <div role="region" aria-label="Terminal de autenticación"><code>{provider === 'claude' ? 'claude auth login' : 'codex login'}</code><button onClick={onEnd}>Terminar prueba</button><button onClick={onClose}>Cancelar</button></div> }));
beforeEach(() => {
  jest.clearAllMocks();
  (fetchProviderAuth as jest.Mock).mockResolvedValue({ providers: [{ id: 'claude', status: 'authenticated' }, { id: 'codex', status: 'signed-out' }] });
});
test('dos proveedores, estado y terminal con comando correcto; no textos del Lab ni Git', async () => {
  render(<Connections/>);
  await screen.findByText('Cuenta conectada');
  expect(screen.getByText('Sin autenticar')).toBeInTheDocument();
  expect(screen.queryByText(/Lab|Git|Antes de empezar/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reautenticar Codex' }));
  expect(screen.getByText('codex login')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reautenticar Claude Code' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reautenticar Claude Code' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Reautenticar Claude Code' }));
  expect(screen.getByText('claude auth login')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Terminar prueba' }));
  await waitFor(() => expect(fetchProviderAuth).toHaveBeenCalledTimes(3));
});
test('no instalado y fallo de servicio no se muestran como cuenta conectada; reintento', async () => {
  (fetchProviderAuth as jest.Mock).mockResolvedValue({ providers: [{ id: 'claude', status: 'not-installed' }, { id: 'codex', status: 'unknown' }] });
  render(<Connections/>);
  await screen.findByText('No instalado');
  expect(screen.getByRole('button', { name: 'Reautenticar Claude Code' })).toBeDisabled();
  (fetchProviderAuth as jest.Mock).mockRejectedValue(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar conexiones' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Cuenta conectada')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reautenticar Codex' })).toBeDisabled();
});
