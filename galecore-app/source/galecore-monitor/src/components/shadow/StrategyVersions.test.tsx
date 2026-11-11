import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrategyVersions } from './StrategyVersions';
import { fetchShadowMetrics } from '../../api/shadow';
import { labRequest } from '../../api/lab';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';
import { ShadowInstance } from '../../types/shadow';

jest.mock('../../api/shadow', () => ({ fetchShadowMetrics: jest.fn() }));
jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));

const lab = labRequest as jest.Mock;
const SPEC = 'spx_sandwich';
const ver = (version: string, over: Record<string, unknown> = {}) => ({
  version, ref: `r${version}`, recorded_at: '2026-11-10T15:00:00Z', spec_hash: `sha256:${version}`, check: 'VALID', approved: false, approved_at: null, critique: null,
  factibilidad: { veredicto: 'ok', texto: `Factible ${version}` }, change: null, diff_from_previous: null, ...over,
});
const diff = { from: '1.3.1', spec: [{ path: 'entry.delta', from: 0.1, to: 0.15 }], rules: [{ rule: 'r1', change: 'added', text: 'Regla nueva: sin entradas los viernes' }], parameters: [] };
let versions: ReturnType<typeof ver>[];
const instance = { instanceId: 'i', deploymentId: 'd', versionHash: 'sha256:1.3.2', lifecycleState: 'RUNNING', schedulerState: 'IDLE', specName: SPEC, mode: 'SHADOW', createdAt: '', updatedAt: '' } as ShadowInstance;

beforeEach(() => {
  jest.clearAllMocks();
  versions = [ver('1.3.0', { approved: true }), ver('1.3.1', { approved: true, diff_from_previous: { from: '1.3.0', spec: [], rules: [], parameters: [] } }),
    ver('1.3.2', { approved: true, change: { reason: 'Más delta', from_version: '1.3.1' }, diff_from_previous: diff }), ver('1.4.0', { diff_from_previous: diff })];
  lab.mockImplementation(async (url: string, body?: object) => {
    if (!body && url === `/strategies/${SPEC}/versions`) return { strategy: SPEC, versions };
    return { ok: true, projectId: 'p-9' };
  });
  (fetchShadowMetrics as jest.Mock).mockResolvedValue([{ specName: SPEC, contentHash: 'sha256:1.3.2', positionsOpened: 3, positionsClosed: 2, realizedPnl: 1234.5, winRate: 0.5 }]);
  useCurrentUserStore.setState({ user: { userId: 'u', email: 'gonzalo@x.com', username: null, isAdmin: false, canManagePlatform: false, databaseConfigured: true }, loaded: true });
});

const open = async () => { render(<StrategyVersions spec={SPEC} instance={instance} />); return screen.findByLabelText('Versiones de la estrategia') as Promise<HTMLSelectElement>; };

test('lista las versiones de la más nueva a la más vieja con su estado, marcando la activa', async () => {
  const sel = await open();
  const labels = Array.from(sel.options).map(o => o.textContent);
  expect(labels).toEqual(['1.4.0 · 10/11/2026 · borrador', '1.3.2 · 10/11/2026 · activa', '1.3.1 · 10/11/2026 · aprobada', '1.3.0 · 10/11/2026 · aprobada']);
});

test('la tarjeta cruza resultados propios por hash y lista lo que cambió', async () => {
  const sel = await open();
  fireEvent.change(sel, { target: { value: '1.3.2' } });
  expect(screen.getByText('Factible 1.3.2')).toBeInTheDocument();
  expect(screen.getByText('Más delta')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText(/3 abiertas · 2 cerradas · 1\.234,5 USD realizado · 50 % ganadoras/)).toBeInTheDocument());
  expect(screen.getByText('Qué cambió frente a la 1.3.1')).toBeInTheDocument();
  expect(screen.getByText('entry.delta: 0.1 → 0.15')).toBeInTheDocument();
  expect(screen.getByText('Regla nueva: sin entradas los viernes')).toBeInTheDocument();
  expect(screen.queryByText('Aprobar versión')).toBeNull();
});

test('sin fila de métricas dice sin operaciones; sin cambios y primera versión', async () => {
  const sel = await open();
  expect(screen.getByText('sin operaciones')).toBeInTheDocument();
  fireEvent.change(sel, { target: { value: '1.3.1' } });
  expect(screen.getByText('sin cambios')).toBeInTheDocument();
  fireEvent.change(sel, { target: { value: '1.3.0' } });
  expect(screen.getByText('primera versión')).toBeInTheDocument();
});

test('aprobar pide confirmación, llama al Lab con la ruta y el cuerpo exactos y recarga', async () => {
  await open();
  fireEvent.click(screen.getByText('Aprobar versión'));
  expect(screen.getByText(/¿Activás Spx sandwich 1\.4\.0 en SHADOW \(simulado, sin dinero real\)\?/)).toBeInTheDocument();
  lab.mockClear();
  fireEvent.click(screen.getByText('Sí'));
  await waitFor(() => expect(lab).toHaveBeenCalledWith(`/strategies/${SPEC}/versions/1.4.0/approve`, { user: 'gonzalo' }));
  await waitFor(() => expect(lab).toHaveBeenCalledWith(`/strategies/${SPEC}/versions`));
});

test('muestra el error del Lab si falla la aprobación', async () => {
  await open();
  fireEvent.click(screen.getByText('Aprobar versión'));
  lab.mockRejectedValueOnce(new Error('Spec inválida'));
  fireEvent.click(screen.getByText('Sí'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Spec inválida');
});

test('con check INVALID el Sí queda deshabilitado', async () => {
  versions[3] = ver('1.4.0', { check: 'INVALID' });
  await open();
  fireEvent.click(screen.getByText('Aprobar versión'));
  expect(screen.getByText('Sí')).toBeDisabled();
});

test('sin usuario pide iniciar sesión', async () => {
  useCurrentUserStore.setState({ user: null, loaded: true });
  await open();
  fireEvent.click(screen.getByText('Aprobar versión'));
  expect(screen.getByText('Iniciá sesión para aprobar')).toBeInTheDocument();
});

test('duplicar valida el nombre y confirma la creación', async () => {
  const sel = await open();
  fireEvent.change(sel, { target: { value: '1.3.2' } });
  fireEvent.click(screen.getByText('Duplicar como estrategia nueva'));
  const input = screen.getByLabelText('Nombre de la estrategia nueva') as HTMLInputElement;
  expect(input.value).toBe('spx_sandwich_copia');
  fireEvent.change(input, { target: { value: 'Mala Nombre' } });
  expect(screen.getByRole('alert')).toHaveTextContent('El nombre va en minúsculas');
  expect(screen.getByText('Sí')).toBeDisabled();
  fireEvent.change(input, { target: { value: 'spx_nueva' } });
  fireEvent.click(screen.getByText('Sí'));
  await waitFor(() => expect(lab).toHaveBeenCalledWith(`/strategies/${SPEC}/duplicate`, { version: '1.3.2', newName: 'spx_nueva', user: 'gonzalo' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Creada spx_nueva en borrador, copiada de spx_sandwich 1.3.2. La original no cambió. Proyecto: p-9.');
});

test('si el Lab falla no renderiza nada', async () => {
  lab.mockRejectedValue(new Error('Lab apagado'));
  const { container } = render(<StrategyVersions spec={SPEC} instance={instance} />);
  await waitFor(() => expect(lab).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
