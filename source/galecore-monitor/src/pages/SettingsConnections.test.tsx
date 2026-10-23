import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Settings } from './Settings';

jest.mock('../api/space', () => ({ fetchSpace: () => Promise.resolve({ items: [], shared: [] }) }));
jest.mock('../components/settings/Connections', () => ({ Connections: () => <p>Cuenta, permisos y MCP del proveedor</p> }));
jest.mock('../components/account/BrokerAccountCard', () => ({ BrokerAccountCard: () => <p>Formulario de Tastytrade</p> }));

test('APIs y bróker tienen entrada propia y skills queda en una única sección general', async () => {
  render(<Settings initial="apis"/>);
  expect(screen.getByRole('button', { name: 'API y claves' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('FRED')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cuenta de bróker' }));
  expect(screen.getByText('Formulario de Tastytrade')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Proveedores de IA' }));
  expect(screen.getByText('Cuenta, permisos y MCP del proveedor')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Skills' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
  expect(await screen.findByRole('button', { name: 'Nueva skill' })).toBeInTheDocument();
});
