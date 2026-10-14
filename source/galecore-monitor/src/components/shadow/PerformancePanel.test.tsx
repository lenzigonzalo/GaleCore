import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PerformancePanel } from './PerformancePanel';
import { fetchPerformancePanel, fetchShadowStatus } from '../../api/shadow';
import { fetchReferenceCapital } from '../../api/space';
import plainFixture from './__fixtures__/panel_sin_parametros.json';
import illustrativeFixture from './__fixtures__/panel_con_parametros_ilustrativos.json';
import { PerformancePanelResponse } from '../../types/shadow';
import { createChart } from 'lightweight-charts';

jest.mock('../../api/shadow', () => ({ fetchPerformancePanel: jest.fn(), fetchShadowStatus: jest.fn() }));
jest.mock('../../api/space', () => ({ fetchReferenceCapital: jest.fn() }));
jest.mock('lightweight-charts', () => ({ ColorType: { Solid: 'solid' }, LineSeries: {}, AreaSeries: {},
  TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
  createChart: jest.fn(() => ({ addSeries: () => ({ setData: jest.fn() }), timeScale: () => ({ fitContent: jest.fn() }), remove: jest.fn() })),
}));
const plain: PerformancePanelResponse = { ...plainFixture, daily: [], openPositions: [], closedTrades: [] };
const illustrative: PerformancePanelResponse = { ...illustrativeFixture, daily: [], openPositions: [], closedTrades: [] };
const panelApi = fetchPerformancePanel as jest.MockedFunction<typeof fetchPerformancePanel>;
const capitalApi = fetchReferenceCapital as jest.MockedFunction<typeof fetchReferenceCapital>;
const statusApi = fetchShadowStatus as jest.MockedFunction<typeof fetchShadowStatus>;
beforeEach(() => {
  jest.clearAllMocks(); panelApi.mockResolvedValue(plain); capitalApi.mockResolvedValue(undefined);
  (createChart as jest.Mock).mockImplementation(() => ({ addSeries: () => ({ setData: jest.fn() }), timeScale: () => ({ fitContent: jest.fn() }), remove: jest.fn() }));
  statusApi.mockResolvedValue({ instances: [] } as any);
});
test('shows five key figures, n/d in the table and deduplicated reasons only in Qué falta', async () => {
  render(<PerformancePanel spec={plain.spec} />);
  const missing = await screen.findByRole('heading', { name: 'Qué falta' });
  const box = missing.closest('section')!;
  expect(within(box).getByText(plain.sharpe.reason!)).toBeInTheDocument();
  expect(screen.getAllByText(plain.sharpe.reason!)).toHaveLength(1);
  expect(within(box).getByText(plain.avgLoss.reason!)).toBeInTheDocument();
  expect(within(box).queryByText('sin dato')).not.toBeInTheDocument();
  expect(screen.getByText('Pérdida promedio').closest('tr')).toHaveTextContent('n/d');
  expect(document.querySelectorAll('.performance-key-numbers .performance-stat')).toHaveLength(5);
  expect(screen.queryByText('Datos de la curva')).not.toBeInTheDocument();
  expect(screen.queryByText('Fuente')).not.toBeInTheDocument();
  expect(screen.queryByText(plain.regime.edges)).not.toBeInTheDocument();
  expect(screen.queryByText('Mide la muestra, no dice si hay edge.')).not.toBeInTheDocument();
  expect(screen.getByText('SHADOW · simulado')).toHaveAttribute('title', plain.source);
  expect(screen.getByText('2 cerradas sin contexto de régimen')).toBeInTheDocument();
  expect(panelApi).toHaveBeenCalledWith({ spec: plain.spec });
});
test('renders illustrative limits and available references with unsigned risk values', async () => {
  panelApi.mockResolvedValue(illustrative); render(<PerformancePanel spec={plain.spec} />);
  await screen.findByRole('heading', { name: 'Qué falta' });
  const row = screen.getByRole('progressbar', { name: 'open_risk' }).closest('tr')!;
  expect(row).toHaveTextContent('$1,822.00 / $1,000.00'); expect(row).toHaveTextContent('Margen: −$822.00');
  expect(row).not.toHaveTextContent('+$');
  expect(screen.getByRole('progressbar', { name: 'reserve' }).closest('tr')).toHaveTextContent('Margen: $6,178.00');
  expect(screen.getByText('Riesgo máximo abierto').closest('tr')).toHaveTextContent('$1,822.00');
  expect(screen.getByText('Máx. caída').parentElement).toHaveTextContent('$0.00');
  expect(screen.getByText('Realizado').parentElement).toHaveTextContent('+$45.00');
  expect(screen.getByText('Esperanza/op.').parentElement).toHaveTextContent('+$22.50');
  expect(screen.getByText('Peor operación').closest('tr')).toHaveTextContent('+$22.00');
  expect(screen.getByText('−0.2%')).toBeInTheDocument();
  expect(screen.getByText('Muestra · operaciones').closest('tr')).toHaveTextContent('2 / 30');
});
test.each([404, 503, 'timeout'])('shows useful error and retries (%s)', async status => {
  panelApi.mockRejectedValueOnce(status === 'timeout' ? new Error('timeout exceeded') : { response: { status } });
  render(<PerformancePanel spec={plain.spec} />);
  const error = await screen.findByRole('alert');
  expect(error).toHaveTextContent(status === 404 ? 'todavía no tiene posiciones SHADOW' : status === 503 ? 'persistencia disponible' : 'tardó demasiado');
  fireEvent.click(screen.getByText('Reintentar')); await screen.findByRole('heading', { name: 'Qué falta' });
});
test('only sends supplied numeric capital and filters; never profile limits or rates', async () => {
  capitalApi.mockResolvedValue(12000); render(<PerformancePanel spec={plain.spec} />);
  await screen.findByRole('heading', { name: 'Qué falta' });
  expect(panelApi).toHaveBeenCalledWith({ spec: plain.spec, referenceCapital: 12000 });
  fireEvent.change(screen.getByLabelText('Versión'), { target: { value: '1.0.3' } });
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'custom' } });
  fireEvent.change(screen.getByLabelText('Desde (UTC)'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('Hasta (UTC)'), { target: { value: '2026-10-14' } });
  await waitFor(() => expect(panelApi).toHaveBeenCalledWith({ spec: plain.spec, referenceCapital: 12000, version: '1.0.3', from: '2026-10-01T00:00:00.000Z', to: '2026-10-14T23:59:59.999Z' }));
  expect(screen.getByRole('option', { name: '1.0.5' })).toBeInTheDocument();
});
test.each(['30', '90'])('requests a %s-day UTC period from the API', async period => {
  render(<PerformancePanel spec={plain.spec} />); await screen.findByRole('heading', { name: 'Qué falta' });
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: period } });
  await waitFor(() => expect(panelApi.mock.calls.some(([params]) => params.from && params.to)).toBe(true));
  const params = panelApi.mock.calls.find(([params]) => params.from && params.to)![0];
  expect(new Date(params.to!).getTime() - new Date(params.from!).getTime()).toBe(Number(period) * 86400000);
});
test.each([['RUNNING', 'corriendo'], ['PAUSED', 'pausada'], ['STOPPED', 'detenida'], ['UNKNOWN', 'UNKNOWN']])('shows instance state %s as %s', async (lifecycleState, label) => {
  statusApi.mockResolvedValue({ instances: [{ instanceId: 'test', specName: plain.spec, lifecycleState, updatedAt: plain.asOf }] } as any);
  render(<PerformancePanel spec={plain.spec} />); expect(await screen.findByText(label)).toBeInTheDocument();
});
// Synthetic position/calendar rows exercise v2 shape; the metrics above remain the original contract fixtures.
test('uses API daily values, saved open legs and closed trade rows without deriving P&L', async () => {
  panelApi.mockResolvedValue({ ...plain, daily: [{ date: '2026-10-05', pnl: 45, trades: 2 }],
    openPositions: [{ positionId: 'open', version: '1.0.5', structure: 'put_credit_spread', legs: 'SELL PUT 720 2026-11-20', entryAt: plain.asOf, entryDte: 40, currentDte: null, entryCredit: .44, lastSpreadValue: null, unrealizedPnl: null, maxRisk: 456, lastValuedAt: null, valuationProblems: ['cotización no disponible'] }],
    closedTrades: [{ positionId: 'closed', version: '1.0.3', structure: 'put_credit_spread', legs: '', entryAt: plain.asOf, exitAt: plain.asOf, daysHeld: 5.7, entryCredit: .44, exitDebit: .22, exitReason: 'TAKE_PROFIT', realizedPnl: 22 }],
  });
  render(<PerformancePanel spec={plain.spec} />); await screen.findByRole('heading', { name: 'Qué falta' });
  expect(screen.getByTitle('2026-10-05 · 2 cierre(s)')).toHaveTextContent('+$45.00');
  expect(screen.getByText('SELL PUT 720 2026-11-20')).toBeInTheDocument();
  expect(screen.getByText('cotización no disponible')).toBeInTheDocument();
  const exits = screen.getByRole('heading', { name: 'Salidas' }).closest('section')!;
  expect(within(exits).getByRole('meter', { name: 'Salidas Toma de ganancia' })).toHaveAttribute('value', '2');
  expect(within(exits).getByText('+$22.00')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Mes siguiente')); expect(screen.queryByTitle('2026-10-05 · 2 cierre(s)')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Mes anterior')); expect(screen.getByTitle('2026-10-05 · 2 cierre(s)')).toBeInTheDocument();
});

