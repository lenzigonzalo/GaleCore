import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Shadow, discardReason, pickInstance } from './Shadow';
import * as api from '../api/shadow';
import plainFixture from '../components/shadow/__fixtures__/panel_sin_parametros.json';
import { fetchReferenceCapital, fetchSpace, saveSpaceItem } from '../api/space';
import { labRequest } from '../api/lab';
import { useAppConfigStore } from '../store/useAppConfigStore';
import { ShadowEvaluation, ShadowEvent, ShadowInstance, ShadowPosition, ShadowStatus, SpecVersionMetrics } from '../types/shadow';

jest.mock('../api/shadow', () => ({
  fetchPerformanceSummary: jest.fn(),
  fetchPerformancePanel: jest.fn(),
  fetchShadowStatus: jest.fn(),
  fetchShadowMetrics: jest.fn(),
  fetchShadowEvaluations: jest.fn(),
  fetchShadowDiscards: jest.fn(),
  fetchShadowPositions: jest.fn(),
}));

jest.mock('../components/shadow/PerformancePanel', () => ({ PerformancePanel: ({ spec, runtime }: { spec: string; runtime: React.ReactNode }) => <div data-testid="performance-panel">{spec}{runtime}</div> }));

jest.mock('../api/lab', () => ({ labRequest: jest.fn().mockResolvedValue({ projects: [], chats: [], providers: [] }) }));

jest.mock('../api/space', () => ({ fetchReferenceCapital: jest.fn(), fetchSpace: jest.fn(), saveSpaceItem: jest.fn() }));
const capitalApi = fetchReferenceCapital as jest.MockedFunction<typeof fetchReferenceCapital>;

const mocked = api as jest.Mocked<typeof api>;

// Respuestas sintéticas con la forma exacta de /App/Runtime/* (GC-0004). No son datos de mercado:
// sirven para probar cómo se muestra cada estado.
const instance: ShadowInstance = {
  instanceId: 'i-1', deploymentId: 'd-1', versionHash: 'sha256:68add468f142baaca705', lifecycleState: 'RUNNING',
  schedulerState: 'IDLE', specName: 'spy_strategy', mode: 'SHADOW',
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
    contentHash: instance.versionHash, specName: 'spy_strategy', specVersion: '1.0.0', instances: 1,
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
  (labRequest as jest.Mock).mockResolvedValue({ projects: [], chats: [], providers: [] });
  capitalApi.mockResolvedValue(undefined);
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [], shared: [] });
  (saveSpaceItem as jest.Mock).mockResolvedValue(undefined);
  mocked.fetchPerformanceSummary.mockResolvedValue([summary()]);
  mocked.fetchShadowStatus.mockResolvedValue(status());
  mocked.fetchShadowMetrics.mockResolvedValue([metrics()]);
  mocked.fetchShadowEvaluations.mockImplementation(async id => [{ ...evaluation, evaluationId: `e-${id}`, instanceId: id }]);
  mocked.fetchShadowDiscards.mockImplementation(async id => [{ ...discard, eventId: `ev-${id}`, instanceId: id }]);
  mocked.fetchShadowPositions.mockResolvedValue([]);
});

