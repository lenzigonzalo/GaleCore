import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MainDemo } from './MainDemo';
import { useAccountStore } from '../store/useAccountStore';
import { useGexStore } from '../store/useGexStore';
import { useTerminalStore } from '../store/useTerminalStore';
import { demoPositions, demoAccount } from './MainDemo.fixture';
jest.mock('../api/client', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));

test('demo explícita conserva cuenta, selección y sesión reales al interactuar', () => {
  const account = useAccountStore.getState();
  const gex = useGexStore.getState();
  const terminal = useTerminalStore.getState();
  const exit = jest.fn(); render(<MainDemo onExit={exit} />);
  expect(screen.getByText('DEMO VISUAL')).toBeInTheDocument();
  expect(screen.getByText(/Todos los datos son ficticios/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'QQQ GEX negativo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Investigar QQQ' }));
  expect(screen.getByRole('complementary', { name: 'Detalle de demostración' })).toHaveTextContent('QQQ');
  expect(useAccountStore.getState()).toBe(account);
  expect(useGexStore.getState()).toBe(gex);
  expect(useTerminalStore.getState()).toBe(terminal);
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar detalle demo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ver cuenta real' }));
  expect(exit).toHaveBeenCalledTimes(1);
});

test('ventanas de gráfico y pérdidas ficticias son coherentes y explícitas', () => {
  render(<MainDemo onExit={() => {}} />);
  expect(screen.getByText('-$185.00')).toBeInTheDocument();
  expect(demoPositions.reduce((sum, p) => sum + p.pnl, 0)).toBe(demoAccount.openPnl);
  fireEvent.click(screen.getByRole('button', { name: '1S' }));
  expect(screen.getByText('5 sesiones de ejemplo · USD')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '1S' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('img', { name: /Curva de equity ficticia/ })).toBeInTheDocument();
});
