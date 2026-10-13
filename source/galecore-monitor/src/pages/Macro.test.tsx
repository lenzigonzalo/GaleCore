import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Macro } from './Macro';
import { fetchMacro } from '../api/macroData';
import type { MacroSnapshot } from '../types/macroTypes';
jest.mock('../api/macroData', () => ({ fetchMacro: jest.fn() }));
jest.mock('../components/macro/MacroChart', () => ({ MacroChart: () => <div>Gráfico de prueba</div> }));
const fetchMock = fetchMacro as jest.Mock;
function sample(horizon = 'month'): MacroSnapshot {
  return { id: 'a'.repeat(64), schemaVersion: '1.0', horizon, region: 'Global', currency: 'Local',
    dataCutoff: '2026-10-13T17:00:00Z', generatedAt: '2026-10-13T17:01:00Z', contentHash: 'a'.repeat(64), historicalFidelity: 'revised-history-only', methodologyVersions: ['macro-v1'],
    seriesDefinitions: ['rates', 'equities', 'credit', 'currencies', 'commodities', 'volatility'].map(f => ({ id: f, name: `Serie ${f}`, family: f, region: 'US', unit: '%', source: f, frequency: 'daily', calendarId: 'publication-dates', instrumentType: 'reference', currency: 'USD', methodologyVersion: 'macro-v1', supportedHorizons: ['month'], limitations: ['Historia revisada a hoy'] })),
    observations: [{ id: 'rates:2026-10-12', seriesId: 'rates', value: 4.5, observationTime: '2026-10-12', publishedAt: null, availableAt: null, retrievedAt: '2026-10-13T17:00:00Z', timestampPrecision: 'day', sourceRef: 'https://example.test', vintageId: null, provenance: 'observed', qualityStatus: 'available', qualityReasons: ['Hora desconocida'] }],
    metrics: [{ id: `rates:${horizon}`, seriesId: 'rates', levelRef: 'rates:2026-10-12', comparisonRef: null, value: null, unit: 'pb', horizon, actualFrom: null, actualTo: '2026-10-12', inputRefs: [], formulaVersion: 'difference-v1', qualityStatus: 'unavailable', limitations: ['Referencia ausente'] }],
    events: [{ id: 'fed:2026-10-28', name: 'Reunión FOMC', date: '2026-10-28', source: 'fed', sourceRef: 'https://example.test', retrievedAt: '2026-10-13T17:00:00Z', timestampPrecision: 'day', limitations: ['Sin hora exacta'] }],
    sourceStatuses: [{ id: 'fred-calendar', status: 'source-error', asOf: null, retrievedAt: null, reasons: ['Timeout'] }]
  };
}
beforeEach(() => { window.history.replaceState(null, '', '/?macro=panorama'); fetchMock.mockReset(); fetchMock.mockImplementation((h: string) => Promise.resolve(sample(h))); });
test('seis familias permanecen, null no es cero y calendario fallido no borra datos', async () => {
  render(<Macro />); await screen.findByText('Serie rates');
  for (const name of ['Tasas', 'Acciones', 'Crédito', 'Monedas', 'Commodities', 'Volatilidad']) expect(screen.getByText(name)).toBeInTheDocument();
  expect(screen.getByText('4,50')).toBeInTheDocument(); expect(screen.getAllByText('N/D').length).toBeGreaterThan(0);
  expect(screen.getByText(/fred-calendar: Error de fuente/)).toBeInTheDocument();
  expect(screen.queryByText(/P&L|Órdenes|Posiciones/)).not.toBeInTheDocument();
});
test('detalle fuente/fecha, Escape restaura foco y Atrás restaura contexto', async () => {
  render(<Macro />); const button = await screen.findByRole('button', { name: 'Serie rates' });
  fireEvent.click(button); const dialog = screen.getByRole('dialog'); expect(dialog).toHaveFocus();
  expect(within(dialog).getByRole('link', { name: /Abrir fuente/ })).toHaveAttribute('href', 'https://example.test');
  expect(dialog).toHaveTextContent('2026-10-12'); expect(dialog).toHaveTextContent('Desconocida');
  fireEvent.keyDown(dialog, { key: 'Escape' }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(button).toHaveFocus();
  act(() => { window.history.replaceState(null, '', '/?macro=panorama&detail=rates'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
test('cambio de horizonte descarta respuesta tardía incompatible', async () => {
  let resolveOld: (value: MacroSnapshot) => void = () => {};
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  render(<Macro />); fireEvent.change(screen.getByLabelText('Horizonte'), { target: { value: 'session' } });
  await screen.findByText('Serie rates'); await act(async () => { resolveOld(sample('month')); });
  expect(screen.getByLabelText('Horizonte')).toHaveValue('session');
  expect(screen.getByText(/Este horizonte requiere/)).toBeInTheDocument();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});
test('recarga con enlace conserva snapshot y rechaza referencia inexistente', async () => {
  window.history.replaceState(null, '', '/?macro=events&horizon=month&detail=missing&snapshot=' + 'a'.repeat(64));
  render(<Macro />); await screen.findByText(/Referencia inexistente/);
  expect(fetchMock.mock.calls[0][3]).toBe('a'.repeat(64)); expect(screen.getByText(/corte guardado/)).toBeInTheDocument();
});
test('entrada desde navegación sin query copia un enlace Macro completo', async () => {
  window.history.replaceState(null, '', '/');
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<Macro />); await screen.findByText('Serie rates');
  fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace' }));
  await screen.findByText('Enlace copiado');
  const url = new URL(writeText.mock.calls[0][0]);
  expect(url.searchParams.get('macro')).toBe('panorama'); expect(url.searchParams.get('horizon')).toBe('month');
  expect(url.searchParams.get('snapshot')).toBe('a'.repeat(64));
});
