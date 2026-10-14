import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Shadow, discardReason, pickInstance } from './Shadow';
import * as api from '../api/shadow';
import plainFixture from '../components/shadow/__fixtures__/panel_sin_parametros.json';
import { fetchReferenceCapital } from '../api/space';
import { ShadowEvaluation, ShadowEvent, ShadowInstance, ShadowPosition, ShadowStatus, SpecVersionMetrics } from '../types/shadow';

jest.mock('../api/shadow', () => ({
  fetchPerformancePanel: jest.fn(),
  fetchShadowStatus: jest.fn(),
  fetchShadowMetrics: jest.fn(),
  fetchShadowEvaluations: jest.fn(),
  fetchShadowDiscards: jest.fn(),
  fetchShadowPositions: jest.fn(),
}));

jest.mock('../components/shadow/PerformancePanel', () => ({ PerformancePanel: ({ spec }: { spec: string }) => <div data-testid="performance-panel">{spec}</div> }));

jest.mock('../api/space', () => ({ fetchReferenceCapital: jest.fn() }));
const capitalApi = fetchReferenceCapital as jest.MockedFunction<typeof fetchReferenceCapital>;

const mocked = api as jest.Mocked<typeof api>;

// Respuestas sintéticas con la forma exacta de /App/Runtime/* (GC-0004). No son datos de mercado:
// sirven para probar cómo se muestra cada estado.
const instance: ShadowInstance = {
  instanceId: 'i-1', deploymentId: 'd-1', versionHash: 'sha256:68add468f142baaca705', lifecycleState: 'RUNNING',
  schedulerState: 'IDLE', specName: 'shadow_runtime_test_v1', mode: 'SHADOW',
  createdAt: '2026-09-24T14:00:00Z', updatedAt: '2026-09-24T15:00:00Z',
};

function status(over: Partial<ShadowStatus['persistence']> = {}, instances = [instance]): ShadowStatus {
  return {
    persistence: {
      available: true, reason: null, recoveredAt: '2026-09-24T15:00:00Z',
      recovery: { instances: 1, openPositions: 0, closedPositions: 0, evaluations: 3, events: 9, specsRebuilt: [], problems: [] },
      ...over,
    },
    switch: { enabled: true, source: 'platform' },
    instances,
  };
}

function metrics(over: Partial<SpecVersionMetrics> = {}): SpecVersionMetrics {
  return {
    contentHash: instance.versionHash, specName: 'shadow_runtime_test_v1', specVersion: '1.0.0', instances: 1,
    evaluations: 3, evaluationsPassed: 0, firstEvaluationAt: '2026-09-24T14:01:00Z', lastEvaluationAt: '2026-09-24T14:03:00Z',
    discards: { GATES_NOT_PASSED: 3 }, discardsTotal: 3, noDataBlocks: 1,
    positionsOpened: 0, positionsOpen: 0, positionsClosed: 0, openPositionsNotValued: 0,
    realizedPnl: null, unrealizedPnl: null, winRate: null, maxDrawdown: null, noTrades: true,
    ...over,
  };
}

const evaluation: ShadowEvaluation = {
  evaluationId: 'e-1', instanceId: 'i-1', symbol: 'SPY', overallPass: false, evaluatedAt: '2026-09-24T14:03:00Z',
  gateResults: [
    { gateId: 'gex_positive', label: 'GEX', status: 'FAIL', value: -412.5, threshold: 0, operator: '>=', onFail: 'BLOCK' },
    { gateId: 'vix_absolute', label: 'VIX', status: 'PASS', value: 15.2, threshold: 30, operator: '<', onFail: 'BLOCK' },
  ],
};

const discard: ShadowEvent = {
  eventId: 'ev-1', instanceId: 'i-1', eventType: 'GATES_NOT_PASSED', symbol: 'SPY', timestamp: '2026-09-24T14:03:00Z',
  payload: { evaluation_id: 'e-1', gates: [{ gate_id: 'gex_positive', status: 'FAIL', value: -412.5, operator: '>=', threshold: 0 }] },
};

function position(over: Partial<ShadowPosition> = {}): ShadowPosition {
  return {
    positionId: 'p-1', instanceId: 'i-1', symbol: 'SPY', structure: 'put_credit_spread', status: 'OPEN',
    legs: [
      { side: 'SELL', type: 'PUT', strike: 720, expiration: '2026-10-30', streamerSymbol: '.SPY261030P720', entryPrice: 1.6, exitPrice: null },
      { side: 'BUY', type: 'PUT', strike: 715, expiration: '2026-10-30', streamerSymbol: '.SPY261030P715', entryPrice: 0.8, exitPrice: null },
    ],
    entryCredit: 0.8, maxRisk: 420, width: 5, entryDte: 36, entryAt: '2026-09-24T14:05:00Z',
    exitDebit: null, exitAt: null, exitReason: null, realizedPnl: null,
    unrealizedPnl: 20, lastSpreadValue: 0.6, currentDte: 36, lastValuedAt: '2026-09-24T14:30:00Z', valuationProblems: null,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  capitalApi.mockResolvedValue(undefined);
  mocked.fetchPerformancePanel.mockImplementation(async params => ({ ...plainFixture, spec: params.spec, daily: [], openPositions: [], closedTrades: [] }));
  mocked.fetchShadowStatus.mockResolvedValue(status());
  mocked.fetchShadowMetrics.mockResolvedValue([metrics()]);
  mocked.fetchShadowEvaluations.mockResolvedValue([evaluation]);
  mocked.fetchShadowDiscards.mockResolvedValue([discard]);
  mocked.fetchShadowPositions.mockResolvedValue([]);
});

