import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CalendarDock } from './CalendarDock';
import api from '../../api/client';
jest.mock('../../api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
test('una fuente fallida conserva el calendario de la otra y muestra detalle legible', async () => {
  const day = new Date(); day.setDate(day.getDate() + 1);
  const date = day.toISOString().slice(0, 10);
  (api.get as jest.Mock).mockImplementation((path: string) => path.includes('Fred') ? Promise.reject(new Error('offline'))
    : Promise.resolve({ data: { data: [{ end: date }], upstreamUrl: 'https://example.test/fed', retrievedAt: new Date().toISOString() } }));
  render(<CalendarDock />);
  const event = await screen.findByRole('button', { name: /Reunión FOMC/ });
  expect(event).toHaveAccessibleName(`${date} · Reunión FOMC`);
  expect(screen.getByText('Agenda actual')).toBeInTheDocument();
  expect(screen.getByText('FRED: no se pudo actualizar el calendario.')).toBeInTheDocument();
  fireEvent.click(event);
  expect(screen.getByRole('link', { name: 'Ver publicación original ↗' })).toHaveAttribute('href', 'https://example.test/fed');
  expect(screen.getByText(/El horario aún no está disponible/)).toBeInTheDocument();
});

test('los balances de la watchlist aparecen en el calendario y el detalle dice cuándo y qué se espera', async () => {
  const day = new Date(); day.setDate(day.getDate() + 2);
  const date = day.toISOString().slice(0, 10);
  (api.get as jest.Mock).mockImplementation((path: string, opts?: any) => path.includes('VolatilityData')
    ? Promise.resolve({ data: { items: [
      { symbol: 'AAPL', earnings: { expectedReportDate: date, timeOfDay: 'AMC', estimated: false, consensusEps: 1.98 } },
      { symbol: 'SPY', earnings: null }] } })
    : Promise.resolve({ data: { data: [], retrievedAt: new Date().toISOString() } }));
  render(<CalendarDock symbols={['AAPL', 'SPY']} />);
  const event = await screen.findByRole('button', { name: `${date} · AAPL · balance` });
  expect((api.get as jest.Mock).mock.calls.find(c => String(c[0]).includes('VolatilityData'))[1].params).toEqual(expect.objectContaining({ symbols: 'AAPL,SPY' }));
  expect(screen.queryByRole('button', { name: /SPY/ })).toBeNull();
  fireEvent.click(event);
  expect(screen.getByText(/Fecha confirmada · después del cierre · EPS esperado 1.98/)).toBeInTheDocument();
});
