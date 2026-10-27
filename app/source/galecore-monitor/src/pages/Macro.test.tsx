import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Macro, fmtChange, fmtLast } from './Macro';
import { fetchMacroBoard, BoardRow, MacroBoard } from '../api/macroData';

jest.mock('../api/macroData', () => ({ fetchMacroBoard: jest.fn() }));
jest.mock('../components/macro/MacroChart', () => ({ MacroChart: () => <div>Gráfico de prueba</div> }));

const row = (over: Partial<BoardRow>): BoardRow => ({ id: 'ES', name: 'S&P 500', symbol: '/ESZ6', unit: 'pts', changeUnit: '%',
  last: 7791, changeDay: 0.27, changeWeek: -0.32, changeMonth: 2.2, asOf: '2026-10-15', source: 'tastytrade',
  spark: [{ date: '2026-10-14', value: 7770 }, { date: '2026-10-15', value: 7791 }], ...over });

const board: MacroBoard = {
  asOf: '2026-10-15T20:00:00Z',
  strip: [row({}), row({ id: 'UST10', name: 'Tesoro 10 años', symbol: 'UST10', unit: '%', changeUnit: 'pb', last: 5.1, changeDay: -9, source: 'treasury' })],
  tabs: [
    { id: 'resumen', name: 'Resumen', sections: [
      { question: '¿Hay apetito por riesgo?', detailTab: 'riesgo', groups: [{ name: '', rows: [row({})] }] },
      { question: '¿Quién lidera?', detailTab: 'liderazgo', groups: [{ name: '', rows: [row({ id: 'RSP_SPY', name: 'Igual peso vs S&P', symbol: 'RSP/SPY', unit: 'rel', last: null, changeMonth: -1.05 })] }] },
    ] },
    { id: 'liderazgo', name: 'Liderazgo', sections: [
      { question: '¿Quién lidera?', groups: [{ name: 'Quién mueve el S&P · valor sumado en el mes', rows: [row({ id: 'MSFT', name: 'MSFT', symbol: 'MSFT', valueAddedMonth: 361855389849 })] }] },
    ] },
    { id: 'mercados', name: 'Mercados', sections: [
      { question: '¿Lo confirman los demás mercados?', groups: [{ name: 'Monedas', rows: [row({ id: '6J', name: 'Yen', symbol: '/6JZ6', last: 0.006398, changeDay: null })] }] },
    ] },
  ],
  curve: { date: '2026-10-15', points: [{ tenor: '2 años', value: 4.77 }, { tenor: '5 años', value: 4.91 }, { tenor: '10 años', value: 5.1 }, { tenor: '30 años', value: 5.43 }] },
  events: [{ date: '2099-10-28', name: 'Reunión FOMC' }],
  missing: [],
};

beforeEach(() => { window.history.replaceState(null, '', '/'); (fetchMacroBoard as jest.Mock).mockReset().mockResolvedValue(board); });

test('resumen por preguntas y pestañas de detalle, todo desde la API', async () => {
  render(<Macro />);
  await screen.findByText('¿Hay apetito por riesgo?');
  expect(screen.getAllByText('7.791').length).toBeGreaterThan(0);
  expect(screen.getByText('−1,05 %')).toBeInTheDocument();
  expect(screen.queryByText('Agenda')).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /Curva/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Ver detalle →' })[1]);
  expect(screen.getByText('Quién mueve el S&P · valor sumado en el mes')).toBeInTheDocument();
  expect(screen.getByText('+US$ 362 mil M')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mercados' }));
  expect(screen.getByText('0,006398')).toBeInTheDocument();
});

test('al tocar una fila abre el detalle y Escape lo cierra', async () => {
  render(<Macro />);
  const table = await screen.findByRole('table');
  fireEvent.click(within(table).getAllByRole('button', { name: /S&P 500/ })[0]);
  const dialog = screen.getByRole('dialog', { name: 'S&P 500' });
  expect(dialog).toHaveTextContent('Tastytrade (contrato vigente)');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('formatos: cambios con signo por unidad y vacío sin dato', () => {
  expect(fmtChange(0.27, '%')).toBe('+0,27 %');
  expect(fmtChange(-9, 'pb')).toBe('−9 pb');
  expect(fmtChange(1.6, 'pts')).toBe('+1,60');
  expect(fmtChange(null, '%')).toBe('—');
  expect(fmtLast(row({ unit: '%', last: 5.1 }))).toBe('5,10 %');
  expect(fmtLast(row({ last: 1.1238 }))).toBe('1,1238');
});
