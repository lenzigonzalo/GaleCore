import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PerformancePanel } from './PerformancePanel';
import { fetchPerformancePanel } from '../../api/shadow';
import { fetchQuote } from '../../api/marketdata';
import { labRequest } from '../../api/lab';
import { tradeCsv } from './TradeLog';
import plainFixture from './__fixtures__/panel_sin_parametros.json';
import illustrativeFixture from './__fixtures__/panel_con_parametros_ilustrativos.json';
import { PerformancePanelResponse } from '../../types/shadow';
import apiClient from '../../api/client';
import { createChart } from 'lightweight-charts';

jest.mock('../../api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../api/shadow', () => ({ fetchPerformancePanel: jest.fn() }));
jest.mock('../../api/marketdata', () => ({ fetchQuote: jest.fn() }));
jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
jest.mock('lightweight-charts', () => ({ ColorType: { Solid: 'solid' }, LineSeries: {}, AreaSeries: {},
  TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
  createChart: jest.fn(() => ({ addSeries: () => ({ setData: jest.fn() }), timeScale: () => ({ fitContent: jest.fn() }), remove: jest.fn() })),
}));
const extra = { tradesWon: 2, tradesLost: 0, grossProfit: { value: 45, reason: null }, grossLoss: { value: 0, reason: null }, largestWin: { value: 23, reason: null }, winLossRatio: { value: null, reason: 'Sin pérdidas' } };
const context = { symbol: 'SPY', legList: [{ side: 'SELL', type: 'PUT', strike: 720, expiration: '2026-11-20' }], maxRisk: 456, pnlPctOfCredit: 50, pnlPctOfMaxRisk: 4.82, gapToPlan: null, entryVix: null, entryIvRank: null, entryUnderlyingPrice: null, exitDte: null };
const plain: PerformancePanelResponse = { ...plainFixture, ...extra, daily: [], openPositions: [], closedTrades: [] };
const illustrative: PerformancePanelResponse = { ...illustrativeFixture, ...extra, daily: [], openPositions: [], closedTrades: [] };
const panelApi = fetchPerformancePanel as jest.MockedFunction<typeof fetchPerformancePanel>;
const labApi = labRequest as jest.Mock;
beforeEach(() => {
  (fetchQuote as jest.Mock).mockImplementation(async symbol => ({ data: [{ eventSymbol: symbol, bidPrice: 725, askPrice: 726, midPrice: 725.5 }] }));
  jest.clearAllMocks(); panelApi.mockResolvedValue(plain); labApi.mockResolvedValue({ projects: [] });
  (createChart as jest.Mock).mockImplementation(() => ({ addSeries: () => ({ setData: jest.fn() }), timeScale: () => ({ fitContent: jest.fn() }), remove: jest.fn() }));
});
test('one metric panel has four groups and four headlines, with reasons only in tooltips', async () => {
  render(<PerformancePanel spec={plain.spec} />);
  await screen.findByText('Ganancia total');
  expect(screen.getByText('Sharpe').parentElement).toHaveAttribute('title', plain.sharpe.reason!);
  expect(screen.getByText('Sharpe').parentElement).toHaveTextContent('—');
  expect(screen.queryByText(/Qué falta/)).not.toBeInTheDocument();
  expect(screen.queryByText(plain.sharpe.reason!)).not.toBeInTheDocument();
  expect(document.querySelectorAll('.metric-columns > section')).toHaveLength(4);
  expect(document.querySelectorAll('.performance-highlights > .performance-stat')).toHaveLength(4);
  expect(screen.queryByText('SHADOW · simulado')).not.toBeInTheDocument();
  expect(screen.queryByText('Muestra chica')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Actualizar' })).not.toBeInTheDocument();
  expect(screen.getByText('Máxima caída').parentElement).toHaveTextContent('$0.00');
  expect(screen.getByText('Riesgo abierto').parentElement).toHaveTextContent('$1,822.00');
  expect(screen.getByText('Ganancia total').parentElement).toHaveTextContent('+$45.00');
  expect(labApi).toHaveBeenCalledWith('/workspaces');
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
  fireEvent.click(screen.getByText('Reintentar')); await screen.findByText('Ganancia total');
});
test('only sends supplied capital and version, and removes period controls', async () => {
  render(<PerformancePanel spec={plain.spec} referenceCapital={12000} />);
  await screen.findByText('Ganancia total');
  expect(panelApi).toHaveBeenCalledWith({ spec: plain.spec, referenceCapital: 12000 });
  expect(screen.queryByLabelText('Período')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Versión'), { target: { value: '1.0.3' } });
  await waitFor(() => expect(panelApi).toHaveBeenCalledWith({ spec: plain.spec, referenceCapital: 12000, version: '1.0.3' }));
  expect(screen.getByRole('option', { name: '1.0.5' })).toBeInTheDocument();
});
test('version selector is absent for a single version', async () => {
  panelApi.mockResolvedValue({ ...plain, byVersion: [plain.byVersion[0]] });
  render(<PerformancePanel spec={plain.spec} />); await screen.findByText('Ganancia total');
  expect(screen.queryByLabelText('Versión')).not.toBeInTheDocument();
});

test.each([['RUNNING', 'Corriendo'], ['PAUSED', 'Pausada'], ['STOPPED', 'Detenida'], ['UNKNOWN', 'UNKNOWN']])('shows instance state %s as %s', async (lifecycleState, label) => {
  render(<PerformancePanel spec={plain.spec} instance={{ lifecycleState } as any} />);
  expect(screen.getByText(label)).toBeInTheDocument(); await screen.findByText('Ganancia total');
});
// Synthetic position/calendar rows exercise v2 shape; the metrics above remain the original contract fixtures.
test('uses API daily values, saved open legs and closed trade rows without deriving P&L', async () => {
  panelApi.mockResolvedValue({ ...plain, daily: [{ date: '2026-10-05', pnl: 45, trades: 2 }],
    openPositions: [{ symbol: 'SPY', legList: [{ side: 'SELL', type: 'PUT', strike: 720, expiration: '2026-11-20' }], positionId: 'open', version: '1.0.5', structure: 'put_credit_spread', legs: 'SELL PUT 720 2026-11-20', entryAt: plain.asOf, entryDte: 40, currentDte: null, entryCredit: .44, lastSpreadValue: null, unrealizedPnl: null, maxRisk: 456, lastValuedAt: null, valuationProblems: ['cotización no disponible'] }],
    closedTrades: [{ ...context, positionId: 'closed', version: '1.0.3', structure: 'put_credit_spread', legs: '', entryAt: plain.asOf, exitAt: plain.asOf, daysHeld: 5.7, entryCredit: .44, exitDebit: .22, exitReason: 'TAKE_PROFIT', realizedPnl: 22 }],
  });
  render(<PerformancePanel spec={plain.spec} />); await screen.findByText('Ganancia total');
  expect(screen.getByTitle('2026-10-05 · 2 cierre(s)')).toHaveTextContent('+$45.00');
  expect(screen.getByText('VENTA PUT')).toBeInTheDocument();
  expect(screen.queryByText('cotización no disponible')).not.toBeInTheDocument();
  expect(screen.getAllByTitle('cotización no disponible')).toHaveLength(2);
  expect(screen.getByText('octubre 2026')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Operaciones' }));
  const exits = screen.getByLabelText('Salidas por motivo');
  expect(exits).toHaveTextContent('Toma de ganancia 2');
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
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
  await screen.findByText('Ganancia total');
  fireEvent.click(screen.getByRole('tab', { name: 'Operaciones' }));
  const exits = screen.getByLabelText('Salidas por motivo');
  expect(within(exits).getByText(label, { exact: false })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Log de operaciones' })).getByText(label)).toBeInTheDocument();
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
});

test('design starts with the page and stays cached when changing tabs', async () => {
  labApi.mockResolvedValue({ projects: [] }); render(<PerformancePanel spec={plain.spec} />);
  await screen.findByText('Ganancia total'); expect(labApi).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Hipótesis:')).not.toBeInTheDocument();
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
test('design matches strategyName and supplies the header independently of the selected tab', async () => {
  labApi.mockResolvedValueOnce({ projects: [{ id: plain.spec, strategyName: 'otra' }, { id: 'project-real', strategyName: plain.spec }] }).mockResolvedValueOnce({ current: { ref: 'v1', approved: true, purpose: 'Diseño asociado', spec_hash: 'hash', hypothesis: { mechanism: 'Mecanismo de prueba', expected_result: 'Objetivo de prueba', capture: '', failure_conditions: [] } } });
  render(<PerformancePanel spec={plain.spec} />); fireEvent.click(screen.getByRole('tab', { name: 'Diseño' }));
  await screen.findByText(/Mecanismo de prueba/);
  expect(screen.getByText(/Objetivo de prueba/)).toBeInTheDocument();
  expect(screen.queryByText('Diseño asociado')).not.toBeInTheDocument();
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
  const log = screen.getByRole('region', { name: 'Log de operaciones' });
  expect(within(log).getAllByRole('columnheader')).toHaveLength(10);
  const row = within(log).getByText('+$22.00').closest('tr')!;
  expect(row.title).toContain('Entrada:'); expect(row.title).toContain('Versión: 1.0.3');
  expect(log.querySelector('.position-row')).toBeNull();
  expect(log.querySelector('.strike-ladder-inline')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copiar JSON' })); await screen.findByText('JSON copiado');
  expect(JSON.parse(copy.mock.calls[0][0])).toEqual([trade]);
  fireEvent.click(screen.getByRole('button', { name: 'Descargar CSV' })); expect(click).toHaveBeenCalledTimes(1);
  expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  const csv = tradeCsv([trade]); expect(csv).toContain('"SELL, ""PUT""\n720"');
  expect(csv).toContain('entryVix,entryIvRank,entryUnderlyingPrice,exitDte');
  expect(csv).toContain('"50","4.82",,,,,'); click.mockRestore();
});

test('the Lab request never blocks panel metrics', async () => {
  labApi.mockReturnValue(new Promise(() => {}));
  render(<PerformancePanel spec={plain.spec} />);
  expect(await screen.findByText('Ganancia total')).toBeInTheDocument();
  expect(panelApi).toHaveBeenCalledTimes(1); expect(labApi).toHaveBeenCalledWith('/workspaces');
});
test('a failed design can be retried without reloading the panel', async () => {
  labApi.mockRejectedValueOnce(new Error('Lab offline'));
  render(<PerformancePanel spec={plain.spec} />); await screen.findByText('Ganancia total');
  fireEvent.click(screen.getByRole('tab', { name: 'Diseño' })); await screen.findByText('Lab offline');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText('Esta estrategia no tiene proyecto en el Lab');
  expect(panelApi).toHaveBeenCalledTimes(1);
});

test('Datos sólo consulta su API al abrir la pestaña, incluso en una estrategia en diseño', async()=>{
 const get=apiClient.get as jest.Mock;get.mockResolvedValue({data:{spec:plain.spec,storage:'Sin historia',lastEvaluationAt:null,items:[]}});
 render(<PerformancePanel spec={plain.spec} inDesign/>);
 await screen.findByText('Esta estrategia no tiene proyecto en el Lab');
 expect(panelApi).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('tab',{name:'Datos'}));
 expect(await screen.findByTitle('Sin historia')).toBeInTheDocument();
 expect(get).toHaveBeenCalledTimes(1);expect(get).toHaveBeenCalledWith('/App/Runtime/Performance/Data',{params:{spec:plain.spec}});
});
test('Abrir en el chat usa el id del proyecto asociado, no el nombre de la spec',async()=>{
 labApi.mockResolvedValueOnce({projects:[{id:'real-project',strategyName:plain.spec}]}).mockResolvedValueOnce({current:{purpose:'Diseño'}});
 const open=jest.fn();render(<PerformancePanel spec={plain.spec} onOpenChat={open}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Abrir en el chat'}));expect(open).toHaveBeenCalledWith('real-project');
});
