import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PerformancePanel } from './PerformancePanel';
import { agoText, gateLine, registryEntries } from './ficha';
import {
  deployShadowSpec, fetchPerformancePanel, fetchShadowDiscards, fetchShadowEvaluations, fetchShadowEvents, fetchShadowMetrics, fetchStrategyCard, stopShadowInstance,
} from '../../api/shadow';
import { labRequest } from '../../api/lab';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';
import plainFixture from './__fixtures__/panel_sin_parametros.json';
import { PerformancePanelResponse, ShadowEvent, ShadowInstance, StrategyCard } from '../../types/shadow';

jest.mock('../../api/client', () => ({ __esModule: true, default: { get: jest.fn().mockResolvedValue({ data: { spec: 's', storage: '', lastEvaluationAt: null, items: [] } }) } }));
jest.mock('../../api/shadow', () => ({
  fetchPerformancePanel: jest.fn(), fetchShadowDiscards: jest.fn(), fetchShadowEvaluations: jest.fn(), fetchShadowEvents: jest.fn(),
  fetchShadowMetrics: jest.fn(), fetchStrategyCard: jest.fn(), stopShadowInstance: jest.fn(), deployShadowSpec: jest.fn(),
}));
jest.mock('../../api/marketdata', () => ({ fetchQuote: jest.fn() }));
jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
jest.mock('lightweight-charts', () => ({ ColorType: { Solid: 'solid' }, LineSeries: {}, AreaSeries: {},
  TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
  createChart: jest.fn(() => ({ addSeries: () => ({ setData: jest.fn() }), timeScale: () => ({ fitContent: jest.fn() }), remove: jest.fn() })),
}));

const extra = { tradesWon: 2, tradesLost: 0, grossProfit: { value: 45, reason: null }, grossLoss: { value: 0, reason: null }, largestWin: { value: 23, reason: null }, winLossRatio: { value: null, reason: 'Sin pérdidas' } };
const panel = (open = 0): PerformancePanelResponse => ({ ...plainFixture, ...extra, tradesOpen: open, daily: [], openPositions: [], closedTrades: [] });
const SPEC = 'spx_sandwich';
const instance = (over: Partial<ShadowInstance> = {}): ShadowInstance => ({
  instanceId: 'i-1', deploymentId: 'd-1', versionHash: 'sha256:bc1ec2d9952c8d5', lifecycleState: 'RUNNING', schedulerState: 'IDLE',
  specName: SPEC, mode: 'SHADOW', createdAt: '2026-11-05T14:00:00Z', updatedAt: '2026-11-05T14:00:00Z', ...over,
});
const card: StrategyCard = { specName: SPEC, version: '1.3.0', contentHash: 'sha256:bc1ec2d9952c8d5', window: { start: '09:45', end: '15:00', timezone: 'America/New_York' },
  maxEntriesPerDay: 1, limitsUsd: { capital: 10000, perTrade: 200, openRisk: 400, perBet: 9 } };
const skipped = (n: number, day = '2026-11-05'): ShadowEvent => ({ eventId: `s${n}`, instanceId: 'i-1', eventType: 'ENTRY_SKIPPED', symbol: 'SPX', timestamp: `${day}T18:${10 + n}:00Z`,
  payload: { reason: 'tope por apuesta (SPX unknown 2026-W45): abierto 0.00 + nueva 200.00 USD supera el tope de 9.00 USD', limit: 'max_bet', max_risk: 200 } });

const cardApi = fetchStrategyCard as jest.Mock;
const discards = fetchShadowDiscards as jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  (labRequest as jest.Mock).mockResolvedValue({ projects: [] });
  (fetchPerformancePanel as jest.Mock).mockResolvedValue(panel());
  cardApi.mockResolvedValue(card);
  (fetchShadowMetrics as jest.Mock).mockResolvedValue([]);
  (fetchShadowEvaluations as jest.Mock).mockResolvedValue([]);
  (fetchShadowEvents as jest.Mock).mockResolvedValue([]);
  discards.mockResolvedValue([]);
  useCurrentUserStore.setState({ user: { userId: 'u-1', email: null, username: null, isAdmin: false, canManagePlatform: false, databaseConfigured: true }, loaded: true });
});

