import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CalendarDock } from './CalendarDock';
import api from '../../api/client';
jest.mock('../../api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-15T12:00:00')); jest.clearAllMocks(); });
afterEach(() => { jest.useRealTimers(); });
test('una fuente fallida conserva el calendario de la otra y muestra detalle legible', async () => {
  const day = new Date(); day.setDate(day.getDate() + 1);
  const date = day.toISOString().slice(0, 10);
  (api.get as jest.Mock).mockImplementation((path: string) => path.includes('Fred') ? Promise.reject(new Error('offline'))
    : Promise.resolve({ data: { data: [{ end: date }], upstreamUrl: 'https://example.test/fed', retrievedAt: new Date().toISOString() } }));
  render(<CalendarDock />);
  const event = await screen.findByRole('button', { name: /Reunión FOMC/ });
  expect(event).toHaveAccessibleName(`${date} · Reunión FOMC`);
  expect(screen.getByText('Agenda actual · últimos 30 días y próximos 45')).toBeInTheDocument();
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
  expect(screen.getByText(/Fecha programada confirmada · después del cierre · EPS esperado 1.98 · resultado no verificado/)).toBeInTheDocument();
});

test('conserva fechas pasadas de Fed y balances reportados dentro de la cobertura sin inventar resultados', async () => {
  (api.get as jest.Mock).mockImplementation((path: string, opts?: any) => {
    if (path.includes('EarningsHistory')) return Promise.resolve({ data: { items: [
      { occurredDate: '2026-10-14', eps: 3.2 }, { occurredDate: '2026-09-01', eps: 2.8 },
    ] } });
    if (path.includes('VolatilityData')) return Promise.resolve({ data: { items: [
      { symbol: 'MSFT', earnings: { expectedReportDate: '2027-01-20' } },
    ] } });
    return Promise.resolve({ data: { data: path.includes('Fed') ? [{ end: '2026-10-13' }] : [],
      upstreamUrl: 'https://example.test/fed', retrievedAt: '2026-10-15T12:00:00Z' } });
  });
  render(<CalendarDock symbols={['MSFT']} />);
  const balance = await screen.findByRole('button', { name: '2026-10-14 · MSFT · balance' });
  expect(screen.getByRole('button', { name: '2026-10-13 · Reunión FOMC' })).toBeInTheDocument();
  expect((api.get as jest.Mock).mock.calls.find(c => String(c[0]).includes('Fred'))[1].params.from).toBe('2026-09-15');
  fireEvent.click(balance);
  expect(screen.getByText('Balance reportado · horario no informado · EPS reportado 3.2')).toBeInTheDocument();
  expect(screen.queryByText(/EPS esperado/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }));
  expect(screen.queryByRole('button', { name: /2026-09-01/ })).toBeNull();
});

test('un histórico fallido se declara sin borrar Fed ni convertir ausencia de EPS en cero', async () => {
  (api.get as jest.Mock).mockImplementation((path: string, opts?: any) => {
    if (path.includes('EarningsHistory')) return opts.params.symbol === 'MSFT' ? Promise.reject(new Error('offline'))
      : Promise.resolve({ data: { items: [{ occurredDate: '2026-10-14', eps: null }] } });
    return Promise.resolve({ data: { items: [], data: path.includes('Fed') ? [{ end: '2026-10-13' }] : [] } });
  });
  render(<CalendarDock symbols={['MSFT', 'AAPL']} />);
  fireEvent.click(await screen.findByRole('button', { name: '2026-10-14 · AAPL · balance' }));
  expect(screen.getByText('Balance reportado · horario no informado · EPS no informado')).toBeInTheDocument();
  expect(screen.getByText('Tastytrade (MSFT): no se pudo actualizar los balances.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '2026-10-13 · Reunión FOMC' })).toBeInTheDocument();
});

test('balance reportado hoy reemplaza la estimación y conserva cero real', async () => {
  (api.get as jest.Mock).mockImplementation((path: string) => {
    if (path.includes('EarningsHistory')) return Promise.resolve({ data: { items: [
      { occurredDate: '2026-10-15', eps: 0 }, { occurredDate: '2026-10-16', eps: 99 },
    ] } });
    if (path.includes('VolatilityData')) return Promise.resolve({ data: { items: [
      { symbol: 'MSFT', earnings: { expectedReportDate: '2026-10-15', estimated: true, consensusEps: 3 } },
    ] } });
    return Promise.resolve({ data: { data: [] } });
  });
  render(<CalendarDock symbols={['MSFT', 'MSFT']} />);
  const balances = await screen.findAllByRole('button', { name: '2026-10-15 · MSFT · balance' });
  expect(balances).toHaveLength(1);
  fireEvent.click(balances[0]);
  expect(screen.getByText('Balance reportado · horario no informado · EPS reportado 0')).toBeInTheDocument();
  expect(screen.queryByText(/EPS esperado/)).toBeNull();
  expect(screen.queryByRole('button', { name: '2026-10-16 · MSFT · balance' })).toBeNull();
  expect((api.get as jest.Mock).mock.calls.filter(c => String(c[0]).includes('EarningsHistory'))).toHaveLength(1);
});

test('agenda reciente pasada sin histórico conserva estimación y no afirma resultado publicado', async () => {
  (api.get as jest.Mock).mockImplementation((path: string) => Promise.resolve({ data: path.includes('VolatilityData')
    ? { items: [{ symbol: 'MSFT', earnings: { expectedReportDate: '2026-10-14', estimated: true, consensusEps: 3 } }] }
    : { data: [], items: [] } }));
  render(<CalendarDock symbols={['MSFT']} />);
  fireEvent.click(await screen.findByRole('button', { name: '2026-10-14 · MSFT · balance' }));
  expect(screen.getByText(/Fecha estimada.*EPS esperado 3.*resultado no verificado/)).toBeInTheDocument();
  expect(screen.queryByText(/EPS reportado/)).toBeNull();
});

test('enero consulta también el año anterior para la ventana de últimos 30 días', async () => {
  jest.setSystemTime(new Date('2027-01-05T12:00:00Z'));
  (api.get as jest.Mock).mockResolvedValue({ data: { data: [] } });
  render(<CalendarDock />);
  await screen.findByText('Agenda actual · últimos 30 días y próximos 45');
  expect((api.get as jest.Mock).mock.calls.find(c => String(c[0]).includes('Fed'))[1].params.years).toBe('2026,2027');
  expect((api.get as jest.Mock).mock.calls.find(c => String(c[0]).includes('Fred'))[1].params.from).toBe('2026-12-06');
});
