import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Shadow, discardReason, pickInstance } from './Shadow';
import * as api from '../api/shadow';
import { ShadowEvaluation, ShadowEvent, ShadowInstance, ShadowPosition, ShadowStatus, SpecVersionMetrics } from '../types/shadow';

jest.mock('../api/shadow', () => ({
  fetchShadowStatus: jest.fn(),
  fetchShadowMetrics: jest.fn(),
  fetchShadowEvaluations: jest.fn(),
  fetchShadowDiscards: jest.fn(),
  fetchShadowPositions: jest.fn(),
}));

jest.mock('../components/shadow/PerformancePanel', () => ({ PerformancePanel: ({ spec }: { spec: string }) => <div data-testid="performance-panel">{spec}</div> }));

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
  mocked.fetchShadowStatus.mockResolvedValue(status());
  mocked.fetchShadowMetrics.mockResolvedValue([metrics()]);
  mocked.fetchShadowEvaluations.mockResolvedValue([evaluation]);
  mocked.fetchShadowDiscards.mockResolvedValue([discard]);
  mocked.fetchShadowPositions.mockResolvedValue([]);
});

test('sin operaciones: lo dice, no muestra ceros, y explica cada descarte con el valor real del gate', async () => {
  render(<Shadow />);

  expect(await screen.findByText(/todavía no abrió operaciones/)).toBeInTheDocument();
  expect(screen.getByText('Guardado en base')).toBeInTheDocument();
  const card = screen.getByTestId('shadow-metrics');
  expect(within(card).getByText('sin operaciones cerradas')).toBeInTheDocument();
  expect(within(card).queryByText('$0.00')).not.toBeInTheDocument();
  expect(within(card).getByText(/Gates no cumplidos 3/)).toBeInTheDocument();
  expect(screen.getByText('No hay operaciones abiertas.')).toBeInTheDocument();
  expect(screen.getByText('gex_positive: FAIL (-412.5 >= 0)')).toBeInTheDocument();
  expect(screen.getByText('NO PASA')).toBeInTheDocument();
  expect(screen.getByText(/gex_positive: -412.5 >= 0/)).toBeInTheDocument();
  expect(mocked.fetchShadowEvaluations).toHaveBeenCalledWith('i-1');
});

test('sin persistencia: lo dice con el motivo y no inventa métricas', async () => {
  mocked.fetchShadowStatus.mockResolvedValue(status({ available: false, reason: 'la base configurada no es local (db.x.supabase.co)', recoveredAt: null, recovery: null }, []));
  mocked.fetchShadowMetrics.mockRejectedValue({ response: { status: 503, data: { error: 'SHADOW sin persistencia: no hay métricas guardadas.', reason: 'la base configurada no es local (db.x.supabase.co)' } } });

  render(<Shadow />);

  expect(await screen.findByText('Sin persistencia')).toBeInTheDocument();
  expect(screen.getByText(/Sin métricas: SHADOW sin persistencia/)).toBeInTheDocument();
  expect(screen.getByText(/No hay instancias SHADOW/)).toBeInTheDocument();
  expect(mocked.fetchShadowPositions).not.toHaveBeenCalled();
});

test('con operaciones: muestra la valuación real, las que no se pudieron valuar y las cerradas', async () => {
  mocked.fetchShadowMetrics.mockResolvedValue([metrics({
    noTrades: false, positionsOpened: 3, positionsOpen: 2, positionsClosed: 1, openPositionsNotValued: 1,
    realizedPnl: 45, unrealizedPnl: 20, winRate: 1, maxDrawdown: 0,
  })]);
  mocked.fetchShadowPositions.mockResolvedValue([
    position(),
    position({ positionId: 'p-2', unrealizedPnl: null, lastValuedAt: null, valuationProblems: ['.SPY261030P715: sin cotización utilizable'] }),
    position({ positionId: 'p-3', status: 'CLOSED', exitReason: 'TAKE_PROFIT', exitDebit: 0.35, realizedPnl: 45, exitAt: '2026-09-25T15:00:00Z' }),
  ]);

  render(<Shadow />);

  expect(await screen.findByText(/Sin valuar: .SPY261030P715: sin cotización utilizable/)).toBeInTheDocument();
  expect(screen.queryByText(/todavía no abrió operaciones/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/0.60 · \$20.00/).length).toBeGreaterThan(0);   // la cerrada conserva su última valuación
  expect(screen.getByText(/TAKE_PROFIT · 0.35 · \$45.00/)).toBeInTheDocument();
  expect(screen.getByText('1 abiertas sin valuar')).toBeInTheDocument();
  expect(screen.getByText('100.0 %')).toBeInTheDocument();
});

test('si la API no responde lo dice, sin dejar datos viejos', async () => {
  mocked.fetchShadowStatus.mockRejectedValue(new Error('Network Error'));
  render(<Shadow />);
  await waitFor(() => expect(screen.getByText('No se pudo leer el runtime')).toBeInTheDocument());
  expect(screen.queryByTestId('shadow-status')).not.toBeInTheDocument();
});

test('elige la instancia que corre; si ninguna, la última', () => {
  const stopped = { ...instance, instanceId: 'i-0', lifecycleState: 'STOPPED' };
  expect(pickInstance([stopped, instance])?.instanceId).toBe('i-1');
  expect(pickInstance([instance, stopped].map((i) => ({ ...i, lifecycleState: 'STOPPED' })))?.instanceId).toBe('i-0');
  expect(pickInstance([])).toBeNull();
});

test('motivo del descarte: razón, errores de riesgo o gates', () => {
  expect(discardReason({ ...discard, eventType: 'CANDIDATE_NOT_VIABLE', payload: { reason: 'sin strikes con delta en rango' } }))
    .toBe('sin strikes con delta en rango');
  expect(discardReason({ ...discard, eventType: 'RISK_CHECK_FAILED', payload: { errors: ['riesgo > máximo', 'DTE fuera de rango'] } }))
    .toBe('riesgo > máximo · DTE fuera de rango');
  expect(discardReason({ ...discard, payload: {} })).toBe('sin motivo registrado');
});


test('selector de estrategia monta el panel seleccionado sin mezclar specs', async () => {
  mocked.fetchShadowStatus.mockResolvedValue(status());
  mocked.fetchShadowMetrics.mockResolvedValue([metrics({ specName: 'spy' }), metrics({ specName: 'tlt', contentHash: 'other' })]);
  render(<Shadow />);
  const selector = await screen.findByLabelText('Estrategia');
  expect(screen.getByTestId('performance-panel')).toHaveTextContent('spy');
  fireEvent.change(selector, { target: { value: 'tlt' } });
  expect(screen.getByTestId('performance-panel')).toHaveTextContent('tlt');
});


test('un error del seguimiento antiguo no desmonta el panel independiente', async () => {
  render(<Shadow />);
  await screen.findByTestId('performance-panel');
  mocked.fetchShadowStatus.mockRejectedValue(new Error('Runtime unavailable'));
  fireEvent.click(screen.getByTitle('Actualizar'));
  await screen.findByText('No se pudo leer el runtime');
  expect(screen.getByTestId('performance-panel')).toBeInTheDocument();
});
