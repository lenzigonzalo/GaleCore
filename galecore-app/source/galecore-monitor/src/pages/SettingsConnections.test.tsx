import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Settings } from './Settings';

jest.mock('../api/space', () => ({ fetchSpace: () => Promise.resolve({ items: [], shared: [] }) }));
jest.mock('../components/settings/Connections', () => ({ Connections: () => <p>Cuenta, permisos y MCP del proveedor</p> }));
jest.mock('../api/connections', () => ({ fetchConnections: () => Promise.resolve({ canEdit: false, storageReady: true, connections: [
  { id: 'fred', name: 'FRED', kind: 'source', owner: 'platform', needsKey: 'required', status: 'connected', origin: 'server', description: 'Series macro' }] }) }));
jest.mock('../components/settings/LocalMcp', () => ({ LocalMcp: () => <p>Lista de conectores</p> }));
jest.mock('../components/account/BrokerAccountCard', () => ({ BrokerAccountCard: () => <p>Formulario de Tastytrade</p> }));

test('Conexiones tiene fuentes, conectores y bróker en pestañas y skills queda en una única sección general', async () => {
  render(<Settings initial="apis"/>);
  expect(screen.getByRole('button', { name: 'Conexiones' })).toHaveAttribute('aria-current', 'page');
  expect(await screen.findByText('FRED')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mis conectores' }));
  expect(screen.getByText('Lista de conectores')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Bróker' }));
  expect(screen.getByText('Formulario de Tastytrade')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Proveedores de IA' }));
  expect(screen.getByText('Cuenta, permisos y MCP del proveedor')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Skills' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
  expect(await screen.findByRole('button', { name: 'Nueva skill' })).toBeInTheDocument();
});
