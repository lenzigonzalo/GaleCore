import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PerformancePanel } from './PerformancePanel';
import { fetchPerformancePanel } from '../../api/shadow';
import { fetchQuote } from '../../api/marketdata';
import { labRequest } from '../../api/lab';
import plainFixture from './__fixtures__/panel_sin_parametros.json';
import { DISCARD_LABELS, LIMIT_LABELS, PerformancePanelResponse } from '../../types/shadow';
import { discardLabel } from '../../pages/Shadow';
import { exitLabel, legSelectionLabel } from './panelPresentation';

jest.mock('../../api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../api/shadow', () => ({ ...jest.requireActual('../../api/shadow'), fetchPerformancePanel: jest.fn() }));
jest.mock('../../api/marketdata', () => ({ fetchQuote: jest.fn() }));
jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
jest.mock('lightweight-charts', () => ({ ColorType: { Solid: 'solid' }, LineSeries: {}, AreaSeries: {},
  TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
  createChart: jest.fn(() => ({ addSeries: () => ({ setData: jest.fn() }), timeScale: () => ({ fitContent: jest.fn() }), remove: jest.fn() })),
}));

const extra = { tradesWon: 1, tradesLost: 0, grossProfit: { value: 98, reason: null }, grossLoss: { value: 0, reason: null }, largestWin: { value: 98, reason: null }, winLossRatio: { value: null, reason: 'Sin pérdidas' } };
const leg = (side: string, type: string, strike: number) => ({ side, type, strike, expiration: '2026-11-20' });
const base = { version: '1', exitAt: plainFixture.asOf, entryAt: plainFixture.asOf, daysHeld: 3, exitDebit: null, gapToPlan: null, entryVix: null, entryIvRank: null, entryUnderlyingPrice: null, exitDte: null };
const panel = (closedTrades: PerformancePanelResponse['closedTrades'], openPositions: PerformancePanelResponse['openPositions'] = [], over: Partial<PerformancePanelResponse> = {}): PerformancePanelResponse =>
  ({ ...plainFixture, ...extra, daily: [], openPositions, closedTrades, ...over }) as PerformancePanelResponse;
const api = fetchPerformancePanel as jest.MockedFunction<typeof fetchPerformancePanel>;

const debitFour = { ...base, positionId: 'debit', structure: 'custom_options', symbol: 'SPY', legs: '', maxRisk: 250, entryCredit: -2.5, entryKind: 'debit' as const, entryAmount: 2.5,
  legList: [leg('BUY', 'PUT', 600), leg('SELL', 'PUT', 590), leg('BUY', 'CALL', 640), leg('SELL', 'CALL', 650)], exitDebit: -3.5, exitReason: 'TAKE_PROFIT', realizedPnl: 98,
  pnlPctOfCredit: null, pnlPctOfCost: 39.2, pnlPctOfMaxRisk: 39.2, grossPnl: 100, costs: 2, costsDeclared: true };
const condorZero = { ...base, positionId: 'zero', structure: 'iron_condor', symbol: 'SPX', legs: '', maxRisk: 880, entryCredit: 1.2, entryKind: 'credit' as const, entryAmount: 1.2,
  legList: [leg('SELL', 'PUT', 5800), leg('BUY', 'PUT', 5790), leg('SELL', 'CALL', 5900), leg('BUY', 'CALL', 5910)], exitDebit: 0, exitReason: 'EXPIRATION', realizedPnl: 119,
  pnlPctOfCredit: 99.2, pnlPctOfCost: null, pnlPctOfMaxRisk: 13.5, grossPnl: 120, costs: 1, costsDeclared: true, exitDte: 0 };
const stock = { ...base, positionId: 'stock', structure: 'long_equity', symbol: 'AAPL', legs: 'BUY 10 AAPL', maxRisk: 500, entryCredit: -50, entryKind: 'debit' as const, entryAmount: 50,
  legList: [], exitReason: 'TAKE_PROFIT', realizedPnl: 25, shares: 10, entryPrice: 50, exitPrice: 52.5, cost: 500,
  pnlPctOfCredit: null, pnlPctOfCost: 5, pnlPctOfMaxRisk: 5, grossPnl: 25, costs: 0, costsDeclared: false };
