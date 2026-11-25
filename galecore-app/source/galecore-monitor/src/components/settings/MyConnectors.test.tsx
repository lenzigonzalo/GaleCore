import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MyConnectors } from './MyConnectors';
import { labRequest } from '../../api/lab';
jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
const data = {
  galecore: { enabled: true },
  claude: [
    { id: 'claude.ai IoL', name: 'IoL', status: 'connected', enabled: false },
    { id: 'claude.ai Interactive Brokers (IBKR)', name: 'Interactive Brokers (IBKR)', status: 'needs-auth', enabled: true },
    { id: 'claude.ai Gmail', name: 'Gmail', status: 'failed', enabled: false, tools: [
      { name: 'get_message', label: 'Get message', group: 'read', fixed: false, value: 'allow' },
      { name: 'search_threads', label: 'Search threads', group: 'read', fixed: false, value: 'allow' },
      { name: 'send_message', label: 'Send message', group: 'write', fixed: false, value: 'ask' },
      { name: 'trash_message', label: 'Trash message', group: 'write', fixed: false, value: 'deny' },
    ] },
  ],
  codex: [{ id: 'asdk_iol', name: 'IOL invertironline', status: 'connected', enabled: true, tools: [
    { name: 'get_balance', label: 'Get balance', group: 'read', fixed: false, value: 'allow' },
    { name: 'validate_order', label: 'Validate order', group: 'write', fixed: true, value: 'deny' },
  ] }],
  engines: { claude: { ask: true }, codex: { ask: false } },
};
beforeEach(() => jest.resetAllMocks());

