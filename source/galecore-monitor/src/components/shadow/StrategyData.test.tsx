import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import apiClient from '../../api/client';
import { StrategyData, StrategyDataResponse } from './StrategyData';
jest.mock('../../api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
const get = apiClient.get as jest.Mock;
const fixture: StrategyDataResponse = { asOf: '2026-10-14T19:02:00Z', spec: 'spy', version: '1', lastEvaluationAt: '2026-10-14T19:02:00Z', storage: 'No guarda historia de mercado', items: [
  { need: 'VIX', capability: 'vix', usedFor: 'Entrada', source: 'Proveedor', kind: 'del momento', history: 'Evaluaciones', note: 'Revisar origen', gateId: 'vix', lastValue: 0, lastStatus: 'PASS', lastAt: '2026-10-14T19:02:00Z' },
  { need: 'Calendario', capability: 'earnings', usedFor: 'Evitar resultados', source: 'Proveedor', kind: 'calendario', history: 'No guarda', note: null, gateId: null, lastValue: null, lastStatus: null, lastAt: null },
] };
beforeEach(() => { get.mockReset(); get.mockResolvedValue({ data: fixture }); });
test('muestra el contrato sin calcular, incluye cero y hora ET y nota sólo en title', async () => {
  render(<StrategyData spec="spy" quality={{ max_quote_age_seconds: 15, block_on_crossed_market: true, block_on_missing_critical_data: false }}/>);
  const row = (await screen.findByText('VIX')).closest('tr')!;
  expect(get).toHaveBeenCalledWith('/App/Runtime/Performance/Data', { params: { spec: 'spy' } });
  expect(row).toHaveTextContent('0.00 · ✓'); expect(row).toHaveTextContent('15:02:00 ET'); expect(row).not.toHaveTextContent('19:02');
  expect(within(row).getByRole('img', { name: 'Advertencia' })).toHaveAttribute('title', 'Revisar origen');
  expect(screen.queryByText('Revisar origen')).not.toBeInTheDocument();
  expect(screen.getByText('Calendario').closest('tr')).toHaveTextContent('—');
  expect(screen.getByText('Edad de cotización configurada').closest('tr')).toHaveTextContent('15 segundos');
  expect(screen.getByText('Bloquear dato crítico ausente').closest('tr')).toHaveTextContent('No');
});
test('404 es una estrategia sin runtime; una falla de lectura se puede reintentar', async () => {
  get.mockRejectedValueOnce({ response: { status: 404 } });
  const { unmount } = render(<StrategyData spec="draft"/>);
  expect(await screen.findByText('Esta estrategia todavía no corre en SHADOW')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); unmount();
  get.mockRejectedValueOnce(new Error('offline'));
  render(<StrategyData spec="spy"/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron leer');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('VIX')).toBeInTheDocument();
});
test.each(['NO_DATA', 'SKIPPED', null])('un gate sin evaluación utilizable muestra sin dato (%s)', async status => {
  get.mockResolvedValue({ data: { ...fixture, items: [{ ...fixture.items[0], lastValue: null, lastStatus: status, lastAt: null }] } });
  render(<StrategyData spec="spy"/>);
  expect((await screen.findByText('VIX')).closest('tr')).toHaveTextContent('— · sin dato');
});
