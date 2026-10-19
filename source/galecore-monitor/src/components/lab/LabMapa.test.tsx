import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { LabMapa } from './LabMapa';
import { labRequest } from '../../api/lab';
jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
jest.mock('lightweight-charts', () => ({ ColorType: { Solid: 'solid' }, LineSeries: {},
  createChart: jest.fn(() => ({ addSeries: () => ({ setData: jest.fn() }), timeScale: () => ({ fitContent: jest.fn() }), remove: jest.fn() })),
}));

const mapa = { path: 'memory/mapa-apple.md', updatedAt: '2026-10-16T17:04:00Z', title: 'Earnings de Apple', sections: [
  { heading: 'Idea', lines: [{ mark: null, text: 'Vender prima alrededor del balance del 02/11' }] },
  { heading: 'Con qué datos', lines: [{ mark: 'ok', text: 'Balance 02/11 (GaleCore)' }, { mark: 'missing', text: 'Comisiones' }] },
  { heading: 'Qué falta decidir', lines: [{ mark: null, text: 'Atravesar o salir antes' }] },
] };

beforeEach(() => jest.clearAllMocks());

test('secciones en el orden del archivo, con texto y tablas; vacías dicen que no se habló; sin estados (owner 18/10)', async () => {
  (labRequest as jest.Mock).mockResolvedValue({ mapa: { ...mapa, sections: [
    { heading: 'Qué capturamos', lines: [{ mark: null, text: 'La implícita supera a la realizada' }] },
    { heading: 'Universo', lines: [], table: { head: ['Activo', 'Qué lo mueve hoy', 'Dato'], rows: [['SPY', 'Fed 28/10', 'IV 19,9 %']] } },
    { heading: 'Reglas', lines: [] },
  ] } });
  const follow = jest.fn();
  render(<LabMapa chatId="c1" running={false} onResults={follow} />);
  expect(await screen.findByRole('heading', { name: 'Earnings de Apple' })).toBeInTheDocument();
  expect(labRequest).toHaveBeenCalledWith('/chats/c1/mapa');
  expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Qué capturamos', 'Universo', 'Reglas']);
  expect(screen.getByText('La implícita supera a la realizada')).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Fed 28/10' })).toBeInTheDocument();
  expect(screen.getByText('Todavía no se habló')).toBeInTheDocument();
  expect(screen.queryByText(/propuesta|definida|abierta/i)).not.toBeInTheDocument();
  screen.getByRole('button', { name: /Ver resultados/ }).click();
  expect(follow).toHaveBeenCalled();
});

test('sin idea todavía o sin conversación, lo dice; mientras responde vuelve a leer', async () => {
  (labRequest as jest.Mock).mockResolvedValue({ mapa: null });
  const { rerender } = render(<LabMapa chatId="c1" running={false} />);
  expect(await screen.findByText(/aparece cuando la conversación arma una idea/)).toBeInTheDocument();
  rerender(<LabMapa chatId="c1" running={true} />);
  await waitFor(() => expect(labRequest).toHaveBeenCalledTimes(2));
  rerender(<LabMapa chatId={null} running={false} />);
  expect(await screen.findByText(/aparece cuando la conversación arma una idea/)).toBeInTheDocument();
});

test('abierto sin conversación, no queda leyendo', () => {
  render(<LabMapa chatId={null} running={false} />);
  expect(screen.getByText(/aparece cuando la conversación arma una idea/)).toBeInTheDocument();
  expect(labRequest).not.toHaveBeenCalled();
});

test('un error de lectura no aparenta un mapa', async () => {
  (labRequest as jest.Mock).mockRejectedValue(new Error('offline'));
  render(<LabMapa chatId="c1" running={false} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo leer el mapa');
});

test('evidencia: cifras grandes y gráfico con su fuente detrás del «?»; un mapa viejo no muestra «Estamos»', async () => {
  (labRequest as jest.Mock).mockResolvedValue({ mapa: { ...mapa, intro: ['Estamos: probando si se cobra'], sections: [
    { heading: 'Evidencia', lines: [{ mark: null, text: '84 % · días con prima' }] },
    { heading: 'Implícita vs realizada', lines: [], chart: { fuente: 'GaleCore', corte: '2026-10-16', calculo: 'memory/calculos/vrp.py', series: [{ nombre: 'VIX', puntos: [['2020-01-31', 14]] }] } },
  ] } });
  render(<LabMapa chatId="c1" running={false} />);
  expect((await screen.findByText('84 %')).tagName).toBe('STRONG');
  expect(screen.queryByText(/probando si se cobra/)).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Implícita vs realizada' })).toBeInTheDocument();
  expect(screen.getByText('Fuente: GaleCore, hasta el 16/10/2026 · Cálculo en Archivos: vrp.py')).toBeInTheDocument();
});