test('el encabezado muestra versión, ventana, última evaluación y límites desde la Card', async () => {
  const evaluatedAt = new Date(Date.now() - 3 * 60000).toISOString();
  (fetchShadowEvaluations as jest.Mock).mockResolvedValue([{ evaluationId: 'e', instanceId: 'i-1', symbol: 'SPX', overallPass: true, gateResults: [], evaluatedAt }]);
  render(<PerformancePanel spec={SPEC} instance={instance()} stage="SHADOW" />);
  const bar = await screen.findByLabelText('Estado de la estrategia');
  await waitFor(() => expect(bar).toHaveTextContent('Última evaluación hace 3 min'));
  await waitFor(() => expect(bar).toHaveTextContent('Versión activa v1.3.0'));
  expect(bar).toHaveTextContent('Ventana de entrada 09:45–15:00 America/New_York');
  expect(bar).toHaveTextContent('Entradas por día 1');
  expect(bar).toHaveTextContent('por operación 200 USD · riesgo abierto 400 USD · por apuesta 9 USD');
  expect(fetchShadowEvaluations).toHaveBeenCalledWith('i-1', 1);
});

test('un 404 en la Card no rompe la ficha: se omiten ventana y límites y la versión sale de las métricas', async () => {
  cardApi.mockRejectedValue({ response: { status: 404 } });
  (fetchShadowMetrics as jest.Mock).mockResolvedValue([{ specName: SPEC, contentHash: 'sha256:bc1ec2d9952c8d5', specVersion: '1.3.0' }]);
  render(<PerformancePanel spec={SPEC} instance={instance()} stage="SHADOW" />);
  expect(await screen.findByText('Ganancia total')).toBeInTheDocument();
  const bar = screen.getByLabelText('Estado de la estrategia');
  await waitFor(() => expect(bar).toHaveTextContent('Versión activa v1.3.0'));
  expect(bar).not.toHaveTextContent('Ventana de entrada');
  expect(bar).not.toHaveTextContent('Límites');
  expect(bar.querySelector('[role=alert]')).toBeNull();
});

test('sin versión conocida se muestra el hash corto, y los límites sin dato van como guion', async () => {
  cardApi.mockResolvedValue({ ...card, version: null, contentHash: null, window: null, maxEntriesPerDay: null, limitsUsd: { capital: null, perTrade: null, openRisk: null, perBet: 9 } });
  render(<PerformancePanel spec={SPEC} instance={instance()} stage="SHADOW" />);
  const bar = await screen.findByLabelText('Estado de la estrategia');
  await waitFor(() => expect(bar).toHaveTextContent('Límites por operación — · riesgo abierto — · por apuesta 9 USD'));
  expect(bar).toHaveTextContent('Versión activa bc1ec2d9952c');
  expect(bar).toHaveTextContent('Entradas por día —');
});

const stall = { days: 4, since: '2026-11-03', until: '2026-11-10', cause: 'ENTRY_SKIPPED:max_bet', causeLabel: 'tope por apuesta',
  reason: 'tope por apuesta (SPX unknown 2026-W46): abierto 0.00 + nueva 200.00 USD supera el tope de 9.00 USD',
  text: '4 días hábiles seguidos sin entrar por tope por apuesta' };

test('el titular muestra tal cual el «por qué no opera» que calcula la API, sin abrir ninguna pestaña', async () => {
  cardApi.mockResolvedValue({ ...card, stall });
  render(<PerformancePanel spec={SPEC} instance={instance()} stage="SHADOW" />);
  const headline = await screen.findByText('4 días hábiles seguidos sin entrar por tope por apuesta');
  expect(headline.parentElement).toHaveTextContent('tope por apuesta (SPX, vence la semana 2026-W46): abierto 0 + nueva 200 USD supera el tope de 9 USD');
  expect(discards).not.toHaveBeenCalledWith('i-1', 500, expect.anything());   // la ficha no recuenta eventos
});

test('sin racha en la API no hay titular', async () => {
  cardApi.mockResolvedValue({ ...card, stall: null });
  render(<PerformancePanel spec={SPEC} instance={instance()} stage="SHADOW" />);
  await screen.findByLabelText('Estado de la estrategia');
  await waitFor(() => expect(cardApi).toHaveBeenCalled());
  expect(screen.queryByText(/sin entrar/)).not.toBeInTheDocument();
});

