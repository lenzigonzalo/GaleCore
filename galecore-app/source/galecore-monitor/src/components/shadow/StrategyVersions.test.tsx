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
const toggleOf = () => screen.getByRole('button', { name: /^(v\d+\.\d+\.\d+|Sin versión activa)( · .+)? ▾$/ });
const listOf = () => screen.getByRole('list', { name: 'Versiones de la estrategia' });
const pick = (version: string) => {
  if (!screen.queryByRole('list', { name: 'Versiones de la estrategia' })) fireEvent.click(toggleOf());
  fireEvent.click(within(listOf()).getByRole('button', { name: new RegExp(`^v${version.replace(/\./g, '\\.')} `) }));
};
// Abre el panel de la versión elegida (la activa si no se dice otra).
const open = async (version = '1.3.2', props: Partial<React.ComponentProps<typeof StrategyVersions>> = {}) => {
  renderIt(props);
  await screen.findByRole('button', { name: /▾$/ });
  pick(version);
  return screen.getByRole('group', { name: `Versión ${version}` });
};

test('el botón compacto muestra la activa; la lista tiene una fila por versión sin diffs y el panel aparece al elegir', async () => {
  renderIt();
  const toggle = await screen.findByRole('button', { name: 'v1.3.2 ▾' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('group', { name: /^Versión/ })).toBeNull();   // sin elegir no hay panel
  fireEvent.click(toggle);
  const rows = within(listOf()).getAllByRole('button').map(b => b.textContent);
  expect(rows).toEqual(['v1.4.0 · 10/11 · borrador', '●v1.3.2 · 10/11 · activa', 'v1.3.1 · 10/11 · aprobada', 'v1.3.0 · 10/11 · aprobada']);
  expect(within(listOf()).getByRole('button', { name: /^v1\.3\.2 / })).toHaveAttribute('aria-current', 'true');
  expect(within(listOf()).queryByText(/entry\.delta|Regla nueva|sin cambios|primera versión/)).toBeNull();
  fireEvent.click(within(listOf()).getByRole('button', { name: /^v1\.3\.2 / }));
  const panel = screen.getByRole('group', { name: 'Versión 1.3.2' });
  await waitFor(() => expect(panel).toHaveTextContent('v1.3.2 · activa · 3 abiertas · 2 cerradas · 1.234,5 USD realizado · 50 % ganadoras'));
  expect(panel).not.toHaveTextContent('Cambia:');   // la activa no se compara consigo misma
  expect(within(panel).queryByRole('button', { name: 'Activar' })).toBeNull();
});

test('elegir una fila cierra la lista y muestra su panel; Escape y un clic afuera la cierran', async () => {
  renderIt();
  fireEvent.click(await screen.findByRole('button', { name: 'v1.3.2 ▾' }));
  fireEvent.click(within(listOf()).getByRole('button', { name: /^v1\.3\.1 / }));
  expect(screen.queryByRole('list', { name: 'Versiones de la estrategia' })).toBeNull();
  expect(screen.getByRole('group', { name: 'Versión 1.3.1' })).toHaveTextContent('v1.3.1 · aprobada · sin operaciones');
  fireEvent.click(toggleOf());
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('list', { name: 'Versiones de la estrategia' })).toBeNull();
  fireEvent.click(toggleOf());
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('list', { name: 'Versiones de la estrategia' })).toBeNull();
});

test('«Cambia» muestra el primer cambio vs la activa en castellano, sin lo que cambia en toda versión, y «(+N más)» despliega el resto', async () => {
  versions[3] = ver('1.4.0', { diff_from_previous: { from: '1.3.2', spec: [
    { path: 'identity.created_at', from: 'a', to: 'b' }, { path: 'identity.parent_version_hash', from: 'sha256:x', to: 'sha256:y' }, { path: 'metadata.notes', from: 'viejo', to: 'nuevo' },
    { path: 'risk_limits.max_bet_pct', from: 3, to: 100 }, { path: 'risk_limits.max_loss_per_trade_usd', from: null, to: 250 }],
    rules: [{ rule: 'S3', change: 'changed', text: '', fields: ['text', 'basis'] }], parameters: [] } });
  const panel = await open('1.4.0');
  expect(panel).toHaveTextContent('Cambia: Tope por apuesta (% del riesgo abierto permitido): 3 → 100 (+2 más)');
  expect(panel).not.toHaveTextContent(/identity|metadata|sha256:y/);
  expect(panel).not.toHaveTextContent('Pérdida máxima por operación');
  fireEvent.click(within(panel).getByRole('button', { name: '(+2 más)' }));
  expect(panel).toHaveTextContent('Pérdida máxima por operación (USD): sin definir → 250');
  expect(panel).toHaveTextContent('Regla S3 modificada (texto, fundamento)');
  expect(within(panel).queryByRole('button', { name: /más\)/ })).toBeNull();
});

