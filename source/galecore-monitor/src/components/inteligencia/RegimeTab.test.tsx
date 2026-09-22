import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RegimeTab } from './RegimeTab';
import * as api from '../../api/regime';
import { RegimeEntry, RegimeRecordsResponse, RegimeTodayResponse, RegimeMeta } from '../../types/regime';

jest.mock('../../api/regime', () => ({
  ...jest.requireActual('../../api/regime'),
  fetchRegimeMeta: jest.fn(),
  fetchRegimeToday: jest.fn(),
  fetchRegimeRecords: jest.fn(),
  postRegimeReview: jest.fn(),
}));

const mocked = api as jest.Mocked<typeof api>;

// Registro sintético con la forma exacta que devuelve el adapter (GC-AI-0004). No es un registro
// real: sirve para probar cómo se muestra cada estado.
function entry(over: Partial<RegimeEntry> = {}): RegimeEntry {
  return {
    run_id: 'run-1', prompt: 'SYNTHETIC TEST RECORD', accepted_at: '2026-09-18T21:00:00+00:00',
    facts_hash: 'sha256:f', recorded_at: '2026-09-18T21:00:01+00:00',
    facts: { spot: 757.43, net_gex: -1473.4, vix: 17.71, sources: { gex: { capability_id: 'compute.gex_analysis', endpoint: '/x', freshness_basis: 'galecore_timestamp', freshness_status: 'VALID', provenance: 'GALECORE_VERIFIED', market_data_as_of: '2026-09-18T20:00:00Z', response_received_at: '2026-09-18T20:00:01Z' } } },
    host: { provider: 'test-fixture', model: 'none', provenance: 'HOST_DECLARED' },
    accepted_payload: {
      gamma_regime: 'negative_gamma', tail_pricing: 'calm',
      observations: ['Dealers are short gamma'], implications: ['Moves may be amplified'], limitations: ['Skew carries no timestamp'],
      quantitative_claims: [{ metric: 'net_gex', value: -1473.4, unit: 'billion_usd' }],
      evidence: [{ claim: 'Net GEX is negative', fact_path: 'facts.net_gex' }],
    },
    outcomes: [], human_reviews: [],
    snapshot: { run_id: 'run-1', prepared_at: '2026-09-18T20:59:00Z', facts_hash: 'sha256:f', conventions_hash: 'sha256:c', market_data_as_of: '2026-09-18T20:00:00Z', freshness_status: 'VALID' },
    effective_assets: { agent: { asset_id: 'TradingAgent', version: '1.1.0', content_hash: 'sha256:a' }, skills: {}, protocols: {}, conventions: {} },
    trace: { trace_id: 't', facts_provenance: 'GALECORE_VERIFIED', guardrails: [{ guardrail_id: 'snapshot_integrity', passed: true, message: 'ok' }] },
    entry_hash: 'sha256:e',
    claims: [{ metric: 'net_gex', value: -1473.4, unit: 'billion_usd', fact_value: -1473.4, matches: true }],
    evidence: [{ claim: 'Net GEX is negative', fact_path: 'facts.net_gex', fact_value: -1473.4 }],
    comparisons: [], states: { outcome_pending: true, review_pending: true }, annotation: null,
    ...over,
  };
}

const meta: RegimeMeta = {
  records_dir: 'D:/records', symbols: ['TEST'], annotations_file: 'x', annotation_count: 0,
  read_only: false, reviews_enabled: true, served_at: 'now', timezone: 'America/New_York', today: '2026-09-21',
};

function records(list: RegimeRecordsResponse['records']): RegimeRecordsResponse {
  return {
    symbol: 'TEST', since: '2026-07-23', until: null, records_dir: 'D:/records', count: list.length,
    integrity_failed: list.filter((r) => r.status === 'INTEGRITY_FAILED').map((r) => r.date),
    read_inconsistent: [], records: list, queried_at: '2026-09-21T23:00:00+00:00',
  };
}