function summary(spec = instance.specName) {
  return { spec, tradesClosed: 2, tradesOpen: 4, winRate: plainFixture.winRate, realizedPnl: plainFixture.realizedPnl, unrealizedPnl: plainFixture.unrealizedPnl, expectancy: plainFixture.expectancy, maxDrawdown: plainFixture.maxDrawdown, worstTrade: plainFixture.worstTrade, avgDaysHeld: plainFixture.avgDaysHeld, takeProfitExits: 2, stopLossExits: 0, otherExits: 0, lastExitAt: plainFixture.lastExitAt };
}
test('list uses one Summary and Status in parallel, never Metrics or individual panels', async () => {
  mocked.fetchPerformanceSummary.mockResolvedValue([summary(), summary('otra')]);
  mocked.fetchShadowStatus.mockResolvedValue(status({}, [instance, { ...instance, instanceId: 'new', lifecycleState: 'STOPPED', createdAt: '2026-10-14T12:00:00Z' }]));
  render(<Shadow />);
  const row = (await screen.findByRole('button', { name: instance.specName })).closest('tr')!;
  expect(row).toHaveTextContent('+$45.00'); expect(row).toHaveTextContent('2 cerradas · 4 abiertas');
  expect(row).toHaveTextContent('100.0%'); expect(row).toHaveTextContent('2 TP · 0 SL · 0 otras');
  expect(row).toHaveTextContent('Detenida'); expect(screen.getByText('Sin ejecución')).toBeInTheDocument();
  expect(mocked.fetchPerformanceSummary).toHaveBeenCalledTimes(1); expect(mocked.fetchShadowStatus).toHaveBeenCalledTimes(1);
  expect(mocked.fetchPerformancePanel).not.toHaveBeenCalled(); expect(mocked.fetchShadowMetrics).not.toHaveBeenCalled();
});
test('whole row supports keyboard navigation and returning preserves the list without new requests', async () => {
  mocked.fetchPerformanceSummary.mockResolvedValue([summary(), summary('otra')]);
  render(<Shadow />); const row = (await screen.findByRole('button', { name: 'otra' })).closest('tr')!;
  fireEvent.keyDown(row, { key: 'Enter' }); expect(screen.getByTestId('performance-panel')).toHaveTextContent('otra');
  fireEvent.click(screen.getByRole('button', { name: '← Estrategias' }));
  expect(screen.getByRole('button', { name: instance.specName })).toBeInTheDocument();
  expect(mocked.fetchPerformanceSummary).toHaveBeenCalledTimes(1); expect(mocked.fetchShadowStatus).toHaveBeenCalledTimes(1);
});
test('null summary metrics show a dash with the API reason in title', async () => {
  mocked.fetchPerformanceSummary.mockResolvedValue([{ ...summary(), realizedPnl: { value: null, reason: 'Sin cerradas' } }]);
  render(<Shadow />); const cell = await screen.findByTitle('Sin cerradas'); expect(cell).toHaveTextContent('—');
});
test('StrictMode development remount does not duplicate Summary or Status requests', async () => {
  render(<React.StrictMode><Shadow /></React.StrictMode>);
  await screen.findByRole('button', { name: instance.specName });
  expect(mocked.fetchPerformanceSummary).toHaveBeenCalledTimes(1);
  expect(mocked.fetchShadowStatus).toHaveBeenCalledTimes(1);
});
test('list has skeleton rows while the summary request is pending', async () => {
  mocked.fetchPerformanceSummary.mockReturnValue(new Promise(() => {})); render(<Shadow />);
  expect(screen.getAllByLabelText('Cargando estrategia')).toHaveLength(5);
  expect(screen.queryByText('Cargando estrategias…')).not.toBeInTheDocument();
  await act(async () => {});
});
test('Runtime plegado carga sólo instancias y lecturas de la estrategia', async () => {
  mocked.fetchShadowStatus.mockResolvedValue(status({}, [instance, { ...instance, instanceId: 'i-2' }, { ...instance, specName: 'otra', instanceId: 'other' }]));
  mocked.fetchShadowMetrics.mockResolvedValue([metrics(), metrics({ specName: 'otra', contentHash: 'other' })]);
  mocked.fetchShadowPositions.mockImplementation(async id => [position({ positionId: `p-${id}`, instanceId: id })]);
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
test('summary errors do not invent zero values and can be retried', async () => {
  mocked.fetchPerformanceSummary.mockRejectedValueOnce({ response: { status: 503 } }); render(<Shadow />);
  await screen.findByText('SHADOW no tiene persistencia disponible'); expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Reintentar')); await screen.findByRole('button', { name: instance.specName });
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

test('sin preferencia incluye también estrategias de prueba y proyectos en diseño',async()=>{
 (labRequest as jest.Mock).mockResolvedValue({projects:[{id:'draft',type:'strategy',strategyName:'idea'}, {id:'test',type:'strategy',strategyName:'shadow_runtime_test_hidden'}],chats:[],providers:[]});
 mocked.fetchPerformanceSummary.mockResolvedValue([summary('shadow_runtime_test_hidden')]);
 render(<Shadow/>);
 const row=(await screen.findByRole('button',{name:'idea'})).closest('tr')!;
 expect(row).toHaveTextContent('En diseño');expect(row).not.toHaveTextContent('$0');
 expect(screen.getByRole('button',{name:'shadow_runtime_test_hidden'})).toBeInTheDocument();
});
test('RPF ocupa una fila y su monitor aparece en Hoy',async()=>{
 useAppConfigStore.setState({strategies:[{id:'rpf',tab:'rpf'} as any]});
 render(<Shadow rpf={<div>Monitor real RPF</div>}/>);
 fireEvent.click(await screen.findByRole('button',{name:'RPF'}));
 expect(screen.getByRole('tab',{name:'Hoy'})).toHaveAttribute('aria-selected','true');
 expect(screen.getByText('Monitor real RPF')).toBeInTheDocument();
 expect(screen.queryByTestId('performance-panel')).not.toBeInTheDocument();
 useAppConfigStore.setState({strategies:[]});
});

const preference = (hidden: string[], isOwn = true) => ({ kind: 'preference', key: 'estrategias', isOwn, content: JSON.stringify({ hidden }) });
test('recupera ocultas propias, permite verlas atenuadas y restaurarlas sin abrir la estrategia', async () => {
 (fetchSpace as jest.Mock).mockResolvedValue({items:[preference([instance.specName])],shared:[]});
 render(<Shadow/>);
 const toggle=await screen.findByRole('switch',{name:'Mostrar ocultas (1)'});
 expect(screen.queryByRole('button',{name:instance.specName})).not.toBeInTheDocument();
 fireEvent.click(toggle);
 const row=screen.getByRole('button',{name:instance.specName}).closest('tr')!;
 expect(row).toHaveClass('strategy-hidden');
 fireEvent.click(within(row).getByRole('button',{name:'Volver a mostrar'}));
 await waitFor(()=>expect(saveSpaceItem).toHaveBeenCalledWith('preference','estrategias',{title:'Estrategias',content:'{"hidden":[]}',format:'json',visibility:'private'}));
 await waitFor(()=>expect(row).not.toHaveClass('strategy-hidden'));
 expect(screen.queryByTestId('performance-panel')).not.toBeInTheDocument();
});
test('ocultar guarda sólo la preferencia propia, mantiene las otras ocultas y se recupera al remontar', async()=>{
 (fetchSpace as jest.Mock).mockResolvedValue({items:[preference(['otra-no-listada'])],shared:[]});
 const {unmount}=render(<Shadow/>);
 const row=(await screen.findByRole('button',{name:instance.specName})).closest('tr')!;
 const hide=within(row).getByRole('button',{name:'Ocultar de mi lista'});
 await waitFor(()=>expect(hide).toBeEnabled());fireEvent.click(hide);
 await waitFor(()=>expect(screen.queryByRole('button',{name:instance.specName})).not.toBeInTheDocument());
 expect(JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content)).toEqual({hidden:['otra-no-listada',instance.specName]});
 expect(screen.queryByTestId('performance-panel')).not.toBeInTheDocument();unmount();
 (fetchSpace as jest.Mock).mockResolvedValue({items:[preference(['otra-no-listada',instance.specName])],shared:[]});
 render(<Shadow/>);await screen.findByRole('switch',{name:'Mostrar ocultas (2)'});
 expect(screen.queryByRole('button',{name:instance.specName})).not.toBeInTheDocument();
});
test('las preferencias ajenas no ocultan nada y no se heredan al cambiar de usuario',async()=>{
 (fetchSpace as jest.Mock).mockResolvedValue({items:[preference([instance.specName],false)],shared:[preference([instance.specName],false)]});
 const {unmount}=render(<Shadow/>);
 const hide=within((await screen.findByRole('button',{name:instance.specName})).closest('tr')!).getByRole('button',{name:'Ocultar de mi lista'});
 await waitFor(()=>expect(hide).toBeEnabled());
 expect(screen.getByRole('switch',{name:'Mostrar ocultas (0)'})).toBeInTheDocument();unmount();
 (fetchSpace as jest.Mock).mockResolvedValue({items:[preference([instance.specName])],shared:[]});
 const second=render(<Shadow/>);await screen.findByRole('switch',{name:'Mostrar ocultas (1)'});second.unmount();
 (fetchSpace as jest.Mock).mockResolvedValue({items:[],shared:[]});
 render(<Shadow/>);await screen.findByRole('button',{name:instance.specName});
 expect(screen.getByRole('switch',{name:'Mostrar ocultas (0)'})).toBeInTheDocument();
});
test('un error de lectura no pisa preferencias; reintentar recupera lo guardado',async()=>{
 (fetchSpace as jest.Mock).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({items:[preference([instance.specName])],shared:[]});
 render(<Shadow/>);expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron leer tus preferencias');
 expect(screen.getByRole('button',{name:'Ocultar de mi lista'})).toBeDisabled();expect(saveSpaceItem).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));
 await screen.findByRole('switch',{name:'Mostrar ocultas (1)'});
 expect(screen.queryByRole('button',{name:instance.specName})).not.toBeInTheDocument();
});
test('un error de guardado conserva la fila y reintenta la intención sin inventar éxito',async()=>{
 (saveSpaceItem as jest.Mock).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
 render(<Shadow/>);const row=(await screen.findByRole('button',{name:instance.specName})).closest('tr')!;
 const hide=within(row).getByRole('button',{name:'Ocultar de mi lista'});await waitFor(()=>expect(hide).toBeEnabled());fireEvent.click(hide);
 expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar');
 expect(screen.getByRole('button',{name:instance.specName})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:instance.specName})).not.toBeInTheDocument());
 expect(saveSpaceItem).toHaveBeenCalledTimes(2);
});
test('los proyectos en diseño y RPF usan la misma preferencia, y el teclado del botón no abre su página',async()=>{
 useAppConfigStore.setState({strategies:[{id:'rpf',tab:'rpf'} as any]});
 (labRequest as jest.Mock).mockResolvedValue({projects:[{id:'idea-project',type:'strategy',strategyName:'idea'}],chats:[],providers:[]});
 render(<Shadow rpf={<div>Monitor RPF</div>}/>);
 const row=(await screen.findByRole('button',{name:'idea'})).closest('tr')!;
 const hide=within(row).getByRole('button',{name:'Ocultar de mi lista'});await waitFor(()=>expect(hide).toBeEnabled());
 fireEvent.keyDown(hide,{key:'Enter'});expect(screen.queryByTestId('performance-panel')).not.toBeInTheDocument();
 fireEvent.click(hide);await waitFor(()=>expect(screen.queryByRole('button',{name:'idea'})).not.toBeInTheDocument());
 const rpfHide=within(screen.getByRole('button',{name:'RPF'}).closest('tr')!).getByRole('button',{name:'Ocultar de mi lista'});
 fireEvent.click(rpfHide);await waitFor(()=>expect(screen.queryByRole('button',{name:'RPF'})).not.toBeInTheDocument());
 expect(JSON.parse((saveSpaceItem as jest.Mock).mock.calls[1][2].content)).toEqual({hidden:['idea','rpf']});
 useAppConfigStore.setState({strategies:[]});
});
