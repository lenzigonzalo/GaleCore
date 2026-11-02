import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LabProyecto } from './LabProyecto';
import { labRequest } from '../../api/lab';
import { fetchShadowStatus } from '../../api/shadow';
jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
jest.mock('../../api/shadow', () => ({ fetchShadowStatus: jest.fn() }));

const project = { id: 'argentina', label: 'Argentina', relative: 'workspaces/argentina', strategies: ['bonos_ar', 'evento_ar'] };
const view = (hash: string, approved = true) => ({ current: { ref: 'strategy:x/1.0.0', approved, purpose: 'x', spec_hash: hash, recorded_at: '2026-10-30T10:00:00Z' }, integrity_failed: [] });

beforeEach(() => {
  jest.clearAllMocks();
  (labRequest as jest.Mock).mockImplementation(async (path: string) => path.endsWith('/informes') ? { informes: [] }
    : path.includes('name=bonos_ar') ? view('sha256:run') : view('sha256:other'));
});

test('etapas: En SHADOW sólo con una instancia RUNNING del mismo hash; si no, Aprobada', async () => {
  (fetchShadowStatus as jest.Mock).mockResolvedValue({ instances: [{ lifecycleState: 'RUNNING', versionHash: 'sha256:run' }, { lifecycleState: 'STOPPED', versionHash: 'sha256:other' }] });
  render(<LabProyecto project={project} running={false} onDesign={jest.fn()} onOpenFile={jest.fn()} />);
  expect(await screen.findByText('En SHADOW · 30/10/2026')).toBeInTheDocument();
  expect(screen.getByText('Aprobada · 30/10/2026')).toBeInTheDocument();
});

test('si el runtime SHADOW no responde, la etapa llega hasta Aprobada', async () => {
  (fetchShadowStatus as jest.Mock).mockRejectedValue(new Error('offline'));
  render(<LabProyecto project={project} running={false} onDesign={jest.fn()} onOpenFile={jest.fn()} />);
  expect(await screen.findAllByText('Aprobada · 30/10/2026')).toHaveLength(2);
});

test('copia compartida sin el diseño: lo dice y el clic sigue abriendo la estrategia', async () => {
  (fetchShadowStatus as jest.Mock).mockResolvedValue({ instances: [] });
  const onDesign = jest.fn();
  render(<LabProyecto project={{ ...project, externalStrategy: true }} running={false} onDesign={onDesign} onOpenFile={jest.fn()} />);
  expect(await screen.findAllByText('No incluida en esta copia')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /Diseño de Evento/ }));
  expect(onDesign).toHaveBeenCalledWith('evento_ar');
});