const noToday: RegimeTodayResponse = { date: '2026-09-21', timezone: 'America/New_York', symbol: 'TEST', status: 'NO_RECORD', record: null, records_dir: 'D:/records', queried_at: 'q' };

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  mocked.fetchRegimeMeta.mockResolvedValue(meta);
  mocked.fetchRegimeToday.mockResolvedValue(noToday);
});

test('sin adapter: cartel con el comando para arrancarlo, nada más', async () => {
  mocked.fetchRegimeMeta.mockRejectedValue({ request: {} });
  render(<RegimeTab />);
  await screen.findByText('Adapter de registros no disponible');
  expect(screen.getByText(/regime_viewer/)).toBeInTheDocument();
  expect(screen.queryByText('Historial')).not.toBeInTheDocument();
});

test('un adapter sin /api/today se dice, no se muestra vacío', async () => {
  mocked.fetchRegimeMeta.mockResolvedValue({ ...meta, today: undefined, timezone: undefined });
  render(<RegimeTab />);
  await screen.findByText('Adapter de registros desactualizado');
  expect(screen.getByText(/no expone \/api\/today/)).toBeInTheDocument();
});

test('un error del adapter (500) se distingue de "no responde"', async () => {
  mocked.fetchRegimeMeta.mockRejectedValue({ response: { status: 500, data: { error: 'record store unavailable: records directory does not exist' } } });
  render(<RegimeTab />);
  await screen.findByText('El adapter de registros respondió con error');
  expect(screen.getByText(/records directory does not exist \(HTTP 500\)/)).toBeInTheDocument();
});

test('hoy sin análisis + historial vacío se dicen explícitamente', async () => {
  mocked.fetchRegimeRecords.mockResolvedValue(records([]));
  render(<RegimeTab />);
  await screen.findByText('Sin análisis de hoy');
  expect(screen.getByText(/Sin registros de/)).toBeInTheDocument();
  expect(mocked.fetchRegimeRecords).toHaveBeenCalledWith('TEST', '2026-07-23');
});

test('estados del registro: pendientes, outcome comparado sin calificación, integridad fallida', async () => {
  const withOutcome = entry({
    run_id: 'run-2', outcomes: [{ observed_at: '2026-09-19T21:00:00Z', facts: {}, facts_hash: 'sha256:o', facts_provenance: 'GALECORE_VERIFIED' }],
    comparisons: [{ observed_at: '2026-09-19T21:00:00Z', rows: [{ metric: 'spot', before: 757.43, after: 759.9, delta: 2.47 }] }],
    human_reviews: [{ reviewed_at: '2026-09-19T22:00:00Z', verdict: 'partial', comment: 'SYNTHETIC review' }],
    states: { outcome_pending: false, review_pending: false },
  });
  mocked.fetchRegimeRecords.mockResolvedValue(records([
    { date: '2026-09-18', status: 'OK', path: 'D:/records/TEST/2026-09-18.md', entries: [withOutcome] },
    { date: '2026-09-19', status: 'OK', path: 'D:/records/TEST/2026-09-19.md', entries: [entry()] },
    { date: '2026-09-20', status: 'INTEGRITY_FAILED', path: 'D:/records/TEST/2026-09-20.md', problems: ['entry run-3: entry_hash mismatch'] },
  ]));
  render(<RegimeTab />);

  // El más reciente está seleccionado por defecto: el día rechazado, sin contenido.
  await screen.findByText('query rechazó este archivo');
  expect(screen.getByText('entry run-3: entry_hash mismatch')).toBeInTheDocument();
  expect(screen.queryByText('Interpretación aceptada')).not.toBeInTheDocument();

  // Día pendiente: badges y formulario de review.
  fireEvent.click(screen.getByText('run-1'));
  expect(await screen.findByText('Dejar mi review')).toBeInTheDocument();
  expect(screen.getAllByText('Outcome pendiente').length).toBeGreaterThan(0);
  expect(screen.getByText(/No hay nada que comparar/)).toBeInTheDocument();

  // Detalle: claims vs facts, evidencia, guardrails, timestamps por fuente y hashes vienen del registro.
  expect(screen.getByText('igual')).toBeInTheDocument();
  expect(screen.getByText('facts.net_gex')).toBeInTheDocument();
  expect(screen.getByText('snapshot_integrity')).toBeInTheDocument();
  expect(screen.getAllByText('2026-09-18T20:00:00Z').length).toBeGreaterThan(0);
  expect(screen.getByText('compute.gex_analysis')).toBeInTheDocument();
  expect(screen.getAllByText('sha256:e').length).toBeGreaterThan(0);
  expect(screen.getByText('2026-09-18T20:59:00Z')).toBeInTheDocument();

  // Día con outcome y review: tabla Δ (dato, no veredicto) y review mostrado.
  fireEvent.click(screen.getByText('run-2'));
  expect(await screen.findByText('+2.47')).toBeInTheDocument();
  expect(screen.getByText(/no una calificación de acierto/)).toBeInTheDocument();
  expect(screen.getByText('SYNTHETIC review')).toBeInTheDocument();
  expect(screen.getByText('Agregar otro review')).toBeInTheDocument();
});