test('los del motor elegido; sin GaleCore (es de la plataforma); una fila por conector con su estado en español y su interruptor', async () => {
  (labRequest as jest.Mock).mockResolvedValue(data);
  const { rerender } = render(<MyConnectors engine="claude"/>);
  const table = await screen.findByRole('table', { name: 'Conectores' });
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows.map(r => within(r).getAllByRole('cell')[0].textContent)).toEqual(['IoL', 'Interactive Brokers (IBKR)', 'Gmail']);
  expect(within(rows[0]).getByText('Conectado')).toBeInTheDocument();
  expect(within(rows[1]).getByText('Falta autorizar')).toBeInTheDocument();
  expect(within(rows[2]).getByText('Falla')).toBeInTheDocument();
  expect(screen.getAllByRole('switch').map(s => s.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
  rerender(<MyConnectors engine="codex"/>);
  expect(within(screen.getByRole('table')).getByText('IOL invertironline')).toBeInTheDocument();
  expect(screen.queryByText('Gmail')).toBeNull();
});

test('el interruptor escribe motor, conector y valor en el Lab', async () => {
  (labRequest as jest.Mock).mockImplementation((_: string, body?: any) => Promise.resolve(body ? { ...body } : data));
  const { rerender } = render(<MyConnectors engine="claude"/>);
  const toggle = await screen.findByRole('switch', { name: 'IoL' });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  expect(labRequest).toHaveBeenCalledWith('/connectors', { engine: 'claude', id: 'claude.ai IoL', enabled: true });
  rerender(<MyConnectors engine="codex"/>);
  fireEvent.click(screen.getByRole('switch', { name: 'IOL invertironline' }));
  await waitFor(() => expect(labRequest).toHaveBeenCalledWith('/connectors', { engine: 'codex', id: 'asdk_iol', enabled: false }));
});

test('si el Lab rechaza el cambio, el interruptor no miente y se muestra el error', async () => {
  (labRequest as jest.Mock).mockImplementation((_: string, body?: any) => body ? Promise.reject(new Error('No se pudo escribir')) : Promise.resolve(data));
  render(<MyConnectors engine="claude"/>);
  const toggle = await screen.findByRole('switch', { name: 'IoL' });
  fireEvent.click(toggle);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo escribir');
  expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('sin Lab local (producción) es un mensaje de una línea; un error HTTP no se confunde con eso', async () => {
  (labRequest as jest.Mock).mockRejectedValue(new TypeError('Failed to fetch'));
  const { unmount } = render(<MyConnectors engine="claude"/>);
  expect(await screen.findByText(/No encuentro el Lab en esta PC/)).toBeInTheDocument();
  expect(screen.queryByRole('switch')).toBeNull();
  unmount();
  (labRequest as jest.Mock).mockRejectedValue(new Error('Not found'));
  render(<MyConnectors engine="claude"/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Not found');
});

test('Reconectar abre la cuenta del motor en otra pestaña: urgente si no está conectado, siempre disponible', async () => {
  (labRequest as jest.Mock).mockResolvedValue(data);
  const { rerender } = render(<MyConnectors engine="claude"/>);
  const table = await screen.findByRole('table', { name: 'Conectores' });
  const links = within(table).getAllByRole('link', { name: 'Reconectar' });
  expect(links).toHaveLength(3);
  expect(links.every(l => l.getAttribute('href') === 'https://claude.ai/settings/connectors' && l.getAttribute('target') === '_blank')).toBe(true);
  expect(links.map(l => l.classList.contains('is-urgent'))).toEqual([false, true, true]);
  rerender(<MyConnectors engine="codex"/>);
  expect(screen.getByRole('link', { name: 'Reconectar' })).toHaveAttribute('href', 'https://chatgpt.com/#settings/Connectors');
});

test('al abrir un conector: Permisos de herramientas agrupadas, selector por grupo (Personalizado si difieren) y por herramienta', async () => {
  (labRequest as jest.Mock).mockImplementation((_: string, body?: any) => Promise.resolve(body ? { ok: true } : data));
  render(<MyConnectors engine="claude"/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Configurar Gmail' }));
  expect(screen.getByText('Permisos de herramientas')).toBeInTheDocument();
  const read = screen.getByRole('region', { name: 'Herramientas de sólo lectura' });
  const write = screen.getByRole('region', { name: 'Herramientas de escritura y borrado' });
  const sel = (el: HTMLElement, name: string) => within(el).getByRole('combobox', { name }) as HTMLSelectElement;
  expect(sel(read, 'Permiso de herramientas de sólo lectura').value).toBe('allow');
  expect(sel(write, 'Permiso de herramientas de escritura y borrado').value).toBe('mixed');
  expect(within(write).getByRole('option', { name: 'Personalizado' })).toBeInTheDocument();
  expect(Array.from(sel(read, 'Permiso de Get message').options).map(o => o.textContent)).toEqual(['✓ Siempre permitir', '✋ Pedir aprobación', '⊘ Nunca']);
  expect(sel(write, 'Permiso de Send message').value).toBe('ask');
  fireEvent.change(sel(write, 'Permiso de Send message'), { target: { value: 'allow' } });
  await waitFor(() => expect(labRequest).toHaveBeenCalledWith('/connectors/tools', { engine: 'claude', id: 'claude.ai Gmail', tool: 'send_message', value: 'allow' }));
  await waitFor(() => expect(sel(write, 'Permiso de Send message').value).toBe('allow'));
  fireEvent.change(sel(write, 'Permiso de herramientas de escritura y borrado'), { target: { value: 'deny' } });
  await waitFor(() => expect(labRequest).toHaveBeenCalledWith('/connectors/tools', { engine: 'claude', id: 'claude.ai Gmail', group: 'write', value: 'deny' }));
  await waitFor(() => expect(sel(write, 'Permiso de Send message').value).toBe('deny'));
  expect(sel(write, 'Permiso de herramientas de escritura y borrado').value).toBe('deny');
  fireEvent.click(screen.getByRole('button', { name: '‹ Conectores' }));
  expect(screen.getByRole('table', { name: 'Conectores' })).toBeInTheDocument();
});

test('Codex no ofrece Pedir aprobación (exec no puede pedirla) y lo fijo queda deshabilitado en Nunca', async () => {
  (labRequest as jest.Mock).mockResolvedValue(data);
  render(<MyConnectors engine="codex"/>);
  fireEvent.click(await screen.findByRole('button', { name: 'IOL invertironline' }));
  const fixed = screen.getByRole('combobox', { name: 'Permiso de Validate order' }) as HTMLSelectElement;
  expect(fixed).toBeDisabled(); expect(fixed.value).toBe('deny');
  expect(Array.from((screen.getByRole('combobox', { name: 'Permiso de Get balance' }) as HTMLSelectElement).options).map(o => o.value)).toEqual(['allow', 'deny']);
  expect(screen.getByRole('combobox', { name: 'Permiso de herramientas de escritura y borrado' })).toBeDisabled();
});
