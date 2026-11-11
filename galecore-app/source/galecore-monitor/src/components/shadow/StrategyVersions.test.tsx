import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrategyVersions } from './StrategyVersions';
import { labRequest } from '../../api/lab';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';
import { ShadowInstance, SpecVersionMetrics } from '../../types/shadow';

jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));

const lab = labRequest as jest.Mock;
const SPEC = 'spx_sandwich';
const limites = (porOperacion: number) => ({ capital: 10000, por_operacion: porOperacion, riesgo_abierto: 400, por_apuesta: 9 });
const ver = (version: string, over: Record<string, unknown> = {}) => ({
  version, ref: `r${version}`, recorded_at: '2026-11-10T15:00:00Z', spec_hash: `sha256:${version}`, check: 'VALID', approved: false, approved_at: null, critique: null,
  factibilidad: { veredicto: 'ok', texto: `Factible ${version}`, limites_usd: limites(200) }, change: null, diff_from_previous: null, ...over,
});
const diff = { from: '1.3.2', spec: [{ path: 'entry.delta', from: 0.1, to: 0.15 }], rules: [{ rule: 'r1', change: 'added', text: 'Regla nueva: sin entradas los viernes' }], parameters: [] };
let versions: ReturnType<typeof ver>[];
const instance = { instanceId: 'i', deploymentId: 'd', versionHash: 'sha256:1.3.2', lifecycleState: 'RUNNING', schedulerState: 'IDLE', specName: SPEC, mode: 'SHADOW', createdAt: '', updatedAt: '' } as ShadowInstance;
const metrics = [{ specName: SPEC, contentHash: 'sha256:1.3.2', positionsOpened: 3, positionsClosed: 2, realizedPnl: 1234.5, winRate: 0.5 }] as unknown as SpecVersionMetrics[];
const EDITABLE = [
  { path: 'risk_limits/max_loss_per_trade_usd', label: 'Tope por operación', unit: 'USD', kind: 'number', value: '200.0' },
  { path: 'candidate_construction/sizing/fixed_contracts', label: 'Contratos', unit: '', kind: 'integer', value: '1' },
  { path: 'operational/entry_window/start', label: 'Ventana de entrada desde', unit: 'hora NY', kind: 'time', value: '09:45' },
];

beforeEach(() => {
  jest.clearAllMocks();
  versions = [ver('1.3.0', { approved: true }), ver('1.3.1', { approved: true, diff_from_previous: { from: '1.3.0', spec: [], rules: [], parameters: [] } }),
    ver('1.3.2', { approved: true, change: { reason: 'Más delta', from_version: '1.3.1' }, diff_from_previous: { ...diff, from: '1.3.1' } }),
    ver('1.4.0', { diff_from_previous: diff, factibilidad: { veredicto: 'ok', texto: 'Factible 1.4.0', limites_usd: limites(240) } })];
  lab.mockImplementation(async (url: string, body?: object) => {
    if (!body && url === `/strategies/${SPEC}/versions`) return { strategy: SPEC, versions };
    if (!body && url.endsWith('/editable')) return { ref: 'x', fields: EDITABLE };
    if (url.endsWith('/revise')) return { status: 'RECORDED', ref: `strategy:${SPEC}/1.4.1` };
    if (url.endsWith('/activate')) return { status: 'DEPLOYED', instance_id: 'i-2', existing: false, replaced_hash: 'sha256:1.3.2' };
    return { ok: true, projectId: 'p-9' };
  });
  useCurrentUserStore.setState({ user: { userId: 'u', email: 'gonzalo@x.com', username: null, isAdmin: false, canManagePlatform: false, databaseConfigured: true }, loaded: true });
});

const renderIt = (props: Partial<React.ComponentProps<typeof StrategyVersions>> = {}) =>
  render(<StrategyVersions spec={SPEC} instance={instance} metrics={metrics} {...props} />);
