import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EntryEvaluations } from './EntryEvaluations';
import { fetchShadowDiscards, fetchShadowEvaluations } from '../../api/shadow';
import { ShadowInstance } from '../../types/shadow';
import fixture from './__fixtures__/entry_sandwich_2026_10_30.json';

jest.mock('../../api/shadow', () => ({ fetchShadowDiscards: jest.fn(), fetchShadowEvaluations: jest.fn() }));
const instance = { instanceId: 'sandwich', versionHash: 'sha256:bc1ec2d9952c8d5', specName: 'sandwich_spx_0dte_1345' } as ShadowInstance;
const evaluations = fetchShadowEvaluations as jest.Mock;
const discards = fetchShadowDiscards as jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  evaluations.mockResolvedValue(fixture.evaluations);
  discards.mockResolvedValue(fixture.discards);
});

test('evidencia real SPX muestra VIX sin dato y rechazos de riesgo con fecha ET, sin atribuirlos a hoy', async () => {
  render(<EntryEvaluations instance={instance} />);
  expect(await screen.findByText('VIX < 24: sin dato')).toBeInTheDocument();
  expect(screen.getAllByText('30/10/2026 13:49:24 ET')).toHaveLength(2);
  expect(screen.getAllByText(/130.00 USD supera el tope de 9.00 USD/)).toHaveLength(3);
  expect(screen.getAllByText('Tope por apuesta')).toHaveLength(3);
  expect(screen.getByText(/Motivos registrados del 30\/10\/2026/)).toHaveTextContent('últimos 20');
  expect(screen.queryByText(/hoy/i)).not.toBeInTheDocument();
  expect(evaluations).toHaveBeenCalledWith('sandwich');
});

test('un fallo no se presenta como falta de evaluaciones y permite reintentar', async () => {
  evaluations.mockRejectedValueOnce(new Error('Network Error'));
  render(<EntryEvaluations instance={instance} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron leer');
  expect(screen.queryByText(/Sin evaluaciones registradas/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar evaluaciones' }));
  await screen.findByText('VIX < 24: sin dato');
});

test('ninguna evaluación y ausencia de instancia tienen mensajes distintos', async () => {
  evaluations.mockResolvedValue([]); discards.mockResolvedValue([]);
  const { rerender } = render(<EntryEvaluations instance={instance} />);
  expect(await screen.findByText('Sin evaluaciones registradas para esta instancia.')).toBeInTheDocument();
  rerender(<EntryEvaluations instance={null} />);
  expect(screen.getByText(/No se pudo identificar una instancia/)).toBeInTheDocument();
});

test('evaluación que pasa sin descarte no acredita una operación ni inventa motivo', async () => {
  evaluations.mockResolvedValue([fixture.evaluations[0]]); discards.mockResolvedValue([]);
  render(<EntryEvaluations instance={instance} />);
  expect(await screen.findByText(/esto no acredita una operación/)).toBeInTheDocument();
  expect(screen.getByText(/No permite atribuir un motivo de no entrada/)).toBeInTheDocument();
});

test('descartes históricos de otro día no explican la última evaluación', async () => {
  evaluations.mockResolvedValue([{ ...fixture.evaluations[3], evaluatedAt: '2026-11-02T18:49:24Z' }]);
  render(<EntryEvaluations instance={instance} />);
  await screen.findByText(/Motivos registrados del 2\/11\/2026/);
  expect(screen.queryByText(/130.00 USD supera/)).not.toBeInTheDocument();
  expect(screen.getByText('2/11/2026 13:49:24 ET')).toBeInTheDocument();
});

test('una respuesta tardía de otra instancia no reemplaza la consultada', async () => {
  let resolveOld!: (value: unknown) => void;
  evaluations.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue([]);
  const { rerender } = render(<EntryEvaluations instance={instance} />);
  rerender(<EntryEvaluations instance={{ ...instance, instanceId: 'new' }} />);
  await screen.findByText('Sin evaluaciones registradas para esta instancia.');
  resolveOld(fixture.evaluations);
  await waitFor(() => expect(evaluations).toHaveBeenCalledWith('new'));
  expect(screen.queryByText('VIX < 24: sin dato')).not.toBeInTheDocument();
});
