import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LocalMcp } from './LocalMcp';
import { fetchLocalMcp, toggleLocalMcp } from '../../api/localMcp';
jest.mock('../../api/localMcp', () => ({ fetchLocalMcp: jest.fn(), toggleLocalMcp: jest.fn() }));
const data = { workspace: 'test-project', status: 'configuration-only', servers: [{ id: 'a', name: 'sample', provider: 'codex', context: 'Todos los proyectos', scope: 'Usuario', enabled: true, transport: 'stdio', file: 'config.toml', revision: 'r' }] };
beforeEach(() => { jest.resetAllMocks(); (fetchLocalMcp as jest.Mock).mockResolvedValue(data); });
test('provider separation and configuration status are explicit', async () => {
  render(<LocalMcp/>);
  await screen.findByText('Sin MCP configurados');
  expect(screen.queryByRole('switch')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
  expect(screen.getByRole('switch', { name: 'Habilitar sample' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('Configuración local · conexión sin comprobar')).toBeInTheDocument();
});
test('toggle waits for actual save and shows new-session guidance', async () => {
  (toggleLocalMcp as jest.Mock).mockResolvedValue({ ...data, servers: [{ ...data.servers[0], enabled: false }] });
  render(<LocalMcp/>); await screen.findByText('Sin MCP configurados');
  fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
  expect(toggleLocalMcp).toHaveBeenCalledWith(data.servers[0], false);
  expect(screen.getByText(/Abrí una sesión nueva de Codex/)).toBeInTheDocument();
});
test('conflict does not falsely change the switch', async () => {
  (toggleLocalMcp as jest.Mock).mockRejectedValue(new Error('La configuración cambi?'));
  render(<LocalMcp/>); await screen.findByText('Sin MCP configurados');
  fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
  fireEvent.click(screen.getByRole('switch'));
  await screen.findByRole('alert');
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});
