import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrokerAccountCard } from './BrokerAccountCard';
import { fetchBrokerAccount, linkBrokerAccount, unlinkBrokerAccount } from '../../api/brokerAccount';

jest.mock('../../api/brokerAccount', () => ({ fetchBrokerAccount: jest.fn(), linkBrokerAccount: jest.fn(), unlinkBrokerAccount: jest.fn() }));
beforeEach(() => {
  jest.resetAllMocks();
  (fetchBrokerAccount as jest.Mock).mockResolvedValue({ linked: false });
  (linkBrokerAccount as jest.Mock).mockResolvedValue({ linked: true });
  (unlinkBrokerAccount as jest.Mock).mockResolvedValue({ linked: false });
});

test('vincula con el contrato existente y limpia los secretos al guardar', async () => {
  const changed = jest.fn();
  render(<BrokerAccountCard onLinked={changed}/>);
  await screen.findByText('Sin cuenta vinculada.');
  expect(screen.getByRole('button', { name: 'Vincular cuenta' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Número de cuenta'), { target: { value: 'TEST-ACCOUNT' } });
  fireEvent.change(screen.getByLabelText('Refresh token'), { target: { value: 'fixture-token' } });
  fireEvent.change(screen.getByLabelText(/Client secret/), { target: { value: 'fixture-secret' } });
  expect(screen.getByLabelText('Refresh token')).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByRole('button', { name: 'Vincular cuenta' }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(linkBrokerAccount).toHaveBeenCalledWith('TEST-ACCOUNT', 'fixture-token', 'fixture-secret');
  expect(screen.getByLabelText('Refresh token')).toHaveValue('');
  expect(screen.getByLabelText(/Client secret/)).toHaveValue('');
});

test('muestra aplicación propia y desvincula sólo tras confirmar; conserva advertencia de sistema', async () => {
  (fetchBrokerAccount as jest.Mock).mockResolvedValue({ linked: true, broker: 'tastytrade', accountNumber: 'TEST-ACCOUNT', isSystem: true, hasOwnClientSecret: true });
  render(<BrokerAccountCard/>);
  await screen.findByText(/Esta cuenta hoy usa tu propia aplicación OAuth/);
  fireEvent.click(screen.getByRole('button', { name: 'Desvincular' }));
  expect(unlinkBrokerAccount).not.toHaveBeenCalled();
  expect(screen.getByText(/Es la cuenta de sistema:/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(unlinkBrokerAccount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Desvincular' }));
  (fetchBrokerAccount as jest.Mock).mockResolvedValue({ linked: false });
  fireEvent.click(screen.getByRole('button', { name: 'Sí, desvincular' }));
  await screen.findByText('Sin cuenta vinculada.');
  expect(unlinkBrokerAccount).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Número de cuenta')).toHaveValue('');
});

test('un fallo de lectura no afirma una cuenta conectada y permite reintentar', async () => {
  (fetchBrokerAccount as jest.Mock).mockRejectedValue(new Error('Servicio no disponible'));
  render(<BrokerAccountCard/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Servicio no disponible');
  expect(screen.queryByText('Sin cuenta vinculada.')).not.toBeInTheDocument();
  (fetchBrokerAccount as jest.Mock).mockResolvedValue({ linked: false });
  fireEvent.click(screen.getByRole('button', { name: 'Releer' }));
  await screen.findByText('Sin cuenta vinculada.');
});

test('una relectura fallida retira el estado anterior y sus controles', async () => {
  (fetchBrokerAccount as jest.Mock).mockResolvedValue({ linked: true, broker: 'tastytrade', accountNumber: 'TEST-ACCOUNT' });
  render(<BrokerAccountCard/>);
  await screen.findByRole('button', { name: 'Desvincular' });
  (fetchBrokerAccount as jest.Mock).mockRejectedValue(new Error('Lectura fallida'));
  fireEvent.click(screen.getByRole('button', { name: 'Releer' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Lectura fallida');
  expect(screen.queryByRole('button', { name: 'Desvincular' })).not.toBeInTheDocument();
  expect(screen.queryByText('tastytrade')).not.toBeInTheDocument();
});

test('desvincular exitosamente no recupera el estado borrado si falla la consulta posterior', async () => {
  (fetchBrokerAccount as jest.Mock).mockResolvedValue({ linked: true, broker: 'tastytrade', accountNumber: 'TEST-ACCOUNT' });
  const changed = jest.fn();
  render(<BrokerAccountCard onLinked={changed}/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Desvincular' }));
  (fetchBrokerAccount as jest.Mock).mockRejectedValue(new Error('Lectura fallida'));
  fireEvent.click(screen.getByRole('button', { name: 'Sí, desvincular' }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('status')).toHaveTextContent('Cuenta desvinculada.');
  expect(screen.getByRole('alert')).toHaveTextContent('Lectura fallida');
  expect(screen.queryByRole('button', { name: 'Desvincular' })).not.toBeInTheDocument();
  expect(screen.queryByText('TEST-ACCOUNT')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Número de cuenta')).toHaveValue('');
});
