import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ApiConnections } from './ApiConnections';
import { fetchConnections, saveConnectionKey, testConnection } from '../../api/connections';

jest.mock('../../api/connections');

const fred = { id: 'fred', name: 'FRED', kind: 'source', owner: 'platform', needsKey: 'required', keyLabel: 'API key de FRED',
  status: 'connected', origin: 'database', hint: '1a2b', updatedAt: '2026-11-02T12:00:00Z', description: 'Series macro' };
const fmpSrc = { ...fred, id: 'cboe', name: 'Cboe', needsKey: 'none', status: 'not-needed', origin: null, hint: undefined, description: 'Volatilidad' };
const tasty = { id: 'tastytrade', name: 'Tastytrade', kind: 'broker', owner: 'personal', needsKey: 'none', status: 'not-needed', origin: null, description: 'Datos y cuenta' };
const av = { id: 'alphavantage', name: 'Alpha Vantage', kind: 'mcp', owner: 'personal', needsKey: 'none', status: 'local', origin: null, description: 'Conector MCP' };
const make = (over: object = {}, list: object[] = [fred, fmpSrc, tasty, av]) =>
  ({ canEdit: true, storageReady: true, connections: list, ...over });

beforeEach(() => {
  jest.resetAllMocks();
  (fetchConnections as jest.Mock).mockResolvedValue(make());
});

test('renders the list from the API without any prefilled input', async () => {
  render(<ApiConnections />);
  await screen.findByText('FRED');
  expect(screen.getByText('••••1a2b')).toBeInTheDocument();
  expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Fuente', 'Descripción', 'Requiere API key', 'API key', 'Estado', 'Probar']);
  expect(screen.getByText('Cboe')).toBeInTheDocument();
  expect(screen.getByText('De la plataforma')).toBeInTheDocument();
  expect(screen.queryByText('Tastytrade')).toBeNull();
  expect(screen.queryByText('Alpha Vantage')).toBeNull();
  expect(document.querySelectorAll('input').length).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
  expect((screen.getByLabelText('API key de FRED') as HTMLInputElement).value).toBe('');
});

test('platform sources are grouped by country', async () => {
  (fetchConnections as jest.Mock).mockResolvedValue(make({}, [{ ...fred, group: 'Estados Unidos' }, { ...fmpSrc, id: 'bcra', name: 'BCRA', group: 'Argentina' }]));
  render(<ApiConnections />);
  await screen.findByText('BCRA');
  expect(screen.getByRole('columnheader', { name: 'Estados Unidos' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Argentina' })).toBeInTheDocument();
});

test('non-admin sees no edit buttons', async () => {
  (fetchConnections as jest.Mock).mockResolvedValue(make({ canEdit: false }));
  render(<ApiConnections />);
  await screen.findByText('FRED');
  expect(screen.queryByRole('button', { name: 'Cambiar' })).toBeNull();
  expect(screen.getByText('Solo un admin puede cambiar las claves.')).toBeInTheDocument();
});

test('storage not ready shows its message and no edit', async () => {
  (fetchConnections as jest.Mock).mockResolvedValue(make({ storageReady: false, storageMessage: 'Falta la clave de cifrado' }));
  render(<ApiConnections />);
  await screen.findByText('Falta la clave de cifrado');
  expect(screen.queryByRole('button', { name: 'Cambiar' })).toBeNull();
});

test('saving calls PUT with the value and clears the input', async () => {
  (saveConnectionKey as jest.Mock).mockResolvedValue({ ...fred, hint: '9z9z' });
  render(<ApiConnections />);
  await screen.findByText('FRED');
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
  const input = screen.getByLabelText('API key de FRED');
  expect(input).toHaveAttribute('type', 'password');
  fireEvent.change(input, { target: { value: 'secreta-123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(saveConnectionKey).toHaveBeenCalledWith('fred', 'secreta-123'));
  await screen.findByText('••••9z9z');
  expect(screen.queryByLabelText('API key de FRED')).toBeNull();
  expect(document.body.innerHTML).not.toContain('secreta-123');
});

test('Probar marca la fuente con ✗ y deja el motivo en el tooltip', async () => {
  (testConnection as jest.Mock).mockResolvedValue({ ok: false, message: 'FRED rechazó la clave (401)', at: '2026-11-02T12:00:00Z' });
  render(<ApiConnections />);
  await screen.findByText('FRED');
  const row = screen.getByLabelText('FRED');
  expect(within(row).getByRole('status')).toHaveTextContent('✓ Conectado');
  fireEvent.click(within(row).getByRole('button', { name: 'Probar' }));
  await waitFor(() => expect(within(row).getByRole('status')).toHaveTextContent('✗ Con error'));
  expect(within(row).getByRole('status')).toHaveAttribute('title', 'FRED rechazó la clave (401)');
});

test('sin clave cargada ofrece Agregar; una fuente sin clave muestra No, ✓ y no se prueba', async () => {
  (fetchConnections as jest.Mock).mockResolvedValue(make({}, [{ ...fred, status: 'missing', origin: null, hint: undefined }, fmpSrc]));
  render(<ApiConnections />);
  await screen.findByText('FRED');
  const row = screen.getByLabelText('FRED');
  expect(within(row).getByRole('button', { name: 'Agregar' })).toBeInTheDocument();
  expect(within(row).getByRole('status')).toHaveTextContent('✗ Sin clave');
  const free = screen.getByLabelText('Cboe');
  expect(within(free).getByText('No')).toBeInTheDocument();
  expect(within(free).getByRole('status')).toHaveTextContent('✓ Conectado');
  expect(within(free).getByRole('button', { name: 'Probar' })).toBeDisabled();
});
