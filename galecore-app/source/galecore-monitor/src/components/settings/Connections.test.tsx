import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Connections } from './Connections';
import { fetchProviderAuth } from '../../api/terminal';
import { labRequest } from '../../api/lab';
jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
jest.mock('../../api/terminal', () => ({ fetchProviderAuth: jest.fn() }));
jest.mock('./AuthenticationTerminal', () => ({ AuthenticationTerminal: ({ provider, onEnd, onClose }: any) => <div role="region" aria-label="Terminal de autenticación"><code>{provider === 'claude' ? 'claude auth login' : 'codex login'}</code><button onClick={onEnd}>Terminar prueba</button><button onClick={onClose}>Cancelar</button></div> }));
const user = { allow: ['WebFetch(domain:cnn.com)'], ask: [], deny: [] };
const product = { allow: ['Read', 'Bash'], ask: [], deny: ['Bash(git push:*)'] };
beforeEach(() => {
  jest.clearAllMocks();
  (labRequest as jest.Mock).mockImplementation((_: string, body?: any) => Promise.resolve(body ? { product, user: body } : { product, user }));
  (fetchProviderAuth as jest.Mock).mockResolvedValue({ providers: [{ id: 'claude', status: 'authenticated' }, { id: 'codex', status: 'signed-out' }] });
});
test('dos proveedores, estado y terminal con comando correcto; no textos del Lab ni Git', async () => {
  render(<Connections/>);
  await screen.findByText('Cuenta conectada');
  fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
  expect(screen.getByText('Sin autenticar')).toBeInTheDocument();
  expect(screen.queryByText(/Lab|Git|Antes de empezar/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reautenticar Codex' }));
  expect(screen.getByText('codex login')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Claude Code' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Claude Code' }));
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
  fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
  expect(screen.getByRole('button', { name: 'Reautenticar Codex' })).toBeDisabled();
});

test('cada proveedor muestra cuenta y permisos sin duplicar skills ni MCP', async () => {
  render(<Connections/>);
  await screen.findByText('Cuenta conectada');
  fireEvent.click(screen.getByRole('button', { name: 'Permisos' }));
  expect(screen.getByText('Permisos de Claude Code')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
  expect(screen.getByText('Permisos de Codex')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Skills' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Servidores MCP' })).toBeNull();
});

test('Permisos de Claude Code: pestañas Permitir/Preguntar/Denegar, reglas del producto fijas y las propias se agregan y se quitan', async () => {
  localStorage.clear();
  render(<Connections/>);
  await screen.findByText('Cuenta conectada');
  fireEvent.click(screen.getByRole('button', { name: 'Permisos' }));
  const mode = screen.getByRole('combobox', { name: 'Permisos iniciales de Claude Code' });
  expect(mode).toHaveValue('default');
  expect(Array.from(mode.querySelectorAll('option')).map(o => o.textContent)).toEqual(['Preguntar siempre', 'Aceptar ediciones', 'Auto', 'Sólo planear']);
  fireEvent.change(mode, { target: { value: 'plan' } });
  await screen.findByText('WebFetch(domain:cnn.com)');
  expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(expect.arrayContaining(['Permitir 3', 'Preguntar 0', 'Denegar 1']));
  expect(screen.getAllByText('del producto')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Quitar Read' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Nueva regla'), { target: { value: 'Bash(git status:*)' } });
  fireEvent.click(screen.getByRole('button', { name: 'Agregar regla' }));
  await waitFor(() => expect(labRequest).toHaveBeenCalledWith('/permissions/claude', { allow: ['WebFetch(domain:cnn.com)', 'Bash(git status:*)'], ask: [], deny: [] }));
  fireEvent.change(screen.getByLabelText('Nueva regla'), { target: { value: 'hola mundo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Agregar regla' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Herramienta(patrón)');
  fireEvent.click(screen.getByRole('tab', { name: /Denegar/ }));
  expect(screen.getByText('Bash(git push:*)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /Permitir/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Quitar WebFetch(domain:cnn.com)' }));
  await waitFor(() => expect(labRequest).toHaveBeenLastCalledWith('/permissions/claude', { allow: ['Bash(git status:*)'], ask: [], deny: [] }));
  expect(JSON.parse(localStorage.getItem('galecore:lab:chat-prefs') || '{}').modes.claude).toBe('plan');
});

test('Permisos de Codex: menú vertical con los tres modos, el elegido marcado y sin acceso total', async () => {
  localStorage.clear();
  render(<Connections/>);
  await screen.findByText('Cuenta conectada');
  fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
  fireEvent.click(screen.getByRole('button', { name: 'Permisos' }));
  const options = screen.getAllByRole('radio');
  expect(options.map(o => o.querySelector('strong')?.textContent)).toEqual(['Sólo lectura', 'Preguntar', 'Auto']);
  expect(options[1]).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(options[0]);
  expect(options[0]).toHaveAttribute('aria-checked', 'true');
  expect(JSON.parse(localStorage.getItem('galecore:lab:chat-prefs') || '{}').modes).toEqual({ claude: 'default', codex: 'read-only' });
  expect(document.body.innerHTML).not.toMatch(/bypassPermissions|danger-full-access/);
});
