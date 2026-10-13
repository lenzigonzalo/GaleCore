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

test('seis familias, null no cero y presentación sin texto técnico ni copiar enlace', async () => {
  render(<Macro />); await screen.findByText('Serie rates');
  for (const name of ['Tasas','Acciones','Crédito','Monedas','Materias primas','Volatilidad']) expect(screen.getByText(name)).toBeInTheDocument();
  expect(screen.getByText('4,50')).toBeInTheDocument(); expect(screen.getAllByText('N/D').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button',{name:'Copiar enlace'})).not.toBeInTheDocument();
  expect(screen.queryByText('CONTEXTO DE MERCADO')).not.toBeInTheDocument();
  expect(screen.queryByText(/P&L|Órdenes|Posiciones/)).not.toBeInTheDocument();
});
test('detalle conserva fuente y fechas detrás de disclosure, Escape restaura foco',async()=>{
  render(<Macro />); const button=await screen.findByRole('button',{name:/Serie rates/});fireEvent.click(button);
  const dialog=screen.getByRole('dialog');expect(dialog).toHaveFocus();
  expect(within(dialog).getByRole('link',{name:/Ver fuente original/})).toHaveAttribute('href','https://example.test');
  expect(dialog).toHaveTextContent('Último valor');expect(dialog).not.toHaveTextContent('Observaciones');
  fireEvent.keyDown(dialog,{key:'Escape'});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(button).toHaveFocus();
});
test('enlace de período antiguo descarta respuesta tardía incompatible',async()=>{
  let resolveOld:(value:MacroSnapshot)=>void=()=>{};fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
  render(<Macro />);act(()=>{window.history.replaceState(null,'','/?macro=panorama&horizon=session');window.dispatchEvent(new PopStateEvent('popstate'));});
  await screen.findByText('Serie rates');await act(async()=>{resolveOld(sample('month'));});
  expect(screen.getByText(/Este enlace usa un período/)).toBeInTheDocument();await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
});
test('referencia inexistente no inventa un detalle y Eventos muestra calendario',async()=>{
  window.history.replaceState(null,'','/?macro=events&detail=missing&snapshot='+'a'.repeat(64));render(<Macro />);
  await screen.findByText('El dato de este enlace no está disponible.');expect(screen.getByRole('region',{name:'Calendario económico'})).toBeInTheDocument();
  expect(fetchMock.mock.calls[0][3]).toBe('a'.repeat(64));
});
