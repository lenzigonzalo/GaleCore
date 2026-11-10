import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Argentina, fmtDate } from './Argentina';
import { ArgentinaBoard, ArgentinaSeriesItem, fetchArgentinaBoard } from '../api/argentina';

jest.mock('../api/argentina', () => ({ fetchArgentinaBoard: jest.fn() }));
jest.mock('../components/macro/MacroChart', () => ({ MacroChart: () => <div>Gráfico de prueba</div> }));

const item = (over: Partial<ArgentinaSeriesItem>): ArgentinaSeriesItem => ({ id: 'x', name: 'Serie', unit: '%', ok: true, error: null, source: 'bcra',
  last: 2.1, date: '2026-09-30', changeAbs: 0.2, changePct: 10, series: [{ fecha: '2026-08-31', valor: 1.9 }, { fecha: '2026-09-30', valor: 2.1 }], ...over });
const dolar = (casa: string, nombre: string, venta: number, varDiariaPct: number | null) => ({ casa, nombre, compra: venta - 20, venta, brechaPct: 4.5,
  fechaActualizacion: '2026-11-10T13:59:00.000Z', varDiariaPct, varDiariaContra: '2026-11-09', serie: [{ fecha: '2026-11-09', valor: venta - 5 }, { fecha: '2026-11-10', valor: venta }] });

const months = (base: number) => Array.from({ length: 10 }, (_, i) => ({ fecha: `2026-${String(i + 1).padStart(2, '0')}-28`, valor: base + i * 0.1 }));

const board = {
  asOf: '2026-11-10T14:00:00Z',
  blocks: {
    dolares: { id: 'dolares', ok: true, error: null, source: 'dolarapi', asOf: '2026-11-10T13:59:00.000Z', notes: [],
      data: [dolar('oficial', 'Oficial', 1570, 0.35), dolar('bolsa', 'MEP', 1600, -0.5), dolar('contadoconliqui', 'CCL', 1650, 0)] },
    riesgoPais: { id: 'riesgoPais', ok: true, error: null, source: 'argentinadatos', asOf: '2026-11-09', notes: [], data: item({ name: 'Riesgo país', unit: 'pb', last: 590, changeAbs: -10 }) },
    reservas: { id: 'reservas', ok: true, error: null, source: 'bcra', asOf: '2026-11-03', notes: [], data: item({ name: 'Reservas internacionales', unit: 'millones de USD', last: 50298, changeAbs: -141 }) },
    inflacion: { id: 'inflacion', ok: true, error: null, source: 'argentinadatos', asOf: '2026-09-30', notes: [], data: {
      mensual: item({ name: 'Inflación mensual', series: months(2.1) }), interanual: item({ name: 'Inflación interanual', last: 33.29, series: months(30) }),
      rem: item({ name: 'REM', last: 21.8, date: '2026-10-31', series: [{ fecha: '2026-10-31', valor: 21.8 }] }) } },
    tasas: { id: 'tasas', ok: true, error: null, source: 'bcra', asOf: '2026-11-04', notes: [], data: [item({ id: 'badlar', name: 'BADLAR', unit: '% TNA', last: 21.5, changeAbs: -1.25 }),
      item({ id: 'tamar', name: 'TAMAR', ok: false, error: 'BCRA no respondió' })] },
    futurosDolar: { id: 'futurosDolar', ok: true, error: null, source: 'a3-web', asOf: '2026-11-10T14:07:40Z', notes: [], data: {
      referencia: { a3500: 1545.4, a3500Fecha: '2026-11-05T00:00:00', mtr: null, mtrFecha: null },
      contratos: [{ ticker: 'DLR/NOV26', ultimo: 1569.5, ajuste: 1569.5, variacionPct: 0.1, interesAbierto: null, vencimiento: '2026-11-30', dias: 20, devaluacionPct: 1.56, tnaPct: 28.46, teaPct: 32.64 }] } },
  },
} as unknown as ArgentinaBoard;

