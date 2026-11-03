import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LocalMcp } from './LocalMcp';
import { fetchLocalMcp, toggleLocalMcp } from '../../api/localMcp';
jest.mock('../../api/localMcp', () => ({ fetchLocalMcp: jest.fn(), refreshLocalMcp: jest.fn(), toggleLocalMcp: jest.fn() }));
const data = { workspace: 'test-project', status: 'configuration-only', servers: [{ id: 'a', name: 'sample', provider: 'codex', context: 'Todos los proyectos', scope: 'Usuario', enabled: true, transport: 'stdio', file: 'config.toml', revision: 'r' }] };
beforeEach(() => { jest.resetAllMocks(); localStorage.clear(); (fetchLocalMcp as jest.Mock).mockResolvedValue(data); });
test('one list shows both engines and each switch names the engine it acts on', async () => {
  (fetchLocalMcp as jest.Mock).mockResolvedValue({ ...data, workspace: 'active', servers: [
    data.servers[0],
    { ...data.servers[0], id: 'c', provider: 'claude', name: 'claude.ai Alpha Vantage', displayName: 'Alpha Vantage', context: 'active', origin: 'account', runtimeStatus: 'connected' },
  ] });
  render(<LocalMcp/>);
  await screen.findByRole('heading', { name: 'Alpha Vantage' });
  expect(screen.queryByRole('group', { name: 'CLI de las conexiones' })).toBeNull();
  expect(screen.getByRole('switch', { name: 'Habilitar sample en Codex' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('switch', { name: 'Habilitar claude.ai Alpha Vantage en Claude' })).toBeInTheDocument();
  expect(screen.getByText(/Claude · Usuario/)).toBeInTheDocument();
  expect(screen.getByText(/Codex · Usuario/)).toBeInTheDocument();
});
test('toggle waits for actual save and shows new-session guidance', async () => {
  (toggleLocalMcp as jest.Mock).mockResolvedValue({ ...data, servers: [{ ...data.servers[0], enabled: false }] });
  render(<LocalMcp/>);
  const control = await screen.findByRole('switch', { name: 'Habilitar sample en Codex' });
  fireEvent.click(control);
  await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
  expect(toggleLocalMcp).toHaveBeenCalledWith(data.servers[0], false);
  expect(screen.getByText(/Abrí una sesión nueva de Codex/)).toBeInTheDocument();
});
test('conflict does not falsely change the switch', async () => {
  (toggleLocalMcp as jest.Mock).mockRejectedValue(new Error('La configuración cambi?'));
  render(<LocalMcp/>);
  fireEvent.click(await screen.findByRole('switch'));
  await screen.findByRole('alert');
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});

test('unapproved shared server is disabled and cannot be toggled from the panel', async () => {
  (fetchLocalMcp as jest.Mock).mockResolvedValue({ ...data, servers: [{ ...data.servers[0], provider: 'claude', enabled: false, approvalRequired: true }] });
  render(<LocalMcp/>);
  fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
  const control = await screen.findByRole('switch');
  expect(control).toBeDisabled();
  expect(control).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(control);
  expect(toggleLocalMcp).not.toHaveBeenCalled();
});

test('GaleCore favorites hide unrelated account tools and only change the local view', async () => {
  (fetchLocalMcp as jest.Mock).mockResolvedValue({ ...data, workspace: 'active', servers: [
    { ...data.servers[0], id: 'google', provider: 'claude', name: 'claude.ai Google Drive', displayName: 'Google Drive', context: 'active', origin: 'account' },
    { ...data.servers[0], id: 'travel', provider: 'claude', name: 'claude.ai Booking.com', displayName: 'Booking.com', context: 'active', origin: 'account' },
  ] });
  render(<LocalMcp/>);
  await screen.findByRole('heading', { name: 'Google Drive' });
  expect(screen.queryByRole('heading', { name: 'Booking.com' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar en vista GaleCore: Booking.com' }));
  fireEvent.click(screen.getByRole('button', { name: 'GaleCore' }));
  expect(screen.getByRole('heading', { name: 'Booking.com' })).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('galecore.localMcp.favorites.v1') || '[]')).toContain('claude:claude.ai Booking.com');
  expect(toggleLocalMcp).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar en vista GaleCore: Booking.com' }));
  expect(screen.queryByRole('heading', { name: 'Booking.com' })).toBeNull();
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

test('needs-auth account connector of Claude links to claude.ai connectors; Codex has no button', async () => {
  (fetchLocalMcp as jest.Mock).mockResolvedValue({ ...data, workspace: 'active', servers: [
    { ...data.servers[0], id: 'broker', provider: 'claude', name: 'claude.ai IBKR', displayName: 'IBKR', context: 'active', origin: 'account', runtimeStatus: 'needs-auth' },
    { ...data.servers[0], runtimeStatus: 'needs-auth' },
  ] });
  render(<LocalMcp/>);
  const link = await screen.findByRole('link', { name: 'Conectar' });
  expect(link).toHaveAttribute('href', 'https://claude.ai/settings/connectors');
  expect(link).toHaveAttribute('target', '_blank');
  expect(screen.getAllByRole('link', { name: 'Conectar' })).toHaveLength(1);
});