const open = async (props: Partial<React.ComponentProps<typeof StrategyVersions>> = {}) => {
  renderIt(props);
  fireEvent.click(await screen.findByRole('button', { name: /Versión activa v1\.3\.2/ }));
  return screen.getByRole('list', { name: 'Versiones de la estrategia' });
};
const pick = (version: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^v${version.replace(/\./g, '\\.')} `) }));

test('viene plegado con una línea y la lista se abre con la activa marcada, la más nueva arriba', async () => {
  renderIt();
  const toggle = await screen.findByRole('button', { name: 'Versión activa v1.3.2 · 4 versiones' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('list', { name: 'Versiones de la estrategia' })).toBeNull();
  fireEvent.click(toggle);
  const list = screen.getByRole('list', { name: 'Versiones de la estrategia' });
  const rows = within(list).getAllByRole('button').map(b => b.textContent);
  expect(rows).toEqual(['v1.4.0 · 10/11/2026 · borrador', 'v1.3.2 · 10/11/2026 · activa', 'v1.3.1 · 10/11/2026 · aprobada', 'v1.3.0 · 10/11/2026 · aprobada']);
  expect(within(list).getByRole('button', { name: /^v1\.3\.2 / })).toHaveAttribute('aria-current', 'true');   // marcada la activa, no la más nueva
  expect(screen.getByRole('group', { name: 'Versión 1.3.2' })).toBeInTheDocument();
});

test('cada versión lista sus cambios en renglones humanos frente a la anterior', async () => {
  const list = await open();
  expect(within(list).getAllByText('entry.delta: 0,1 → 0,15')).toHaveLength(2);
  expect(within(list).getAllByText('Regla nueva: sin entradas los viernes')).toHaveLength(2);
  expect(within(list).getByText('sin cambios')).toBeInTheDocument();
  expect(within(list).getByText('primera versión')).toBeInTheDocument();
  expect(screen.getByText('Factible 1.3.2')).toBeInTheDocument();
  expect(screen.getByText('Más delta')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText(/3 abiertas · 2 cerradas · 1\.234,5 USD realizado · 50 % ganadoras/)).toBeInTheDocument());
  pick('1.3.1');
  expect(screen.getByText('sin operaciones')).toBeInTheDocument();
});

test('el diff no lista lo que cambia en toda versión (identidad, notas) y nombra los topes en castellano', async () => {
  versions[2] = ver('1.3.2', { approved: true, diff_from_previous: { from: '1.3.1', spec: [
    { path: 'identity.created_at', from: 'a', to: 'b' }, { path: 'identity.parent_version_hash', from: 'sha256:x', to: 'sha256:y' }, { path: 'metadata.notes', from: 'viejo', to: 'nuevo' },
    { path: 'risk_limits.max_bet_pct', from: 3, to: 100 }, { path: 'risk_limits.max_loss_per_trade_usd', from: null, to: 250 }],
    rules: [{ rule: 'S3', change: 'changed', text: '', fields: ['text', 'basis'] }], parameters: [] } });
  const list = await open();
  expect(within(list).getByText('Tope por apuesta (% del riesgo abierto permitido): 3 → 100')).toBeInTheDocument();
  expect(within(list).getByText('Pérdida máxima por operación (USD): sin definir → 250')).toBeInTheDocument();
  expect(within(list).getByText('Regla S3 modificada (texto, fundamento)')).toBeInTheDocument();
  expect(screen.queryByText(/identity|metadata|sha256:y/)).toBeNull();
});

test('Activar esta versión pide confirmación con lo que cambia y los topes; la crítica se muestra y no frena; recarga y avisa', async () => {
  versions[3] = ver('1.4.0', { diff_from_previous: diff, critique: 'revisar', critique_why_not: ['muestra corta', 'sin costos'], factibilidad: { veredicto: 'ok', texto: 'Factible 1.4.0', limites_usd: limites(240) } });
  const changed = jest.fn().mockResolvedValue(undefined);
  await open({ onChanged: changed });
  expect(screen.queryByText('Activar esta versión')).toBeNull();   // la activa ya está activa
  pick('1.4.0');
  fireEvent.click(screen.getByText('Activar esta versión'));
  const box = screen.getByRole('group', { name: 'Confirmar activación' });
  expect(box).toHaveTextContent('Vas a dejar activa Spx sandwich v1.4.0 en SHADOW (simulado, sin dinero real).');
  expect(box).toHaveTextContent('Cambia frente a la activa (v1.3.2): entry.delta: 0,1 → 0,15; Regla nueva: sin entradas los viernes.');
  expect(box).toHaveTextContent('Topes: por operación 240 USD · riesgo abierto 400 USD · por apuesta 9 USD.');
  expect(box).toHaveTextContent('Crítica del agente: revisar — muestra corta; sin costos.');
  expect(lab).not.toHaveBeenCalledWith(expect.stringContaining('/activate'), expect.anything(), expect.anything());
  lab.mockClear();
  fireEvent.click(within(box).getByRole('button', { name: 'Activar' }));
  await waitFor(() => expect(lab).toHaveBeenCalledWith(`/strategies/${SPEC}/versions/1.4.0/activate`, { user: 'gonzalo' }, expect.anything()));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(lab).toHaveBeenCalledWith(`/strategies/${SPEC}/versions`);   // recarga la lista
  expect(await screen.findByText('Activada Spx sandwich v1.4.0 en SHADOW (simulado).')).toBeInTheDocument();
});

test('Cancelar no llama al Lab; sin usuario pide iniciar sesión; INVALID no ofrece activar y dice por qué', async () => {
  await open();
  pick('1.4.0');
  fireEvent.click(screen.getByText('Activar esta versión'));
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByRole('group', { name: 'Confirmar activación' })).toBeNull();
  expect(lab).not.toHaveBeenCalledWith(expect.stringContaining('/activate'), expect.anything(), expect.anything());
  useCurrentUserStore.setState({ user: null, loaded: true });
  fireEvent.click(screen.getByText('Activar esta versión'));
  expect(screen.getByText('Iniciá sesión para activar')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Activar' })).toBeNull();
});

test('una versión INVALID no se puede activar', async () => {
  versions[3] = ver('1.4.0', { check: 'INVALID' });
  await open();
  pick('1.4.0');
  expect(screen.queryByText('Activar esta versión')).toBeNull();
  expect(screen.getByText('No se puede activar: la versión no pasó la verificación (INVALID).')).toBeInTheDocument();
});

test('si el Lab rechaza o no responde, activar lo dice en castellano', async () => {
  await open();
  pick('1.4.0');
  fireEvent.click(screen.getByText('Activar esta versión'));
  lab.mockRejectedValueOnce(new Error('La versión quedó aprobada pero no activa. GaleCore rechazó el deploy.'));
  fireEvent.click(screen.getByRole('button', { name: 'Activar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('La versión quedó aprobada pero no activa. GaleCore rechazó el deploy.');
  lab.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  fireEvent.click(screen.getByRole('button', { name: 'Activar' }));
  expect(await screen.findByText('No se pudo conectar con el Lab de esta PC: ¿está abierto?')).toBeInTheDocument();
});

test('Editar muestra los parámetros, valida el tipo y guarda una versión nueva por revise', async () => {
  const changed = jest.fn().mockResolvedValue(undefined);
  await open({ onChanged: changed });
  fireEvent.click(screen.getByText('Editar'));
  const box = await screen.findByRole('group', { name: 'Editar parámetros' });
  const tope = await within(box).findByLabelText('Tope por operación');
  expect(tope).toHaveValue('200.0');
  expect(lab).toHaveBeenCalledWith(`/strategies/${SPEC}/versions/1.3.2/editable`);
  const save = within(box).getByRole('button', { name: 'Guardar como versión nueva' });
  expect(save).toBeDisabled();   // sin cambios
  fireEvent.change(within(box).getByLabelText('Contratos'), { target: { value: '1.5' } });
  expect(within(box).getByText('Tiene que ser un número entero, 0 o más.')).toBeInTheDocument();
  expect(save).toBeDisabled();
  fireEvent.change(within(box).getByLabelText('Contratos'), { target: { value: '1' } });
  fireEvent.change(within(box).getByLabelText('Ventana de entrada desde'), { target: { value: '9:45' } });
  expect(within(box).getByText('Tiene que ser una hora HH:MM, por ejemplo 13:45.')).toBeInTheDocument();
  fireEvent.change(within(box).getByLabelText('Ventana de entrada desde'), { target: { value: '10:00' } });
  fireEvent.change(tope, { target: { value: '-5' } });
  expect(within(box).getByText('Tiene que ser un número, 0 o más.')).toBeInTheDocument();
  fireEvent.change(tope, { target: { value: '240' } });
  fireEvent.change(within(box).getByLabelText('Motivo'), { target: { value: 'menos riesgo' } });
  expect(save).toBeEnabled();
  lab.mockClear();
  fireEvent.click(save);
  await waitFor(() => expect(lab).toHaveBeenCalledWith(`/strategies/${SPEC}/versions/1.3.2/revise`,
    { user: 'gonzalo', changes: { 'risk_limits/max_loss_per_trade_usd': 240, 'operational/entry_window/start': '10:00' }, reason: 'menos riesgo' }));
  expect(await screen.findByText('Guardada v1.4.1 (borrador). Para usarla, activala.')).toBeInTheDocument();
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(lab).toHaveBeenCalledWith(`/strategies/${SPEC}/versions`);
});

test('el menú ⋯ ofrece Duplicar: valida el nombre y confirma la creación', async () => {
  await open();
  expect(screen.queryByText('Duplicar como estrategia nueva')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicar como estrategia nueva' }));
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

test('si no corre ninguna versión se dice y la más nueva queda marcada', async () => {
  renderIt({ instance: null });
  fireEvent.click(await screen.findByRole('button', { name: 'Sin versión activa · 4 versiones' }));
  expect(screen.getByRole('button', { name: /^v1\.4\.0 / })).toHaveAttribute('aria-current', 'true');
});

test('si el Lab falla no renderiza nada', async () => {
  lab.mockRejectedValue(new Error('Lab apagado'));
  const { container } = renderIt();
  await waitFor(() => expect(lab).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
