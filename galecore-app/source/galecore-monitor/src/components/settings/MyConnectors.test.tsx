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
    { id: 'claude.ai Gmail', name: 'Gmail', status: 'failed', enabled: false },
  ],
  codex: [{ id: 'asdk_iol', name: 'IOL invertironline', status: 'connected', enabled: true }],
};
beforeEach(() => jest.resetAllMocks());

test('dos pestañas; sin GaleCore (es de la plataforma); una fila por conector con su estado en español y su interruptor', async () => {
  (labRequest as jest.Mock).mockResolvedValue(data);
  render(<MyConnectors/>);
  const table = await screen.findByRole('table', { name: 'Conectores' });
  expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Claude Code', 'Codex']);
  expect(screen.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute('aria-selected', 'true');
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows.map(r => within(r).getAllByRole('cell')[0].textContent)).toEqual(['IoL', 'Interactive Brokers (IBKR)', 'Gmail']);
  expect(within(rows[0]).getByText('Conectado')).toBeInTheDocument();
  expect(within(rows[1]).getByText('Falta autorizar')).toBeInTheDocument();
  expect(within(rows[2]).getByText('Falla')).toBeInTheDocument();
  expect(screen.getAllByRole('switch').map(s => s.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
  fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
  expect(within(screen.getByRole('table')).getByText('IOL invertironline')).toBeInTheDocument();
  expect(screen.queryByText('Gmail')).toBeNull();
});

test('el interruptor escribe motor, conector y valor en el Lab', async () => {
  (labRequest as jest.Mock).mockImplementation((_: string, body?: any) => Promise.resolve(body ? { ...body } : data));
  render(<MyConnectors/>);
  const toggle = await screen.findByRole('switch', { name: 'IoL' });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  expect(labRequest).toHaveBeenCalledWith('/connectors', { engine: 'claude', id: 'claude.ai IoL', enabled: true });
  fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
  fireEvent.click(screen.getByRole('switch', { name: 'IOL invertironline' }));
  await waitFor(() => expect(labRequest).toHaveBeenCalledWith('/connectors', { engine: 'codex', id: 'asdk_iol', enabled: false }));
});

test('si el Lab rechaza el cambio, el interruptor no miente y se muestra el error', async () => {
  (labRequest as jest.Mock).mockImplementation((_: string, body?: any) => body ? Promise.reject(new Error('No se pudo escribir')) : Promise.resolve(data));
  render(<MyConnectors/>);
  const toggle = await screen.findByRole('switch', { name: 'IoL' });
  fireEvent.click(toggle);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo escribir');
  expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('sin Lab local (producción) es un mensaje de una línea; un error HTTP no se confunde con eso', async () => {
  (labRequest as jest.Mock).mockRejectedValue(new TypeError('Failed to fetch'));
  const { unmount } = render(<MyConnectors/>);
  expect(await screen.findByText(/No encuentro el Lab en esta PC/)).toBeInTheDocument();
  expect(screen.queryByRole('switch')).toBeNull();
  unmount();
  (labRequest as jest.Mock).mockRejectedValue(new Error('Not found'));
  render(<MyConnectors/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Not found');
});
