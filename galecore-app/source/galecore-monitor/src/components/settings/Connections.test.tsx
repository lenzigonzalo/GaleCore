import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Connections } from './Connections';
import { labRequest, fetchLabProviderAuth, startCodexLogin, cancelCodexLogin } from '../../api/lab';
jest.mock('../../api/lab', () => ({ labRequest: jest.fn(), fetchLabProviderAuth: jest.fn(), startCodexLogin: jest.fn(), cancelCodexLogin: jest.fn() }));
const user = { allow: ['WebFetch(domain:cnn.com)'], ask: [], deny: [] };
const product = { allow: ['Read', 'Bash'], ask: [], deny: ['Bash(git push:*)'] };
beforeEach(() => {
  jest.clearAllMocks();
  (labRequest as jest.Mock).mockImplementation((_: string, body?: any) => Promise.resolve(body ? { product, user: body } : { product, user }));
  (fetchLabProviderAuth as jest.Mock).mockResolvedValue({ providers: [{ id: 'claude', status: 'authenticated' }, { id: 'codex', status: 'signed-out' }] });
  (startCodexLogin as jest.Mock).mockResolvedValue({ url: 'https://auth.openai.com/codex/device', code: 'YP05-MWBNI' });
  (cancelCodexLogin as jest.Mock).mockResolvedValue({ ok: true });
});
test('estado por motor contra el Lab; Claude sólo informa, Codex ofrece conectar', async () => {
  render(<Connections/>);
  await screen.findByText('Cuenta conectada');
  expect(screen.queryByRole('button', { name: /Reautenticar|Conectar/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
  expect(screen.getByText('Sin autenticar')).toBeInTheDocument();
  expect(screen.queryByText(/Git|Antes de empezar/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Conectar Codex' })).toBeEnabled();
});
test('conectar Codex: muestra enlace y código, copia, consulta cada 3 s y termina al quedar conectado', async () => {
  jest.useFakeTimers();
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  try {
    render(<Connections/>);
    await screen.findByText('Cuenta conectada');
    fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conectar Codex' }));
    expect(await screen.findByText('YP05-MWBNI')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://auth.openai.com/codex/device' })).toHaveAttribute('href', 'https://auth.openai.com/codex/device');
    fireEvent.click(screen.getByRole('button', { name: 'Copiar código' }));
    expect(writeText).toHaveBeenCalledWith('YP05-MWBNI');
    (fetchLabProviderAuth as jest.Mock).mockResolvedValue({ providers: [{ id: 'claude', status: 'authenticated' }, { id: 'codex', status: 'authenticated' }], codexLoginPending: false });
    await act(async () => { jest.advanceTimersByTime(3100); });
    await waitFor(() => expect(screen.queryByText('YP05-MWBNI')).not.toBeInTheDocument());
    expect(screen.getByText('Cuenta conectada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reautenticar Codex' })).toBeInTheDocument();
  } finally { jest.useRealTimers(); }
});
test('cancelar el login lo corta en el Lab', async () => {
  render(<Connections/>);
  await screen.findByText('Cuenta conectada');
  fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
  fireEvent.click(screen.getByRole('button', { name: 'Conectar Codex' }));
  await screen.findByText('YP05-MWBNI');
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(cancelCodexLogin).toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByText('YP05-MWBNI')).not.toBeInTheDocument());
});
test('no instalado en el Lab: sin botón; fallo del Lab no se muestra como conectada; reintento', async () => {
  (fetchLabProviderAuth as jest.Mock).mockResolvedValue({ providers: [{ id: 'claude', status: 'not-installed' }, { id: 'codex', status: 'not-installed' }] });
  render(<Connections/>);
  await screen.findByText('No instalado en el Lab');
  fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
  expect(screen.queryByRole('button', { name: /Conectar|Reautenticar/ })).not.toBeInTheDocument();
  (fetchLabProviderAuth as jest.Mock).mockRejectedValue(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar conexiones' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Cuenta conectada')).not.toBeInTheDocument();
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