const pending = { positionId: 'pend', version: '1', structure: 'iron_condor', legs: '', symbol: 'SPX', legList: [leg('SELL', 'PUT', 5800), leg('BUY', 'PUT', 5790)],
  entryAt: plainFixture.asOf, entryDte: 0, currentDte: 0, entryCredit: 1.2, entryKind: 'credit' as const, entryAmount: 1.2, pendingSettlement: true,
  lastSpreadValue: null, unrealizedPnl: null, pnlPctOfCredit: null, pnlPctOfCost: null, pnlPctOfMaxRisk: null, maxRisk: 880, lastValuedAt: null, valuationProblems: ['pendiente de liquidar: sin cierre oficial'] };

const open = async (trades: PerformancePanelResponse['closedTrades'], opens: PerformancePanelResponse['openPositions'] = [], over: Partial<PerformancePanelResponse> = {}) => {
  api.mockResolvedValue(panel(trades, opens, over));
  render(<PerformancePanel spec={plainFixture.spec} />);
  await screen.findByText('Ganancia total');
  return () => fireEvent.click(screen.getByRole('tab', { name: 'Operaciones' }));
};
const detail = (name: RegExp) => { fireEvent.click(screen.getByLabelText(name)); return screen.getByRole('dialog'); };

beforeEach(() => {
  jest.clearAllMocks();
  (fetchQuote as jest.Mock).mockResolvedValue({ data: [] });
  (labRequest as jest.Mock).mockResolvedValue({ projects: [] });
});

test('debit custom_options with four legs shows Costo and the percent over cost', async () => {
  (await open([debitFour]))();
  const dialog = detail(/Ver operación SPY/);
  expect(within(dialog).getByText('Costo').parentElement).toHaveTextContent('$2.50');
  expect(within(dialog).queryByText('Crédito')).not.toBeInTheDocument();
  expect(within(dialog).queryByText('% del crédito')).not.toBeInTheDocument();
  expect(within(dialog).getByText('% del costo').parentElement).toHaveTextContent('+39.2%');
  expect(within(dialog).getByText('P&L realizado').parentElement).toHaveTextContent('+$98.00');
  expect(within(dialog).getByText('P&L sin costos').parentElement).toHaveTextContent('+$100.00');
  expect(within(dialog).getByText('Costos').parentElement).toHaveTextContent('$2.00');
  expect(within(dialog).getByText('Motivo').parentElement).toHaveTextContent('Toma de ganancia');
});

test('0DTE iron condor settled at expiration shows DTE 0, credit and the Vencimiento reason', async () => {
  (await open([condorZero]))();
  expect(within(screen.getByRole('region', { name: 'Log de operaciones' })).getByText('Vencimiento')).toBeInTheDocument();
  const dialog = detail(/Ver operación SPX/);
  expect(within(dialog).getByText('Crédito').parentElement).toHaveTextContent('$1.20');
  expect(within(dialog).getByText('% del crédito').parentElement).toHaveTextContent('+99.2%');
  expect(within(dialog).getByText('DTE al salir').parentElement).toHaveTextContent('0');
  expect(within(dialog).getByText('Motivo').parentElement).toHaveTextContent('Vencimiento');
});

test('long stock shows the percent over cost and no credit', async () => {
  (await open([stock]))();
  const dialog = detail(/Ver operación AAPL/);
  expect(within(dialog).getByText('% del costo').parentElement).toHaveTextContent('+5.0%');
  expect(within(dialog).queryByText('% del crédito')).not.toBeInTheDocument();
  expect(within(dialog).getByText('Costo').parentElement).toHaveTextContent('$500.00');
  expect(within(dialog).queryByText('P&L sin costos')).not.toBeInTheDocument();
});

test('a position expired without an official close shows Pendiente de liquidar and no P&L', async () => {
  (await open([], [pending]))();
  const log = within(screen.getByRole('region', { name: 'Log de operaciones' }));
  expect(log.getAllByText('Pendiente de liquidar').length).toBeGreaterThan(0);
  expect(log.queryByText('Abierta')).not.toBeInTheDocument();
  const row = screen.getByLabelText(/Ver operación SPX/);
  expect(row).toHaveTextContent('—');
});