test('el review se manda con el token al run_id elegido y la pantalla muestra el día releído', async () => {
  const day = { date: '2026-09-19', status: 'OK' as const, path: 'D:/records/TEST/2026-09-19.md', entries: [entry()] };
  mocked.fetchRegimeRecords.mockResolvedValue(records([day]));
  const reread = { ...day, entries: [entry({ human_reviews: [{ reviewed_at: 'later', verdict: 'agree', comment: 'ok con lo que había' }], states: { outcome_pending: true, review_pending: false } })] };
  mocked.postRegimeReview.mockResolvedValue({ recorded: { run_id: 'run-1', path: day.path, verdict: 'agree' }, record: reread, queried_at: 'q2' });

  render(<RegimeTab />);
  await screen.findByText('Dejar mi review');
  const save = screen.getByText('Guardar review').closest('button')!;
  expect(save).toBeDisabled();

  fireEvent.click(screen.getByText('Agree'));
  fireEvent.change(screen.getByLabelText('Comentario del review'), { target: { value: 'ok con lo que había' } });
  expect(save).toBeDisabled(); // sin token no se manda
  fireEvent.change(screen.getByLabelText('Token de review'), { target: { value: 'tok-123' } });
  expect(save).toBeEnabled();
  fireEvent.click(save);

  await waitFor(() => expect(mocked.postRegimeReview).toHaveBeenCalledWith(
    { symbol: 'TEST', date: '2026-09-19', run_id: 'run-1', verdict: 'agree', comment: 'ok con lo que había' }, 'tok-123',
  ));
  await waitFor(() => expect(screen.getByText(/Review agree de TEST 2026-09-19 guardado/)).toBeInTheDocument());
  expect(screen.getByText('ok con lo que había')).toBeInTheDocument();
  expect(screen.getByText('Review: agree')).toBeInTheDocument();
  expect(sessionStorage.getItem(api.REVIEW_TOKEN_STORAGE_KEY)).toBe('tok-123');
});

test('un 401 del adapter se muestra y no cambia el registro', async () => {
  const day = { date: '2026-09-19', status: 'OK' as const, path: 'p', entries: [entry()] };
  mocked.fetchRegimeRecords.mockResolvedValue(records([day]));
  mocked.postRegimeReview.mockRejectedValue({ response: { status: 401, data: { error: 'missing or wrong X-Review-Token' } } });
  render(<RegimeTab />);
  await screen.findByText('Dejar mi review');
  fireEvent.click(screen.getByText('Disagree'));
  fireEvent.change(screen.getByLabelText('Comentario del review'), { target: { value: 'no' } });
  fireEvent.change(screen.getByLabelText('Token de review'), { target: { value: 'bad' } });
  fireEvent.click(screen.getByText('Guardar review'));
  expect(await screen.findByRole('alert')).toHaveTextContent('missing or wrong X-Review-Token (HTTP 401)');
  expect(screen.getAllByText('Review pendiente').length).toBeGreaterThan(0);
  expect(sessionStorage.getItem(api.REVIEW_TOKEN_STORAGE_KEY)).toBeNull(); // el token malo no se recuerda
});