test('lista una fila por spec con cifras de su panel', async () => {
  mocked.fetchShadowMetrics.mockResolvedValue([metrics(), metrics({ contentHash: 'second', specVersion: '2' }), metrics({ specName: 'otra', contentHash: 'other', realizedPnl: 99999 })]);
  render(<Shadow />);
  await waitFor(() => expect(mocked.fetchPerformancePanel).toHaveBeenCalledTimes(2));
  const row = screen.getByRole('button', { name: instance.specName }).closest('tr')!;
  await waitFor(() => expect(row).toHaveTextContent('+$45.00'));
  expect(row).toHaveTextContent('2 / 4'); expect(row).toHaveTextContent('100.0%');
  expect(screen.getAllByRole('button', { name: instance.specName })).toHaveLength(1);
  expect(screen.queryByText(/99,999/)).not.toBeInTheDocument();
  expect(mocked.fetchShadowEvaluations).not.toHaveBeenCalled();
  expect(screen.queryByTestId('performance-panel')).not.toBeInTheDocument();
});
test('clic abre sólo la elegida y permite volver a la lista', async () => {
  mocked.fetchShadowMetrics.mockResolvedValue([metrics(), metrics({ specName: 'otra', contentHash: 'other' })]);
  render(<Shadow />); fireEvent.click(await screen.findByRole('button', { name: 'otra' }));
  expect(screen.getByTestId('performance-panel')).toHaveTextContent('otra');
  expect(screen.queryByRole('button', { name: instance.specName })).not.toBeInTheDocument();
  expect(mocked.fetchShadowEvaluations).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '← Estrategias' }));
  expect(await screen.findByRole('button', { name: instance.specName })).toBeInTheDocument();
});
test('Runtime plegado carga sólo instancias y lecturas de la estrategia', async () => {
  mocked.fetchShadowStatus.mockResolvedValue(status({}, [instance, { ...instance, instanceId: 'i-2' }, { ...instance, specName: 'otra', instanceId: 'other' }]));
  mocked.fetchShadowMetrics.mockResolvedValue([metrics(), metrics({ specName: 'otra', contentHash: 'other' })]);
  mocked.fetchShadowPositions.mockResolvedValue([position()]);
  render(<Shadow />); fireEvent.click(await screen.findByRole('button', { name: instance.specName }));
  expect(mocked.fetchShadowPositions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Runtime')); await screen.findByText('Guardado en base');
  expect(mocked.fetchShadowPositions).toHaveBeenCalledWith('i-1');
  expect(mocked.fetchShadowPositions).toHaveBeenCalledWith('i-2');
  expect(mocked.fetchShadowPositions).not.toHaveBeenCalledWith('other');
  expect(screen.getAllByTestId('shadow-metrics')).toHaveLength(1);
  expect(screen.queryByText('other')).not.toBeInTheDocument();
  expect(screen.getAllByText('gex_positive: FAIL (-412.5 >= 0)')).toHaveLength(2);
});
test('el error del runtime no desmonta el panel', async () => {
  render(<Shadow />); fireEvent.click(await screen.findByRole('button', { name: instance.specName }));
  mocked.fetchShadowStatus.mockRejectedValue(new Error('offline')); fireEvent.click(screen.getByText('Runtime'));
  await screen.findByText('No se pudo leer el runtime'); expect(screen.getByTestId('performance-panel')).toBeInTheDocument();
});
test('errores del panel se muestran sin fabricar ceros', async () => {
  mocked.fetchPerformancePanel.mockRejectedValue({ response: { status: 404 } }); render(<Shadow />);
  expect(await screen.findByText('Esta estrategia todavía no tiene posiciones SHADOW')).toBeInTheDocument();
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
});
test('la lista sólo pasa capital de referencia', async () => {
  capitalApi.mockResolvedValue(12000); render(<Shadow />);
  await waitFor(() => expect(mocked.fetchPerformancePanel).toHaveBeenCalledWith({ spec: instance.specName, referenceCapital: 12000 }));
});
test('elige la instancia que corre o la última', () => {
  const stopped = { ...instance, instanceId: 'i-0', lifecycleState: 'STOPPED' };
  expect(pickInstance([stopped, instance])?.instanceId).toBe('i-1');
  expect(pickInstance([instance, stopped].map(i => ({ ...i, lifecycleState: 'STOPPED' })))?.instanceId).toBe('i-0');
  expect(pickInstance([])).toBeNull();
});
test('motivo del descarte conserva razón y gates', () => {
  expect(discardReason({ ...discard, payload: { reason: 'sin strikes' } })).toBe('sin strikes');
  expect(discardReason({ ...discard, payload: { errors: ['riesgo', 'DTE'] } })).toBe('riesgo · DTE');
  expect(discardReason({ ...discard, payload: {} })).toBe('sin motivo registrado');
});