test('Pausar pide confirmación, avisa de las abiertas, llama a stop y refresca', async () => {
  (fetchPerformancePanel as jest.Mock).mockResolvedValue(panel(2));
  (stopShadowInstance as jest.Mock).mockResolvedValue(undefined);
  const changed = jest.fn().mockResolvedValue(undefined);
  render(<PerformancePanel spec={SPEC} instance={instance()} stage="SHADOW" onInstanceChange={changed} />);
  await screen.findByText('Ganancia total');
  fireEvent.click(await screen.findByRole('button', { name: 'Pausar' }));
  expect(stopShadowInstance).not.toHaveBeenCalled();
  expect(screen.getByText(/¿Pausar\? Deja de entrar; las 2 abiertas se siguen valuando\./)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'No' }));
  expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sí' }));
  await waitFor(() => expect(stopShadowInstance).toHaveBeenCalledWith('i-1'));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
});

test('Prender vuelve a desplegar la misma versión con expectedHash y muestra el error de la API', async () => {
  (deployShadowSpec as jest.Mock).mockRejectedValueOnce({ response: { data: { error: 'La spec vigente ya no es esa versión.' } } }).mockResolvedValueOnce(undefined);
  const changed = jest.fn();
  render(<PerformancePanel spec={SPEC} instance={instance({ lifecycleState: 'STOPPED' })} stage="SHADOW" onInstanceChange={changed} />);
  await screen.findByText('Ganancia total');
  expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Prender' }));
  expect(screen.getByText(/¿Prender de nuevo la v1\.3\.0\? Vuelve a evaluar entradas en SHADOW \(simulado\)\./)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sí' }));
  expect(await screen.findByText('No se pudo prender: La spec vigente ya no es esa versión.')).toBeInTheDocument();
  expect(deployShadowSpec).toHaveBeenCalledWith(SPEC, 'sha256:bc1ec2d9952c8d5');
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Sí' }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
});

test('sin etapa SHADOW o sin instancia no hay Pausar ni Prender', async () => {
  const live = render(<PerformancePanel spec={SPEC} instance={instance()} stage="LIVE" />);
  await screen.findByText('Ganancia total');
  expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();
  live.unmount();
  render(<PerformancePanel spec={SPEC} instance={null} stage="SHADOW" />);
  await screen.findByText('Ganancia total');
  expect(screen.queryByRole('button', { name: 'Prender' })).not.toBeInTheDocument();
});

test('el Registro cuenta lo que pasó, con las reglas bajo su evaluación y quién pausó o prendió', async () => {
  (fetchShadowEvaluations as jest.Mock).mockResolvedValue([{ evaluationId: 'e1', instanceId: 'i-1', symbol: 'SPX', overallPass: true, evaluatedAt: '2026-11-05T18:45:00Z',
    gateResults: [{ gateId: 'vix_below_24', label: 'VIX < 24', status: 'PASS', value: 20.18, threshold: 24, operator: 'LT', onFail: 'NO_TRADE' },
      { gateId: 'sin_fomc', label: 'FOMC no existe (hoy)', status: 'PASS', value: 0, threshold: null, operator: 'EVENT_NOT_EXISTS', onFail: 'NO_TRADE' }] }]);
  const ev = (eventId: string, eventType: string, timestamp: string, payload: Record<string, unknown>): ShadowEvent => ({ eventId, instanceId: 'i-1', eventType, symbol: 'SPX', timestamp, payload });
  (fetchShadowEvents as jest.Mock).mockResolvedValue([
    ev('a', 'INSTANCE_CREATED', '2026-11-05T14:00:00Z', {}),
    skipped(1),
    ev('c', 'CANDIDATE_CREATED', '2026-11-05T19:00:00Z', { credit: 3, max_risk: 200 }),
    ev('d', 'POSITION_OPENED', '2026-11-05T19:00:01Z', { credit: 3, max_risk: 200 }),
    ev('f', 'POSITION_CLOSED', '2026-11-05T20:00:00Z', { exit_reason: 'TAKE_PROFIT', realized_pnl: 1234.5 }),
    ev('g', 'INSTANCE_STOPPED', '2026-11-05T21:00:00Z', { stopped_by: 'u-1' }),
    ev('h', 'INSTANCE_STOPPED', '2026-11-05T21:30:00Z', { stopped_by: 'otro' }),
  ]);
  render(<PerformancePanel spec={SPEC} instance={instance()} stage="SHADOW" />);
  await screen.findByText('Ganancia total');
  fireEvent.click(screen.getByRole('tab', { name: 'Registro' }));
  const log = await screen.findByLabelText('Registro');
  expect(log.textContent!.indexOf('16:30')).toBeLessThan(log.textContent!.indexOf('16:00'));
  expect(log).toHaveTextContent('16:30 Pausada por otro usuario');
  expect(log).toHaveTextContent('16:00 Pausada por vos');
  expect(log).toHaveTextContent('15:00 Salió: Toma de ganancia, P&L +1.234,50 USD');
  expect(log).toHaveTextContent('14:00 Entró: crédito 3,00, riesgo máx. 200 USD');
  expect(log.textContent?.match(/Entró:/g)).toHaveLength(1);
  expect(log).toHaveTextContent('13:45 Evaluó SPX: se cumplen las reglas de entrada');
  expect(within(log).getByText('VIX 20,18 < 24: pasa').closest('ul')).toHaveClass('registry-gates');
  expect(within(log).getByText('FOMC no existe (hoy): pasa')).toBeInTheDocument();
  expect(log).toHaveTextContent('13:11 No entró: tope por apuesta (SPX, vence la semana 2026-W45): abierto 0 + nueva 200 USD supera el tope de 9 USD');
  expect(log).toHaveTextContent('09:00 Prendida');
});

test('«Prendida por vos» sale del deployedBy de la instancia', () => {
  const created: ShadowEvent = { eventId: 'a', instanceId: 'i-9', eventType: 'INSTANCE_CREATED', symbol: null, timestamp: '2026-11-05T14:00:00Z', payload: {} };
  expect(registryEntries([created], [], 'u-1', { 'i-9': 'u-1' })[0].text).toBe('Prendida por vos');
  expect(registryEntries([created], [], 'u-1', { 'i-9': 'otro' })[0].text).toBe('Prendida por otro usuario');
  expect(registryEntries([created], [], 'u-1')[0].text).toBe('Prendida');
});

test('formatos: hace X, regla con operador', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  expect(agoText('2026-11-10T11:57:00Z', now)).toBe('hace 3 min');
  expect(agoText('2026-11-10T10:00:00Z', now)).toBe('hace 2 h');
  expect(agoText('2026-11-06T12:00:00Z', now)).toBe('hace 4 días');
  expect(gateLine({ gateId: 'v', label: 'VIX', status: 'FAIL', value: 26.44, threshold: 24, operator: 'LT', onFail: 'x' })).toBe('VIX 26,44 < 24: no pasa');
});