test('Activar pide confirmación en una línea; la crítica va en el panel; recarga y avisa en una línea', async () => {
  versions[3] = ver('1.4.0', { diff_from_previous: diff, critique: 'revisar', critique_why_not: ['muestra corta', 'sin costos'] });
  const changed = jest.fn().mockResolvedValue(undefined);
  const panel = await open('1.4.0', { onChanged: changed });
  expect(panel).toHaveTextContent('Crítica del agente: revisar — muestra corta; sin costos.');
  fireEvent.click(within(panel).getByRole('button', { name: 'Activar' }));
  const box = screen.getByRole('group', { name: 'Confirmar activación' });
  expect(box).toHaveTextContent('¿Activar v1.4.0 en SHADOW?');
  expect(box).not.toHaveTextContent(/Topes|Crítica|Cambia/);
  expect(lab).not.toHaveBeenCalledWith(expect.stringContaining('/activate'), expect.anything(), expect.anything());
  lab.mockClear();
  fireEvent.click(within(box).getByRole('button', { name: 'Sí' }));
  await waitFor(() => expect(lab).toHaveBeenCalledWith(`/strategies/${SPEC}/versions/1.4.0/activate`, { user: 'gonzalo' }, expect.anything()));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(lab).toHaveBeenCalledWith(`/strategies/${SPEC}/versions`);   // recarga la lista
  expect(await screen.findByText('Activada v1.4.0.')).toBeInTheDocument();
});

