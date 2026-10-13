import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LocalMcp } from './LocalMcp';
import { fetchLocalMcp, toggleLocalMcp } from '../../api/localMcp';
jest.mock('../../api/localMcp', () => ({ fetchLocalMcp: jest.fn(), refreshLocalMcp: jest.fn(), toggleLocalMcp: jest.fn() }));
const data = { workspace: 'test-project', status: 'configuration-only', servers: [{ id: 'a', name: 'sample', provider: 'codex', context: 'Todos los proyectos', scope: 'Usuario', enabled: true, transport: 'stdio', file: 'config.toml', revision: 'r' }] };
beforeEach(() => { jest.resetAllMocks(); (fetchLocalMcp as jest.Mock).mockResolvedValue(data); });
test('provider separation and configuration status are explicit', async () => {
  render(<LocalMcp/>);
  await screen.findByText('Sin MCP configurados');
  expect(screen.queryByRole('switch')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
  expect(screen.getByRole('switch', { name: 'Habilitar sample' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('Sin comprobar')).toBeInTheDocument();
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

test('unapproved shared server is disabled and cannot be toggled from the panel', async () => {
  (fetchLocalMcp as jest.Mock).mockResolvedValue({ ...data, servers: [{ ...data.servers[0], provider: 'claude', enabled: false, approvalRequired: true }] });
  render(<LocalMcp/>);
  const control = await screen.findByRole('switch');
  expect(control).toBeDisabled();
  expect(control).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(control);
  expect(toggleLocalMcp).not.toHaveBeenCalled();
});

test('account connectors and plugins are shown in the active workspace rather than the legacy local project', async () => {
  (fetchLocalMcp as jest.Mock).mockResolvedValue({ ...data, workspace: 'active', checkedAt: '2026-10-13T20:00:00Z', servers: [
    { ...data.servers[0], id: 'legacy', provider: 'claude', name: 'datafeed', context: 'other-project', origin: 'local' },
    { ...data.servers[0], id: 'cloud', provider: 'claude', name: 'claude.ai Google Drive', displayName: 'Google Drive', context: 'active', origin: 'account', runtimeStatus: 'connected' },
    { ...data.servers[0], id: 'broker', provider: 'claude', name: 'claude.ai IBKR', displayName: 'IBKR', context: 'active', origin: 'account', runtimeStatus: 'needs-auth' },
    { ...data.servers[0], id: 'plugin', provider: 'claude', name: 'plugin:finance:gmail', context: 'active', origin: 'plugin', runtimeStatus: 'unverified' },
  ] });
  render(<LocalMcp/>);
  await screen.findByRole('heading', { name: 'Google Drive' });
  expect(screen.queryByRole('heading', { name: 'datafeed' })).toBeNull();
  expect(screen.getByText('Conectado')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'IBKR' } });
  expect(screen.getByRole('heading', { name: 'IBKR' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Google Drive' })).toBeNull();
  expect(screen.getByText(/Requiere autenticaci/)).toBeInTheDocument();
});