beforeEach(() => (fetchArgentinaBoard as jest.Mock).mockReset().mockResolvedValue(board));

test('muestra el esqueleto y después los números grandes y las tarjetas con lo que trae la API', async () => {
  render(<Argentina />);
  expect(screen.getByRole('status', { name: 'Leyendo Argentina' })).toBeInTheDocument();
  await screen.findByRole('region', { name: 'Dólares' });
  expect(screen.getAllByText('1.570,00').length).toBeGreaterThan(0);
  expect(screen.getByText('4,5 %')).toBeInTheDocument();               // brecha CCL
  expect(screen.getByText('590 pb')).toBeInTheDocument();
  expect(screen.getAllByText('US$ 50.298 M').length).toBeGreaterThan(0);
  const futuros = screen.getByRole('region', { name: 'Futuros de dólar' });
  expect(within(futuros).getByText('DLR/NOV26')).toBeInTheDocument();
  expect(within(futuros).getByText('28,46 %')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Inflación vs REM' })).getByText('33,29 %')).toBeInTheDocument();
});

test('un bloque caído dice en una línea qué falta y no tumba a los demás', async () => {
  render(<Argentina />);
  await screen.findByRole('region', { name: 'Tasas' });
  expect(within(screen.getByRole('region', { name: 'Tasas' })).getByText('BCRA no respondió')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Tasas' })).getByText('21,50 %')).toBeInTheDocument();
});

test('al tocar una casa abre el detalle y Escape lo cierra', async () => {
  render(<Argentina />);
  const card = await screen.findByRole('region', { name: 'Dólares' });
  fireEvent.click(within(card).getByRole('button', { name: 'MEP' }));
  const dialog = screen.getByRole('dialog', { name: 'Dólar MEP' });
  expect(within(dialog).getByText('Gráfico de prueba')).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('la var. diaria con signo y color sale de la API sin recalcular', async () => {
  render(<Argentina />);
  const card = await screen.findByRole('region', { name: 'Dólares' });
  expect(within(card).getByText('−0,50 %')).toHaveClass('neg');
  expect(within(card).getByText('+0,35 %')).toHaveClass('pos');
});

test('fmtDate', () => {
  expect(fmtDate('2026-11-10')).toBe('10/11/2026');
  expect(fmtDate(null)).toBe('—');
});


test('los gráficos se explican solos: título con unidad, ejes en su unidad, REM rotulado y tooltip con el mes completo', async () => {
  render(<Argentina />);
  const card = await screen.findByRole('region', { name: 'Inflación vs REM' });
  expect(within(card).getByRole('heading', { name: 'Inflación mensual (% respecto del mes anterior)' })).toBeInTheDocument();
  expect(within(card).getAllByText('abr-26').length).toBeGreaterThan(0);               // eje X en meses con año
  expect(within(card).getAllByText(/Esperada próximos 12 meses \(REM BCRA\): 21,8 % · relevamiento 31\/10\/2026/).length).toBeGreaterThan(0);
  expect(within(card).getByText('Inflación de los últimos 12 meses, %')).toBeInTheDocument();
  const svg = within(card).getByRole('img', { name: 'Inflación mensual (% respecto del mes anterior)' });
  fireEvent.pointerMove(svg, { clientX: 100, clientY: 50 });
  expect(within(card).getByRole('status')).toHaveTextContent(/de 2026/);                // tooltip: mes completo
  expect(within(card).getAllByRole('group', { name: 'Período' }).length).toBeGreaterThan(0);
});

test('ya no hay tarjetas de bonos en dólares ni de acciones', async () => {
  render(<Argentina />);
  await screen.findByRole('region', { name: 'Dólares' });
  expect(screen.queryByRole('region', { name: 'Bonos en dólares' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Acciones' })).not.toBeInTheDocument();
});