test('No no llama al Lab; sin usuario pide iniciar sesión', async () => {
  const panel = await open('1.4.0');
  fireEvent.click(within(panel).getByRole('button', { name: 'Activar' }));
  fireEvent.click(screen.getByRole('button', { name: 'No' }));
  expect(screen.queryByRole('group', { name: 'Confirmar activación' })).toBeNull();
  expect(lab).not.toHaveBeenCalledWith(expect.stringContaining('/activate'), expect.anything(), expect.anything());
  useCurrentUserStore.setState({ user: null, loaded: true });
  fireEvent.click(within(panel).getByRole('button', { name: 'Activar' }));
  expect(screen.getByText('Iniciá sesión para activar')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sí' })).toBeNull();
});

test('una versión INVALID no se puede activar', async () => {
  versions[3] = ver('1.4.0', { check: 'INVALID' });
  const panel = await open('1.4.0');
  expect(within(panel).queryByRole('button', { name: 'Activar' })).toBeNull();
  expect(panel).toHaveTextContent('No se puede activar: no pasó la verificación (INVALID).');
});

test('si el Lab rechaza o no responde, activar lo dice en castellano', async () => {
  const panel = await open('1.4.0');
  fireEvent.click(within(panel).getByRole('button', { name: 'Activar' }));
  lab.mockRejectedValueOnce(new Error('La versión quedó aprobada pero no activa. GaleCore rechazó el deploy.'));
  fireEvent.click(screen.getByRole('button', { name: 'Sí' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('La versión quedó aprobada pero no activa. GaleCore rechazó el deploy.');
  lab.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  fireEvent.click(screen.getByRole('button', { name: 'Sí' }));
  expect(await screen.findByText('No se pudo conectar con el Lab.')).toBeInTheDocument();
});

test('Editar muestra los parámetros, valida el tipo y guarda una versión nueva por revise', async () => {
  const changed = jest.fn().mockResolvedValue(undefined);
  const panel = await open('1.3.2', { onChanged: changed });
  fireEvent.click(within(panel).getByRole('button', { name: 'Editar' }));
  const box = await screen.findByRole('group', { name: 'Editar parámetros' });
  expect(box).toHaveTextContent('Se guarda como versión nueva.');
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
  expect(await screen.findByText('Guardada v1.4.1 (borrador).')).toBeInTheDocument();
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(lab).toHaveBeenCalledWith(`/strategies/${SPEC}/versions`);
});

test('el menú ⋯ ofrece Duplicar: valida el nombre y confirma la creación', async () => {
  await open();
  expect(screen.queryByRole('menuitem', { name: 'Duplicar' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicar' }));
  const input = screen.getByLabelText('Nombre de la estrategia nueva') as HTMLInputElement;
  expect(input.value).toBe('spx_sandwich_copia');
  fireEvent.change(input, { target: { value: 'Mala Nombre' } });
  expect(screen.getByRole('alert')).toHaveTextContent('El nombre va en minúsculas');
  expect(screen.getByText('Sí')).toBeDisabled();
  fireEvent.change(input, { target: { value: 'spx_nueva' } });
  fireEvent.click(screen.getByText('Sí'));
  await waitFor(() => expect(lab).toHaveBeenCalledWith(`/strategies/${SPEC}/duplicate`, { version: '1.3.2', newName: 'spx_nueva', user: 'gonzalo' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Creada spx_nueva (borrador). Proyecto: p-9.');
});

test('si no corre ninguna versión el botón dice «Sin versión activa» y ninguna fila lleva ●', async () => {
  renderIt({ instance: null });
  fireEvent.click(await screen.findByRole('button', { name: 'Sin versión activa ▾' }));
  expect(within(listOf()).getAllByRole('button').map(b => b.textContent)).toEqual(['v1.4.0 · 10/11 · borrador', 'v1.3.2 · 10/11 · aprobada', 'v1.3.1 · 10/11 · aprobada', 'v1.3.0 · 10/11 · aprobada']);
});

test('Renombrar guarda el nombre como dato de la versión y lo muestra en el botón y en la lista', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Renombrar' }));
  const input = screen.getByLabelText('Nombre de la versión') as HTMLInputElement;
  expect(input.value).toBe('');
  fireEvent.change(input, { target: { value: ' Base calmada ' } });
  lab.mockClear();
  versions[2] = ver('1.3.2', { approved: true, label: 'Base calmada', change: { reason: 'Más delta', from_version: '1.3.1' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(lab).toHaveBeenCalledWith(`/strategies/${SPEC}/versions/1.3.2/label`, { user: 'gonzalo', label: 'Base calmada' }));
  expect(await screen.findByRole('button', { name: 'v1.3.2 · Base calmada ▾' })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Renombrar versión' })).toBeNull();
  fireEvent.click(toggleOf());
  expect(within(listOf()).getByRole('button', { name: /^v1\.3\.2 · 10\/11 · activa · Base calmada$/ })).toBeInTheDocument();
});

test('Renombrar con el nombre vacío lo borra; Escape cancela sin llamar al Lab', async () => {
  versions[2] = ver('1.3.2', { approved: true, label: 'Vieja' });
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Renombrar' }));
  let input = screen.getByLabelText('Nombre de la versión') as HTMLInputElement;
  expect(input.value).toBe('Vieja');
  lab.mockClear();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('group', { name: 'Renombrar versión' })).toBeNull();
  expect(lab).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Renombrar' }));
  input = screen.getByLabelText('Nombre de la versión') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '   ' } });
  versions[2] = ver('1.3.2', { approved: true });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(lab).toHaveBeenCalledWith(`/strategies/${SPEC}/versions/1.3.2/label`, { user: 'gonzalo', label: '' }));
  expect(await screen.findByRole('button', { name: 'v1.3.2 ▾' })).toBeInTheDocument();
});

test('si el Lab falla no renderiza nada', async () => {
  lab.mockRejectedValue(new Error('Lab apagado'));
  const { container } = renderIt();
  await waitFor(() => expect(lab).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
