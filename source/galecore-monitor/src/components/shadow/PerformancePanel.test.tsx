import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PerformancePanel } from './PerformancePanel';
import { fetchPerformancePanel } from '../../api/shadow';
import { labRequest } from '../../api/lab';
import { tradeCsv } from './TradeLog';
import plainFixture from './__fixtures__/panel_sin_parametros.json';
import illustrativeFixture from './__fixtures__/panel_con_parametros_ilustrativos.json';
import { PerformancePanelResponse } from '../../types/shadow';
import { createChart } from 'lightweight-charts';

jest.mock('../../api/shadow', () => ({ fetchPerformancePanel: jest.fn() }));
jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
jest.mock('lightweight-charts', () => ({ ColorType: { Solid: 'solid' }, LineSeries: {}, AreaSeries: {},
  TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
  createChart: jest.fn(() => ({ addSeries: () => ({ setData: jest.fn() }), timeScale: () => ({ fitContent: jest.fn() }), remove: jest.fn() })),
}));
const extra = { tradesWon: 2, tradesLost: 0, grossProfit: { value: 45, reason: null }, grossLoss: { value: 0, reason: null }, largestWin: { value: 23, reason: null }, winLossRatio: { value: null, reason: 'Sin pérdidas' } };
const context = { maxRisk: 456, pnlPctOfCredit: 50, pnlPctOfMaxRisk: 4.82, gapToPlan: null, entryVix: null, entryIvRank: null, entryUnderlyingPrice: null, exitDte: null };
const plain: PerformancePanelResponse = { ...plainFixture, ...extra, daily: [], openPositions: [], closedTrades: [] };
const illustrative: PerformancePanelResponse = { ...illustrativeFixture, ...extra, daily: [], openPositions: [], closedTrades: [] };
const panelApi = fetchPerformancePanel as jest.MockedFunction<typeof fetchPerformancePanel>;
const labApi = labRequest as jest.Mock;
beforeEach(() => {
  jest.clearAllMocks(); panelApi.mockResolvedValue(plain); labApi.mockResolvedValue({ projects: [] });
  (createChart as jest.Mock).mockImplementation(() => ({ addSeries: () => ({ setData: jest.fn() }), timeScale: () => ({ fitContent: jest.fn() }), remove: jest.fn() }));
});
test('compact metrics show API values and missing reasons in titles, with a folded missing box', async () => {
  render(<PerformancePanel spec={plain.spec} />);
  await screen.findByText('Ganancia total');
  expect(screen.getByText('Sharpe').parentElement).toHaveAttribute('title', plain.sharpe.reason!);
  expect(screen.getByText('Sharpe').parentElement).toHaveTextContent('—');
  const box = screen.getByText(/Qué falta \(/).closest('details')!;
  expect(box.open).toBe(false);
  expect(within(box).getByText(plain.sharpe.reason!)).toBeInTheDocument();
  expect(within(box).queryByText('sin dato')).not.toBeInTheDocument();
  expect(document.querySelectorAll('.metric-overview section')).toHaveLength(4);
  expect(screen.queryByText('SHADOW · simulado')).not.toBeInTheDocument();
  expect(screen.queryByText('Muestra chica')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Actualizar' })).not.toBeInTheDocument();
  expect(screen.getByText('Máxima caída').parentElement).toHaveTextContent('$0.00');
  expect(screen.getByText('Riesgo abierto').parentElement).toHaveTextContent('$1,822.00');
  expect(screen.getByText('Ganancia total').parentElement).toHaveTextContent('+$45.00');
  expect(labApi).not.toHaveBeenCalled();
});

test('renders the illustrative reference fixture without inventing defaults', async () => {
  panelApi.mockResolvedValue(illustrative); render(<PerformancePanel spec={plain.spec} />);
  expect(await screen.findByText('Retorno sobre capital')).toBeInTheDocument();
  expect(screen.getByText('Retorno sobre capital').parentElement).toHaveTextContent('+0.5%');
});

test.each([404, 503, 'timeout'])('shows useful error and retries (%s)', async status => {
  panelApi.mockRejectedValueOnce(status === 'timeout' ? new Error('timeout exceeded') : { response: { status } });
  render(<PerformancePanel spec={plain.spec} />);
  const error = await screen.findByRole('alert');
  expect(error).toHaveTextContent(status === 404 ? 'todavía no tiene posiciones SHADOW' : status === 503 ? 'persistencia disponible' : 'tardó demasiado');
  fireEvent.click(screen.getByText('Reintentar')); await screen.findByText(/Qué falta \(/);
});
test('only sends supplied numeric capital and filters; never profile limits or rates', async () => {
  render(<PerformancePanel spec={plain.spec} referenceCapital={12000} />);
  await screen.findByText(/Qué falta \(/);
  expect(panelApi).toHaveBeenCalledWith({ spec: plain.spec, referenceCapital: 12000 });
  fireEvent.change(screen.getByLabelText('Versión'), { target: { value: '1.0.3' } });
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'custom' } });
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-14' } });
  await waitFor(() => expect(panelApi).toHaveBeenCalledWith({ spec: plain.spec, referenceCapital: 12000, version: '1.0.3', from: '2026-10-01T00:00:00.000Z', to: '2026-10-14T23:59:59.999Z' }));
  expect(screen.getByRole('option', { name: '1.0.5' })).toBeInTheDocument();
});
test.each(['30', '90'])('requests a %s-day UTC period from the API', async period => {
  render(<PerformancePanel spec={plain.spec} />); await screen.findByText(/Qué falta \(/);
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: period } });
  await waitFor(() => expect(panelApi.mock.calls.some(([params]) => params.from && params.to)).toBe(true));
  const params = panelApi.mock.calls.find(([params]) => params.from && params.to)![0];
  expect(new Date(params.to!).getTime() - new Date(params.from!).getTime()).toBe(Number(period) * 86400000);
});
test.each([['RUNNING', 'Corriendo'], ['PAUSED', 'Pausada'], ['STOPPED', 'Detenida'], ['UNKNOWN', 'UNKNOWN']])('shows instance state %s as %s', async (lifecycleState, label) => {
  render(<PerformancePanel spec={plain.spec} instance={{ lifecycleState } as any} />);
  expect(screen.getByText(label)).toBeInTheDocument(); await screen.findByText('Ganancia total');
});
// Synthetic position/calendar rows exercise v2 shape; the metrics above remain the original contract fixtures.
test('uses API daily values, saved open legs and closed trade rows without deriving P&L', async () => {
  panelApi.mockResolvedValue({ ...plain, daily: [{ date: '2026-10-05', pnl: 45, trades: 2 }],
    openPositions: [{ positionId: 'open', version: '1.0.5', structure: 'put_credit_spread', legs: 'SELL PUT 720 2026-11-20', entryAt: plain.asOf, entryDte: 40, currentDte: null, entryCredit: .44, lastSpreadValue: null, unrealizedPnl: null, maxRisk: 456, lastValuedAt: null, valuationProblems: ['cotización no disponible'] }],
    closedTrades: [{ ...context, positionId: 'closed', version: '1.0.3', structure: 'put_credit_spread', legs: '', entryAt: plain.asOf, exitAt: plain.asOf, daysHeld: 5.7, entryCredit: .44, exitDebit: .22, exitReason: 'TAKE_PROFIT', realizedPnl: 22 }],
  });
  render(<PerformancePanel spec={plain.spec} />); await screen.findByText(/Qué falta \(/);
  expect(screen.getByTitle('2026-10-05 · 2 cierre(s)')).toHaveTextContent('+$45.00');
  expect(screen.getByText('SELL PUT 720 2026-11-20')).toBeInTheDocument();
  expect(screen.getByText('cotización no disponible')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Operaciones' }));
  const exits = screen.getByRole('heading', { name: 'Salidas' }).closest('section')!;
  expect(within(exits).getByRole('meter', { name: 'Salidas Toma de ganancia' })).toHaveAttribute('value', '2');
  expect(screen.getByRole('region', { name: 'Log de operaciones' })).toHaveTextContent('+$22.00');
  fireEvent.click(screen.getByRole('tab', { name: 'Resumen' }));
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
    closedTrades: [{ ...context, positionId: 'closed', version: '1.0.3', structure: 'put_credit_spread', legs: '', entryAt: plain.asOf, exitAt: plain.asOf, daysHeld: 5.7, entryCredit: .44, exitDebit: .22, exitReason: reason, realizedPnl: 22 }],
  });
  render(<PerformancePanel spec={plain.spec} />);
  await screen.findByText(/Qué falta \(/);
  fireEvent.click(screen.getByRole('tab', { name: 'Operaciones' }));
  const exits = screen.getByRole('heading', { name: 'Salidas' }).closest('section')!;
  expect(within(exits).getByText(label)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Log de operaciones' })).getByText(label)).toBeInTheDocument();
  expect(within(exits).getByRole('meter', { name: `Salidas ${label}` })).toBeInTheDocument();
});

test('design loads only on opening and stays cached when changing tabs', async () => {
  labApi.mockResolvedValue({ projects: [] }); render(<PerformancePanel spec={plain.spec} />);
  await screen.findByText('Ganancia total'); expect(labApi).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
  await screen.findByText('Esta estrategia no tiene proyecto en el Lab');
  fireEvent.click(screen.getByRole('tab', { name: 'Resumen' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
  expect(labApi).toHaveBeenCalledTimes(1);
});
test('StrictMode does not duplicate the initial panel request', async () => {
  render(<React.StrictMode><PerformancePanel spec={plain.spec} /></React.StrictMode>);
  await screen.findByText('Ganancia total'); expect(panelApi).toHaveBeenCalledTimes(1);
});
test('design matches strategyName, not project id, and uses the existing sheet', async () => {
  labApi.mockResolvedValueOnce({ projects: [{ id: plain.spec, strategyName: 'otra' }, { id: 'project-real', strategyName: plain.spec }] }).mockResolvedValueOnce({ current: { ref: 'v1', approved: true, purpose: 'Diseño asociado', spec_hash: 'hash' } });
  render(<PerformancePanel spec={plain.spec} />); fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
  await screen.findByText('Diseño asociado');
  expect(labApi).toHaveBeenCalledWith('/workspaces/project-real/strategy?view=design', undefined, 65000);
});
test('exports raw API trades as JSON and CSV with escaped text and nullable context', async () => {
  const trade = { ...context, positionId: 'closed', version: '1.0.3', structure: 'spread', legs: 'SELL, "PUT"\n720', entryAt: plain.asOf, exitAt: plain.asOf, daysHeld: 5.7, entryCredit: .44, exitDebit: .22, exitReason: 'TAKE_PROFIT', realizedPnl: 22 };
  panelApi.mockResolvedValue({ ...plain, closedTrades: [trade] });
  const copy = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  URL.createObjectURL = jest.fn().mockReturnValue('blob:export'); URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<PerformancePanel spec={plain.spec} />); await screen.findByText('Ganancia total');
  fireEvent.click(screen.getByRole('tab', { name: 'Operaciones' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copiar JSON' })); await screen.findByText('JSON copiado');
  expect(JSON.parse(copy.mock.calls[0][0])).toEqual([trade]);
  fireEvent.click(screen.getByRole('button', { name: 'Descargar CSV' })); expect(click).toHaveBeenCalledTimes(1);
  expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  const csv = tradeCsv([trade]); expect(csv).toContain('"SELL, ""PUT""\n720"');
  expect(csv).toContain('entryVix,entryIvRank,entryUnderlyingPrice,exitDte');
  expect(csv).toContain('"50","4.82",,,,,'); click.mockRestore();
});