test('un 201 con reread_error dice que el review quedó guardado y que no hay que reenviar', async () => {
  const day = { date: '2026-09-19', status: 'OK' as const, path: 'p', entries: [entry()] };
  mocked.fetchRegimeRecords.mockResolvedValue(records([day]));
  mocked.postRegimeReview.mockResolvedValue({ recorded: { run_id: 'run-1', path: 'p', verdict: 'agree' }, record: null, reread_error: 'review saved, but re-reading the day failed: x', queried_at: 'q' });
  render(<RegimeTab />);
  await screen.findByText('Dejar mi review');
  fireEvent.click(screen.getByText('Agree'));
  fireEvent.change(screen.getByLabelText('Comentario del review'), { target: { value: 'x' } });
  fireEvent.change(screen.getByLabelText('Token de review'), { target: { value: 'tok' } });
  fireEvent.click(screen.getByText('Guardar review'));
  expect(await screen.findByRole('alert')).toHaveTextContent('No lo vuelvas a enviar');
});

test('un 201 cuya relectura no trae el review no se anuncia como guardado', async () => {
  const day = { date: '2026-09-19', status: 'OK' as const, path: 'p', entries: [entry()] };
  mocked.fetchRegimeRecords.mockResolvedValue(records([day]));
  mocked.postRegimeReview.mockResolvedValue({ recorded: { run_id: 'run-1', path: 'p', verdict: 'agree' }, record: day, queried_at: 'q' });
  render(<RegimeTab />);
  await screen.findByText('Dejar mi review');
  fireEvent.click(screen.getByText('Agree'));
  fireEvent.change(screen.getByLabelText('Comentario del review'), { target: { value: 'x' } });
  fireEvent.change(screen.getByLabelText('Token de review'), { target: { value: 'tok' } });
  fireEvent.click(screen.getByText('Guardar review'));
  expect(await screen.findByRole('alert')).toHaveTextContent('no muestra el review');
  expect(screen.queryByText(/guardado en/)).not.toBeInTheDocument();
});

test('con reviews deshabilitados en el adapter el formulario no permite escribir', async () => {
  mocked.fetchRegimeMeta.mockResolvedValue({ ...meta, reviews_enabled: false, read_only: true });
  mocked.fetchRegimeRecords.mockResolvedValue(records([{ date: '2026-09-19', status: 'OK', path: 'p', entries: [entry()] }]));
  render(<RegimeTab />);
  await screen.findByText('Dejar mi review');
  expect(screen.getByText(/--no-reviews/)).toBeInTheDocument();
  expect(screen.getByLabelText('Comentario del review')).toBeDisabled();
});

test('la anotación F-7 se muestra aparte del registro', async () => {
  const annotated = entry({ annotation: { symbol: 'TEST', date: '2026-09-17', entry_hash: 'sha256:e', kind: 'observed_history', label: 'Observed history — does not count toward AC-08', note: 'kept as history', source: 'GC-AI-0002 F-7', decided_on: '2026-09-19' } });
  mocked.fetchRegimeRecords.mockResolvedValue(records([{ date: '2026-09-17', status: 'OK', path: 'p', entries: [annotated] }]));
  render(<RegimeTab />);
  expect(await screen.findByText('Anotación del owner (no forma parte del registro)')).toBeInTheDocument();
  expect(screen.getByText('Observed history — does not count toward AC-08')).toBeInTheDocument();
  expect(screen.getByText('histórico observado')).toBeInTheDocument();
  expect(screen.getByText('Integridad OK')).toBeInTheDocument();
});

