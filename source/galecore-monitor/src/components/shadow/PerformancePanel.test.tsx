import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PerformancePanel } from './PerformancePanel';
import { fetchPerformancePanel, fetchShadowStatus } from '../../api/shadow';
import { fetchSpace, SpaceItem } from '../../api/space';
import plain from './__fixtures__/panel_sin_parametros.json';
import illustrative from './__fixtures__/panel_con_parametros_ilustrativos.json';

jest.mock('../../api/shadow', () => ({ fetchPerformancePanel: jest.fn(), fetchShadowStatus: jest.fn() }));
jest.mock('../../api/space', () => ({ fetchSpace: jest.fn() }));
jest.mock('lightweight-charts', () => ({
  ColorType: { Solid: 'solid' }, LineSeries: {}, AreaSeries: {},
  createChart: jest.fn(() => ({ addSeries: () => ({ setData: jest.fn() }), timeScale: () => ({ fitContent: jest.fn() }), remove: jest.fn() })),
}));
const panelApi = fetchPerformancePanel as jest.MockedFunction<typeof fetchPerformancePanel>;
const spaceApi = fetchSpace as jest.MockedFunction<typeof fetchSpace>;
const statusApi = fetchShadowStatus as jest.MockedFunction<typeof fetchShadowStatus>;
const profile = (currency: string, amount: unknown = 12000, isOwn = true): SpaceItem => ({ kind: 'profile', key: 'profile', title: 'Perfil', format: 'json', visibility: 'private', version: 1, updatedAt: '', owner: 'test', isOwn,
  content: JSON.stringify({ reference_capital: { amount, currency }, risk_limits: ['máximo 2 %'], cashRatePct: 4, hypothesisMinTrades: 30 }) });
beforeEach(() => {
  jest.clearAllMocks();
  panelApi.mockResolvedValue(plain);
  spaceApi.mockResolvedValue({ items: [], shared: [] });
  statusApi.mockResolvedValue({ instances: [] } as any);
});
test('shows API reasons in the number slot, including empty reasons, and every block', async () => {
  render(<PerformancePanel spec={plain.spec} />);
  await screen.findByText('SHADOW · simulado');
  const loss = screen.getByText('Pérdida promedio').parentElement!;
  expect(within(loss).getByText(plain.avgLoss.reason!)).toBeInTheDocument();
  expect(within(loss).queryByText(/\$0/)).not.toBeInTheDocument();
  expect(screen.getAllByText(plain.sharpe.reason!)).toHaveLength(2);
  expect(screen.getAllByText('sin dato')).toHaveLength(4);
  expect(screen.getByText(plain.openRiskVsLimitsReason!)).toBeInTheDocument();
  expect(screen.getByText(plain.hypothesis.reason!)).toBeInTheDocument();
  expect(screen.getByText(plain.execution.notIncluded)).toBeInTheDocument();
  expect(screen.getByText('2 cerradas sin contexto')).toBeInTheDocument();
  expect(panelApi).toHaveBeenCalledWith({ spec: plain.spec });
});
test('renders illustrative limits and references strictly from the fixture', async () => {
  panelApi.mockResolvedValue(illustrative);
  render(<PerformancePanel spec={plain.spec} />);
  await screen.findByText('SHADOW · simulado');
  const risk = screen.getByRole('progressbar', { name: 'open_risk' });
  expect(risk).toHaveAttribute('value', '1822');
  expect(risk).toHaveAttribute('max', '1000');
  expect(screen.getByText('2 / 30')).toBeInTheDocument();
  expect(screen.getByText('−0.2%')).toBeInTheDocument();
});
test.each([404, 503, 'timeout'])('shows useful error and retries (%s)', async status => {
  panelApi.mockRejectedValueOnce(status === 'timeout' ? new Error('timeout exceeded') : { response: { status } });
  render(<PerformancePanel spec={plain.spec} />);
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent(status === 404 ? 'todavía no tiene posiciones SHADOW' : status === 503 ? 'persistencia disponible' : 'tardó demasiado');
  fireEvent.click(screen.getByText('Reintentar'));
  await screen.findByText('SHADOW · simulado');
});
test.each([['USD', 12000, true, 12000], ['ARS', 12000, true, undefined], ['USD', '12000', true, undefined], ['USD', 12000, false, undefined]])('passes only own numeric USD capital (%s, %s, %s)', async (currency, amount, isOwn, expected) => {
  spaceApi.mockResolvedValue({ items: [profile(currency as string, amount, isOwn as boolean)], shared: [] });
  render(<PerformancePanel spec={plain.spec} />);
  await screen.findByText('SHADOW · simulado');
  expect(panelApi).toHaveBeenCalledWith({ spec: plain.spec, ...(expected === undefined ? {} : { referenceCapital: expected }) });
});
test('profile failure still requests the panel without capital', async () => {
  spaceApi.mockRejectedValue(new Error('unavailable'));
  render(<PerformancePanel spec={plain.spec} />);
  await screen.findByText('SHADOW · simulado');
  expect(panelApi).toHaveBeenCalledWith({ spec: plain.spec });
});
test('version choices survive filtering and UTC date bounds are sent', async () => {
  render(<PerformancePanel spec={plain.spec} />);
  await screen.findByText('SHADOW · simulado');
  panelApi.mockImplementation(async params => params.version ? { ...plain, byVersion: [plain.byVersion[0]] } : plain);
  fireEvent.change(screen.getByLabelText('Versión'), { target: { value: '1.0.3' } });
  await waitFor(() => expect(panelApi).toHaveBeenCalledWith({ spec: plain.spec, version: '1.0.3' }));
  expect(screen.getByRole('option', { name: '1.0.5' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'custom' } });
  fireEvent.change(screen.getByLabelText('Desde (UTC)'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('Hasta (UTC)'), { target: { value: '2026-10-14' } });
  await waitFor(() => expect(panelApi).toHaveBeenCalledWith({ spec: plain.spec, version: '1.0.3', from: '2026-10-01T00:00:00.000Z', to: '2026-10-14T23:59:59.999Z' }));
});


test.each(['30', '90'])('requests a %s-day UTC period from the API', async period => {
  render(<PerformancePanel spec={plain.spec} />);
  await screen.findByText('SHADOW · simulado');
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: period } });
  await waitFor(() => expect(panelApi.mock.calls.some(([params]) => params.from && params.to)).toBe(true));
  const params = panelApi.mock.calls.find(([params]) => params.from && params.to)![0];
  expect(new Date(params.to!).getTime() - new Date(params.from!).getTime()).toBe(Number(period) * 86400000);
});
