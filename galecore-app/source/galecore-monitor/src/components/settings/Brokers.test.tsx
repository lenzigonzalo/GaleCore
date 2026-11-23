import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Brokers } from './Brokers';
import { fetchBrokers, saveIbkrCredentials, saveIolCredentials, setBrokerInclude } from '../../api/brokers';

jest.mock('../../api/brokers');
jest.mock('../account/BrokerAccountCard', () => ({ BrokerAccountCard: () => <p>Formulario de Tastytrade</p> }));

const tasty = { id: 'tastytrade', name: 'Tastytrade', status: 'connected', include: true, description: 'Opciones y acciones de EE.UU.' };
const iol = { id: 'iol', name: 'IOL', status: 'missing', include: true, description: 'Acciones y bonos argentinos' };
const ibkr = { id: 'ibkr', name: 'Interactive Brokers', status: 'soon', include: true, description: 'Mercados globales' };

beforeEach(() => {
  jest.resetAllMocks();
  (fetchBrokers as jest.Mock).mockResolvedValue([tasty, iol, ibkr]);
});

test('muestra los tres brokers con su estado y IBKR sin botón', async () => {
  render(<Brokers />);
  await screen.findByText('Tastytrade');
  expect(within(screen.getByLabelText('Tastytrade')).getByRole('status')).toHaveTextContent('Conectado');
  expect(within(screen.getByLabelText('IOL')).getByRole('status')).toHaveTextContent('Falta conectar');
  const row = screen.getByLabelText('Interactive Brokers');
  expect(within(row).getByRole('status')).toHaveTextContent('Próximamente');
  expect(within(row).queryByRole('button', { name: 'Conectar' })).toBeNull();
  expect(within(row).getByRole('switch')).toBeDisabled();
  expect(within(screen.getByLabelText('IOL')).getByRole('switch')).toBeDisabled();
});

test('IOL guarda usuario y contraseña', async () => {
  (saveIolCredentials as jest.Mock).mockResolvedValue({ ...iol, status: 'connected' });
  render(<Brokers />);
  await screen.findByText('IOL');
  fireEvent.click(within(screen.getByLabelText('IOL')).getByRole('button', { name: 'Conectar' }));
  expect(screen.getByLabelText('Contraseña de IOL')).toHaveAttribute('type', 'password');
  fireEvent.change(screen.getByLabelText('Usuario de IOL'), { target: { value: 'gonza' } });
  fireEvent.change(screen.getByLabelText('Contraseña de IOL'), { target: { value: 'clave-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(saveIolCredentials).toHaveBeenCalledWith('gonza', 'clave-1'));
  await waitFor(() => expect(within(screen.getByLabelText('IOL')).getByRole('status')).toHaveTextContent('Conectado'));
  expect(screen.queryByLabelText('Contraseña de IOL')).toBeNull();
});

test('IOL muestra el error cuando rechaza las credenciales', async () => {
  (saveIolCredentials as jest.Mock).mockRejectedValue({ response: { data: { error: 'IOL rechazó el usuario o la contraseña' } } });
  render(<Brokers />);
  await screen.findByText('IOL');
  fireEvent.click(within(screen.getByLabelText('IOL')).getByRole('button', { name: 'Conectar' }));
  fireEvent.change(screen.getByLabelText('Usuario de IOL'), { target: { value: 'x' } });
  fireEvent.change(screen.getByLabelText('Contraseña de IOL'), { target: { value: 'y' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(await screen.findByText('IOL rechazó el usuario o la contraseña')).toBeInTheDocument();
});

test('IBKR guarda token y Query ID y muestra Probando… mientras espera', async () => {
  const ibkrMissing = { ...ibkr, status: 'missing' };
  (fetchBrokers as jest.Mock).mockResolvedValue([tasty, iol, ibkrMissing]);
  let done: (v: unknown) => void = () => {};
  (saveIbkrCredentials as jest.Mock).mockReturnValue(new Promise(r => { done = r; }));
  render(<Brokers />);
  await screen.findByText('Interactive Brokers');
  fireEvent.click(within(screen.getByLabelText('Interactive Brokers')).getByRole('button', { name: 'Conectar' }));
  expect(screen.getByLabelText('Token de Flex')).toHaveAttribute('type', 'password');
  fireEvent.change(screen.getByLabelText('Token de Flex'), { target: { value: ' tok-1 ' } });
  fireEvent.change(screen.getByLabelText('Query ID'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(await screen.findByRole('button', { name: 'Probando…' })).toBeDisabled();
  expect(saveIbkrCredentials).toHaveBeenCalledWith('tok-1', '123456');
  done({ ...ibkr, status: 'connected', hint: '123456' });
  await waitFor(() => expect(within(screen.getByLabelText('Interactive Brokers')).getByRole('status')).toHaveTextContent('Conectado'));
  expect(screen.queryByLabelText('Token de Flex')).toBeNull();
});

test('IBKR muestra el error cuando rechaza el token', async () => {
  (fetchBrokers as jest.Mock).mockResolvedValue([tasty, iol, { ...ibkr, status: 'missing' }]);
  (saveIbkrCredentials as jest.Mock).mockRejectedValue({ response: { data: { error: 'El token de Flex de IBKR venció; generá uno nuevo en el portal.' } } });
  render(<Brokers />);
  await screen.findByText('Interactive Brokers');
  fireEvent.click(within(screen.getByLabelText('Interactive Brokers')).getByRole('button', { name: 'Conectar' }));
  fireEvent.change(screen.getByLabelText('Token de Flex'), { target: { value: 'x' } });
  fireEvent.change(screen.getByLabelText('Query ID'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(await screen.findByText(/venció/)).toBeInTheDocument();
});

test('el interruptor llama a Include', async () => {
  (setBrokerInclude as jest.Mock).mockResolvedValue({ ...tasty, include: false });
  render(<Brokers />);
  await screen.findByText('Tastytrade');
  const sw = within(screen.getByLabelText('Tastytrade')).getByRole('switch');
  expect(sw).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(sw);
  await waitFor(() => expect(setBrokerInclude).toHaveBeenCalledWith('tastytrade', false));
  await waitFor(() => expect(within(screen.getByLabelText('Tastytrade')).getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
});

test('Tastytrade despliega su formulario y la carga fallida ofrece Reintentar', async () => {
  render(<Brokers />);
  await screen.findByText('Tastytrade');
  fireEvent.click(within(screen.getByLabelText('Tastytrade')).getByRole('button', { name: 'Cambiar' }));
  expect(screen.getByText('Formulario de Tastytrade')).toBeInTheDocument();
});

test('error de carga con Reintentar', async () => {
  (fetchBrokers as jest.Mock).mockRejectedValueOnce({ response: { data: { error: 'Sin conexión' } } });
  render(<Brokers />);
  await screen.findByText('Sin conexión');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText('Tastytrade');
});