test('una respuesta tardía de un símbolo anterior no pisa al símbolo actual', async () => {
  const twoSymbols = { ...meta, symbols: ['TEST', 'QQQ'] };
  mocked.fetchRegimeMeta.mockResolvedValue(twoSymbols);
  let releaseTest: (v: RegimeRecordsResponse) => void = () => {};
  const slowTest = new Promise<RegimeRecordsResponse>((resolve) => { releaseTest = resolve; });
  mocked.fetchRegimeRecords.mockImplementation((symbol) => (symbol === 'TEST'
    ? slowTest
    : Promise.resolve({ ...records([{ date: '2026-09-19', status: 'OK', path: 'q', entries: [entry({ run_id: 'qqq-run' })] }]), symbol: 'QQQ' })));
  mocked.fetchRegimeToday.mockImplementation((symbol) => Promise.resolve({ ...noToday, symbol }));

  render(<RegimeTab />);
  await waitFor(() => expect(mocked.fetchRegimeRecords).toHaveBeenCalledWith('TEST', '2026-07-23'));
  fireEvent.change(screen.getByDisplayValue('TEST'), { target: { value: 'QQQ' } });
  await screen.findAllByText('qqq-run');
  // Ahora llega la respuesta vieja de TEST: no debe reemplazar lo que se ve.
  releaseTest({ ...records([{ date: '2026-09-19', status: 'OK', path: 't', entries: [entry({ run_id: 'test-run' })] }]), symbol: 'TEST' });
  await new Promise((r) => setTimeout(r, 30));
  expect(screen.getAllByText('qqq-run').length).toBeGreaterThan(0);
  expect(screen.queryByText('test-run')).not.toBeInTheDocument();
  expect(screen.getByDisplayValue('QQQ')).toBeInTheDocument();
});

test('la relectura de un review llegada tras cambiar de símbolo no toca el símbolo actual', async () => {
  const twoSymbols = { ...meta, symbols: ['TEST', 'QQQ'] };
  mocked.fetchRegimeMeta.mockResolvedValue(twoSymbols);
  const testDay = { date: '2026-09-19', status: 'OK' as const, path: 't', entries: [entry({ run_id: 'test-run' })] };
  const qqqDay = { date: '2026-09-19', status: 'OK' as const, path: 'q', entries: [entry({ run_id: 'qqq-run' })] };
  mocked.fetchRegimeRecords.mockImplementation((symbol) => Promise.resolve({ ...records([symbol === 'TEST' ? testDay : qqqDay]), symbol }));
  mocked.fetchRegimeToday.mockImplementation((symbol) => Promise.resolve({ ...noToday, symbol }));
  let releaseReview: (v: any) => void = () => {};
  mocked.postRegimeReview.mockImplementation(() => new Promise((resolve) => { releaseReview = resolve; }));

  render(<RegimeTab />);
  await screen.findAllByText('test-run');
  fireEvent.click(screen.getByText('Agree'));
  fireEvent.change(screen.getByLabelText('Comentario del review'), { target: { value: 'ok' } });
  fireEvent.change(screen.getByLabelText('Token de review'), { target: { value: 'tok' } });
  fireEvent.click(screen.getByText('Guardar review'));
  await waitFor(() => expect(mocked.postRegimeReview).toHaveBeenCalled());
  fireEvent.change(screen.getByDisplayValue('TEST'), { target: { value: 'QQQ' } });
  await screen.findAllByText('qqq-run');
  // La relectura de TEST llega ahora: QQQ 2026-09-19 no debe convertirse en el registro de TEST.
  releaseReview({ recorded: { run_id: 'test-run', path: 't', verdict: 'agree' },
    record: { ...testDay, entries: [entry({ run_id: 'test-run', human_reviews: [{ reviewed_at: 'x', verdict: 'agree', comment: 'ok' }], states: { outcome_pending: true, review_pending: false } })] },
    queried_at: 'q' });
  await new Promise((r) => setTimeout(r, 30));
  expect(screen.getAllByText('qqq-run').length).toBeGreaterThan(0);
  expect(screen.queryByText('test-run')).not.toBeInTheDocument();
});