test('open positions in the summary show Costo for a debit and the settlement state', async () => {
  await open([], [{ ...pending, structure: 'custom_options', entryKind: 'debit', entryCredit: -2.5, entryAmount: 2.5, pendingSettlement: false, unrealizedPnl: 10, lastSpreadValue: 2.6 }]);
  expect(screen.getByText('Costo')).toBeInTheDocument();
  expect(screen.queryByText('Crédito')).not.toBeInTheDocument();
});

test('the summary shows gross and costs only when costs are declared', async () => {
  await open([debitFour], [], { costsDeclared: true, realizedGrossPnl: { value: 100, reason: null }, totalCosts: { value: 2, reason: null } });
  expect(screen.getByText('Ganancia sin costos').parentElement).toHaveTextContent('+$100.00');
  expect(screen.getByText('Costos').parentElement).toHaveTextContent('$2.00');
});

test('the summary has no costs rows when none are declared', async () => {
  await open([stock], [], { costsDeclared: false, realizedGrossPnl: { value: 25, reason: null }, totalCosts: { value: 0, reason: null } });
  expect(screen.queryByText('Ganancia sin costos')).not.toBeInTheDocument();
  expect(screen.queryByText('Costos')).not.toBeInTheDocument();
});

test.each([
  ['TRADE_LIMIT', 'Límite de operaciones'], ['LOSS_BRAKE', 'Freno por pérdida'], ['RISK_LIMIT', 'Límite de riesgo'],
  ['OUTSIDE_ENTRY_WINDOW', 'Fuera de la ventana de entrada'], ['MAX_POSITIONS', 'Máximo de posiciones'], ['TOO_SOON', 'Entradas muy seguidas'],
])('discard reason %s reads %s', (key, label) => expect(DISCARD_LABELS[key]).toBe(label));

test.each([
  ['trade_limits', 'Límite de operaciones'], ['loss_brake', 'Freno por pérdida'], ['max_bet', 'Tope por apuesta'],
  ['risk_budget', 'Presupuesto de riesgo'], ['margin_account_minimum', 'Mínimo de cuenta (margen)'], ['intraday_margin', 'Margen intradiario'],
])('a skipped entry stopped by %s names the limit', (limit, label) => {
  expect(LIMIT_LABELS[limit]).toBe(label);
  expect(discardLabel({ eventId: '1', instanceId: 'i', eventType: 'ENTRY_SKIPPED', symbol: 'SPY', timestamp: '', payload: { limit } })).toBe(label);
});

test('a skipped entry without a limit keeps the event label, unknown ones stay raw', () => {
  const evt = { eventId: '1', instanceId: 'i', symbol: null, timestamp: '', payload: {} };
  expect(discardLabel({ ...evt, eventType: 'ENTRY_SKIPPED' })).toBe('Entrada salteada');
  expect(discardLabel({ ...evt, eventType: 'NEW_THING' })).toBe('NEW_THING');
});

test.each([
  ['TIME_EXIT', 'Por tiempo'], ['EVENT_EXIT', 'Por evento'], ['METRIC_EXIT', 'Por condición'], ['EXPIRATION', 'Vencimiento'],
])('exit reason %s reads %s', (reason, label) => expect(exitLabel(reason)).toBe(label));

test.each([
  [{ method: 'DELTA', target_delta: 0.2 }, 'Δ 0,2'],
  [{ method: 'POINTS_FROM_SPOT', points_from_spot: -5 }, '5 pts debajo del precio'],
  [{ method: 'POINTS_FROM_SPOT', points_from_spot: 5 }, '5 pts arriba del precio'],
  [{ method: 'PCT_FROM_SPOT', pct_from_spot: -1.5 }, '1,5 % debajo del precio'],
  [{ method: 'FIXED_STRIKE', strike: 7615 }, 'fijo 7615'],
  [{ method: 'OFFSET_FROM_LEG', from_leg: 'short_put', offset_points: -5 }, '5 pts debajo de la pata short_put'],
  [{ method: 'SOMETHING_NEW' }, 'SOMETHING_NEW'],
])('leg selection %j reads %s', (selection, label) => expect(legSelectionLabel(selection)).toBe(label));
