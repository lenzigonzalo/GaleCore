import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MainDemo } from './MainDemo';
import { useAccountStore } from '../store/useAccountStore';
import { useGexStore } from '../store/useGexStore';
import { useTerminalStore } from '../store/useTerminalStore';
import { demoPositions, demoAccount } from './MainDemo.fixture';
jest.mock('../api/client', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));

test('mercado navega con contexto sin modificar datos o sesiones reales', () => {
  const account = useAccountStore.getState();
  const gex = useGexStore.getState();
  const terminal = useTerminalStore.getState();
  const exit = jest.fn(); render(<MainDemo onExit={exit} />);
  fireEvent.click(within(screen.getByRole('complementary', { name: 'Watchlist' })).getByRole('button', { name: 'Analizar QQQ' }));
  expect(screen.getByRole('heading', { name: 'QQQ · Mercado' })).toBeInTheDocument();
  expect(screen.getByText('GEX negativo', { selector: 'strong' })).toBeInTheDocument();
  expect(useAccountStore.getState()).toBe(account);
  expect(useGexStore.getState()).toBe(gex);
  expect(useTerminalStore.getState()).toBe(terminal);
  fireEvent.click(screen.getByRole('button', { name: 'Ver cuenta real' }));
  expect(exit).toHaveBeenCalledTimes(1);
});

test('estrategia expande posiciones y conserva borradores y consultas por workspace', () => {
  render(<MainDemo onExit={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ver posiciones de SPY Income' }));
  expect(screen.getByRole('button', { name: 'Ver posiciones de SPY Income' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('600 / 595 · PUT')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir workspace de SPY Income' }));
  fireEvent.click(screen.getByRole('button', { name: 'Conversación' }));
  fireEvent.change(screen.getByLabelText('Consulta sobre SPY Income'), { target: { value: '¿Qué afecta el vencimiento?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Resumen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Abrir workspace de QQQ Neutral' }));
  fireEvent.click(screen.getByRole('button', { name: 'Conversación' }));
  expect(screen.getByLabelText('Consulta sobre QQQ Neutral')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Resumen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Abrir workspace de SPY Income' }));
  fireEvent.click(screen.getByRole('button', { name: 'Conversación' }));
  expect(screen.getByLabelText('Consulta sobre SPY Income')).toHaveValue('¿Qué afecta el vencimiento?');
  fireEvent.click(screen.getByRole('button', { name: 'Guardar consulta' }));
  expect(screen.getByText('¿Qué afecta el vencimiento?')).toBeInTheDocument();
  expect(screen.getByText(/Respuesta de ejemplo:/)).toBeInTheDocument();
});

test('hallazgo entra a conversación con evidencia, pérdidas y períodos conservan significado', () => {
  render(<MainDemo onExit={() => {}} />);
  expect(screen.getByText('-$185.00')).toBeInTheDocument();
  expect(demoPositions.reduce((sum, p) => sum + p.pnl, 0)).toBe(demoAccount.openPnl);
  fireEvent.click(screen.getByRole('button', { name: '1S' }));
  expect(screen.getByText('5 sesiones')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '1S' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: /SPY Income · revisar salida/ }));
  expect(screen.getByRole('button', { name: 'Conversación' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText(/Hallazgo seleccionado/)).toBeInTheDocument();
  expect(screen.getByText(/SPY Income · v1 · SPY · 600/)).toBeInTheDocument();
});

test('Cartera muestra contratos y vuelve a su origen después de abrir un detalle', () => {
  render(<MainDemo initialView="account" onExit={() => {}}/>);
  expect(screen.getByRole('heading',{name:'Posiciones abiertas'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Estrategias activas/})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Abrir posición de SPY Income'}));
  expect(screen.getByRole('heading',{name:'SPY Income'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Volver a Cartera'}));
  expect(screen.getByRole('heading',{name:'Cartera'})).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Posiciones abiertas'})).toBeInTheDocument();
});