test('chart ticks use ET with DST and leave mouse wheel scrolling to the page', async () => {
  render(<PerformancePanel spec={plain.spec} />);
  await waitFor(() => expect(createChart).toHaveBeenCalled());
  const options = (createChart as jest.Mock).mock.calls[0][1];
  const tick = options.timeScale.tickMarkFormatter;
  expect(tick(Date.parse('2026-10-05T19:02:00Z') / 1000, 3)).toBe('15:02 ET');
  expect(tick(Date.parse('2026-12-05T19:02:00Z') / 1000, 3)).toBe('14:02 ET');
  expect(tick(Date.parse('2026-10-05T19:02:51Z') / 1000, 4)).toBe('15:02:51 ET');
  expect(tick(Date.parse('2026-10-06T01:02:00Z') / 1000, 2)).toBe(new Date('2026-10-06T01:02:00Z').toLocaleDateString('es-AR', { timeZone: 'America/New_York', day: 'numeric', month: 'short' }));
  expect(options.handleScroll.mouseWheel).toBe(false);
  expect(options.handleScale.mouseWheel).toBe(false);
});

test.each([['TAKE_PROFIT', 'Toma de ganancia'], ['STOP_LOSS', 'Stop loss'], ['DTE_EXIT', 'Por vencimiento/tiempo'], ['TIME_EXIT', 'Por vencimiento/tiempo'], ['MANUAL', 'MANUAL']])('exit reason %s is shown as %s in both bars and trades', async (reason, label) => {
  panelApi.mockResolvedValue({ ...plain, byExitRule: [{ ...plain.byExitRule[0], key: reason }],
    closedTrades: [{ positionId: 'closed', version: '1.0.3', structure: 'put_credit_spread', legs: '', entryAt: plain.asOf, exitAt: plain.asOf, daysHeld: 5.7, entryCredit: .44, exitDebit: .22, exitReason: reason, realizedPnl: 22 }],
  });
  render(<PerformancePanel spec={plain.spec} />);
  await screen.findByRole('heading', { name: 'Qué falta' });
  const exits = screen.getByRole('heading', { name: 'Salidas' }).closest('section')!;
  expect(within(exits).getAllByText(label)).toHaveLength(2);
  expect(within(exits).getByRole('meter', { name: `Salidas ${label}` })).toBeInTheDocument();
});
