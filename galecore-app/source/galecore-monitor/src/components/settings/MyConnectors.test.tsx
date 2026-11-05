import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MyConnectors } from './MyConnectors';
import { labRequest } from '../../api/lab';
jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
const data = { galecore: { enabled: true }, brokers: { enabled: false, engines: ['codex'] } };
beforeEach(() => jest.resetAllMocks());

test('tabla con encabezados: GaleCore siempre, IBKR e IOL en una sola fila y sin conectores ajenos al producto', async () => {
  (labRequest as jest.Mock).mockResolvedValue(data);
  render(<MyConnectors/>);
  const table = await screen.findByRole('table', { name: 'Conectores' });
  expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Conector', 'Para qué', 'Claude Code', 'Codex', 'Activo']);
  const [galecore, brokers] = within(table).getAllByRole('row').slice(1);
  expect(within(galecore).getByText('GaleCore')).toBeInTheDocument();
  expect(within(galecore).getAllByText('✓')).toHaveLength(2);
  expect(within(galecore).queryByRole('switch')).toBeNull();
  expect(within(brokers).getByText('IBKR e IOL')).toBeInTheDocument();
  expect(within(brokers).getAllByText('—')).toHaveLength(2);
  expect(screen.getAllByRole('switch')).toHaveLength(1);
  expect(screen.queryByText(/Rome2Rio/)).toBeNull();
});

test('el interruptor de IBKR e IOL escribe en el Lab y marca Codex', async () => {
  (labRequest as jest.Mock).mockImplementation((_: string, body?: any) => Promise.resolve(body ? { brokers: { enabled: body.enabled, engines: ['codex'] } } : data));
  render(<MyConnectors/>);
  const toggle = await screen.findByRole('switch');
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  expect(labRequest).toHaveBeenCalledWith('/connectors/brokers', { enabled: true });
  expect(screen.getAllByText('✓')).toHaveLength(3);
});

test('si el Lab rechaza el cambio, el interruptor no miente y se muestra el error', async () => {
  (labRequest as jest.Mock).mockImplementation((_: string, body?: any) => body ? Promise.reject(new Error('No se pudo escribir')) : Promise.resolve(data));
  render(<MyConnectors/>);
  const toggle = await screen.findByRole('switch');
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