test('un candidato que no llegó a abrirse no se cuenta como entrada y una regla sin dato dice qué falta', () => {
  const cand: ShadowEvent = { eventId: 'c', instanceId: 'i-1', eventType: 'CANDIDATE_CREATED', symbol: 'SPX', timestamp: '2026-11-05T19:00:00Z', payload: { credit: 3.7, max_risk: 130 } };
  const rows = registryEntries([cand], [], 'u-1');
  expect(rows[0].text).toBe('Armó la estructura: crédito 3,70, riesgo máx. 130 USD');
  expect(rows[0].tone).toBeUndefined();
  expect(gateLine({ gateId: 'v', label: 'VIX < 24', status: 'NO_DATA', value: null, threshold: 24, operator: 'LT', onFail: 'x' })).toBe('VIX: sin dato (tiene que ser < 24)');
});

test('si la API falla sin dar motivo, Pausar dice qué pasó', async () => {
  (fetchPerformancePanel as jest.Mock).mockResolvedValue(panel(0));
  (stopShadowInstance as jest.Mock).mockRejectedValueOnce({ response: { status: 500, data: {} }, message: 'Request failed with status code 500' })
    .mockRejectedValueOnce(new Error('Network Error'));
  render(<PerformancePanel spec={SPEC} instance={instance()} stage="SHADOW" />);
  await screen.findByText('Ganancia total');
  fireEvent.click(await screen.findByRole('button', { name: 'Pausar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sí' }));
  expect(await screen.findByText('No se pudo pausar: GaleCore respondió con el error 500 y no dio el motivo.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sí' }));
  expect(await screen.findByText('No se pudo pausar: no se pudo conectar con GaleCore.')).toBeInTheDocument();
});
