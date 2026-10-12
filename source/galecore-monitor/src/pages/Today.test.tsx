import React from 'react';
import { render, screen } from '@testing-library/react';
import { Today } from './Today';
import { fetchSpace } from '../api/space';
jest.mock('../api/space', () => ({ fetchSpace: jest.fn() }));
const fetchMock = fetchSpace as jest.MockedFunction<typeof fetchSpace>;

test('un fallo de lectura no se presenta como ausencia de avisos', async () => {
  fetchMock.mockRejectedValue(new Error('Fuente inaccesible'));
  render(<Today onNavigate={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No podemos confirmar la actividad actual');
  expect(screen.queryByText(/Esta publicación no contiene avisos/)).not.toBeInTheDocument();
});

test('una publicación ilegible no se convierte en una revisión sin hallazgos', async () => {
  // Fixture sintético de contrato, no snapshot de mercado.
  fetchMock.mockResolvedValue({ items: [{ kind: 'agent', key: 'supervisor', title: 'Supervisor', content: '{invalid',
    format: 'json', visibility: 'private', version: 1, updatedAt: '2026-10-09T12:00:00Z', owner: 'test', isOwn: true }], shared: [] });
  render(<Today onNavigate={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('no se pudieron interpretar');
  expect(screen.getByText(/No hay una revisión legible/)).toBeInTheDocument();
});

test.each([{}, { last_run: { at: '2026-10-09T12:00:00Z', result: 'ok', failed: false } }])(
  'publicación incompleta del supervisor no confirma ausencia de avisos: %j', async content => {
    fetchMock.mockResolvedValue({ items: [{ kind: 'agent', key: 'supervisor', title: 'Supervisor', content: JSON.stringify(content),
      format: 'json', visibility: 'private', version: 1, updatedAt: '2026-10-09T12:00:00Z', owner: 'test', isOwn: true }], shared: [] });
    render(<Today onNavigate={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('no se pudieron interpretar');
    expect(screen.queryByText(/Esta publicación no contiene avisos/)).not.toBeInTheDocument();
  },
);
