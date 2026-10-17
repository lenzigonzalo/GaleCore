import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { LabMapa } from './LabMapa';
import { labRequest } from '../../api/lab';
jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));

const mapa = { path: 'memory/mapa-apple.md', updatedAt: '2026-10-16T17:04:00Z', title: 'Earnings de Apple', sections: [
  { heading: 'Idea', lines: [{ mark: null, text: 'Vender prima alrededor del balance del 02/11' }] },
  { heading: 'Con qué datos', lines: [{ mark: 'ok', text: 'Balance 02/11 (GaleCore)' }, { mark: 'missing', text: 'Comisiones' }] },
  { heading: 'Qué falta decidir', lines: [{ mark: null, text: 'Atravesar o salir antes' }] },
] };

beforeEach(() => jest.clearAllMocks());

test('muestra los casilleros del mapa con lo que hay y lo que falta, sin botones', async () => {
  (labRequest as jest.Mock).mockResolvedValue({ mapa });
  render(<LabMapa chatId="c1" running={false} />);
  expect(await screen.findByRole('heading', { name: 'Earnings de Apple' })).toBeInTheDocument();
  expect(labRequest).toHaveBeenCalledWith('/chats/c1/mapa');
  expect(screen.getByText('Balance 02/11 (GaleCore)')).toBeInTheDocument();
  expect(screen.getByText('Falta:')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
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

test('camino con el tramo actual y las hipótesis en tabla, cada una señalable (WS-0044)', async () => {
  (labRequest as jest.Mock).mockResolvedValue({ mapa: { ...mapa, sections: [
    { heading: 'Camino', lines: [{ mark: 'ok', text: 'Idea' }, { mark: 'now', text: 'Evidencia: falta H2' }, { mark: null, text: 'Operar o no' }] },
    { heading: 'Hipótesis', lines: [], table: { header: ['', 'Qué dice', 'Estado'], rows: [['H1', 'La implícita supera a la realizada', 'Se sostiene']] } },
  ] } });
  const { container } = render(<LabMapa chatId="c1" running={false} />);
  expect(await screen.findByText('Evidencia')).toBeInTheDocument();
  expect(container.querySelector('[aria-current="step"]')).toHaveTextContent('Evidenciafalta H2');
  expect(container.querySelector('#mapa-h1')).toHaveTextContent('Se sostiene');
});
