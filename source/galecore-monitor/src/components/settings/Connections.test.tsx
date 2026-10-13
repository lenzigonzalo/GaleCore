import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Connections } from './Connections';
import { labRequest } from '../../api/lab';
import { fetchBrokerAccount } from '../../api/brokerAccount';
import { fetchSpace } from '../../api/space';
jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
jest.mock('../../api/brokerAccount', () => ({ fetchBrokerAccount: jest.fn() }));
jest.mock('../../api/space', () => ({ fetchSpace: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  (labRequest as jest.Mock).mockImplementation(async path => path === '/state'
    ? { providers: [{ id: 'claude', installed: true }, { id: 'codex', installed: false }] }
    : { commits: [], changes: 2 });
  (fetchBrokerAccount as jest.Mock).mockResolvedValue({ linked: true });
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [], shared: [] });
});
test('instalación y vinculación no se presentan como autenticación comprobada; guía no inicia sesiones', async () => {
  const onBroker = jest.fn(), onLab = jest.fn();
  render(<Connections onBroker={onBroker} onData={() => {}} onLab={onLab}/>);
  await screen.findByText('Lab disponible');
  expect(screen.getAllByText('Autenticación sin comprobar')).toHaveLength(2);
  expect(screen.getByText('No instalado')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: /Conectar o reautenticar/ })[0]);
  expect(screen.getByText('claude auth login')).toBeInTheDocument();
  expect(labRequest).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: /Administrar credenciales/ }));
  expect(onBroker).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: /Abrir Lab/ }));
  expect(onLab).toHaveBeenCalledTimes(1);
});
test('fallas independientes y reintento descartan resultados anteriores', async () => {
  (labRequest as jest.Mock).mockRejectedValue(new Error('offline'));
  render(<Connections onBroker={() => {}} onData={() => {}}/>);
  await screen.findByText('Lab sin acceso');
  expect(screen.getByText('Espacio accesible')).toBeInTheDocument();
  expect(screen.getByText('Sin acceso al historial')).toBeInTheDocument();
  (labRequest as jest.Mock).mockImplementation(async path => path === '/state' ? { providers: [] } : { commits: [], changes: 0 });
  (fetchSpace as jest.Mock).mockRejectedValue(new Error('denied'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Volver a comprobar' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Volver a comprobar' }));
  await screen.findByText('Lab disponible');
  await screen.findByText('Sin acceso');
  expect(screen.queryByText('Espacio accesible')).not.toBeInTheDocument();
  expect(screen.getByText('Historial accesible')).toBeInTheDocument();
});
