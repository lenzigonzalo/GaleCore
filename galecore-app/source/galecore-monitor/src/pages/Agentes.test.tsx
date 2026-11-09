import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Agentes } from './Agentes';
import { fetchSpace, saveSpaceItem, SpaceItem } from '../api/space';
import * as agentsApi from '../api/agents';

jest.mock('../api/space', () => ({ fetchSpace: jest.fn(), saveSpaceItem: jest.fn() }));
jest.mock('../api/agents', () => ({
  ...jest.requireActual('../api/agents'),
  fetchRuns: jest.fn(), fetchFireToken: jest.fn(), saveFireToken: jest.fn(), deleteFireToken: jest.fn(), runAgent: jest.fn(),
  fetchAgentKey: jest.fn(), generateAgentKey: jest.fn(), revokeAgentKey: jest.fn(),
}));
const api = agentsApi as jest.Mocked<typeof agentsApi>;
jest.mock('../components/settings/Markdown', () => ({ Markdown: ({ text }: { text: string }) => <div>{text}</div> }));

const task = {
  id: 'spy-watch', capability: 'market_watch', status: 'active', schedule: 'Días hábiles a las 10:00',
  editable: true, model_editable: true, model: null, model_default: 'sonnet', objective: 'Observar SPY', state: 'CURRENT', runs: 8, findings: 'Resultado publicado por el agente',
  last_run: { at: '2026-10-14T13:00:00Z', result: 'Sin novedades', failed: false, model: 'modelo publicado', invoked_by: 'scheduler' },
};
const item: SpaceItem = { key: task.id, title: 'Mi vigilancia de SPY', kind: 'agent', content: JSON.stringify(task), format: 'json', visibility: 'private', version: 1, owner: 'trader', isOwn: true, updatedAt: '2026-10-14T13:01:00Z' };
beforeEach(() => {
  jest.clearAllMocks();
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [item], shared: [] });
  (saveSpaceItem as jest.Mock).mockResolvedValue(undefined);
});

test('abre la tarea, muestra el único resultado publicado y vuelve al listado', async () => {
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: /Mi vigilancia de SPY/ }));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(item.title);
  expect(screen.getByRole('heading', { name: 'Corridas' })).toBeInTheDocument();
  expect(screen.getByText(task.findings)).not.toBeVisible();
  expect(screen.getByText(/8 corridas registradas/)).toHaveTextContent('historial anterior todavía no se publicó');
  expect(screen.queryByText('Al día')).not.toBeInTheDocument();
  expect(screen.getByText('Días hábiles, 10:00')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Agentes' }));
  expect(screen.getByRole('button', { name: 'Nuevo agente' })).toBeInTheDocument();
});

test('pausar conserva la tarea y escribe un pedido sin fingir que ya se aplicó', async () => {
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: /Mi vigilancia de SPY/ }));
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ ...item, content: JSON.stringify({ ...task, request: { status: 'paused' } }) }], shared: [] });
  fireEvent.click(screen.getByRole('switch', { name: 'Pausar tarea' }));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledTimes(1));
  const [kind, key, body] = (saveSpaceItem as jest.Mock).mock.calls[0];
  expect([kind, key]).toEqual(['agent', item.key]);
  expect(JSON.parse(body.content)).toMatchObject({ ...task, request: { status: 'paused' } });
  expect(await screen.findByText('Pausando…')).toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
});

test('el supervisor de SHADOW no aparece entre tus tareas', async () => {
  const sup = { ...item, key: 'supervisor', title: 'supervisor', content: JSON.stringify({ ...task, id: 'supervisor', capability: 'supervisor' }) };
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [item, sup], shared: [] });
  render(<Agentes />);
  expect(await screen.findByRole('button', { name: /Mi vigilancia de SPY/ })).toBeInTheDocument();
  expect(screen.queryByText(/Avisos de estrategias|^supervisor$/)).not.toBeInTheDocument();
});

test('muestra el vacío y permite reintentar una lectura fallida', async () => {
  (fetchSpace as jest.Mock).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ items: [], shared: [] });
  render(<Agentes />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo leer');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Todavía no tenés agentes')).toBeInTheDocument();
});

test('un resultado viejo conserva el aviso de falta de publicación', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ ...item, content: JSON.stringify({ ...task, next_expected_at: '2020-01-01T00:00:00Z' }) }], shared: [] });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: /Mi vigilancia de SPY/ }));
  expect(screen.getByText(/Sin noticias de tu PC desde/)).toBeInTheDocument();
  expect(screen.getByText(task.findings)).not.toBeVisible();
  expect(screen.queryByText(/Próxima:/)).not.toBeInTheDocument();
});

test('el toggle está en la vista general sin abrir una tarea', async () => {
  render(<Agentes />);
  expect(await screen.findByRole('switch', { name: 'Pausar tarea' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Corridas' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch', { name: 'Pausar tarea' }));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledTimes(1));
});

test('agrupa por fecha y deja los errores técnicos dentro de cada corrida plegada', async () => {
  const history = [
    { at: '2026-10-14T16:00:00Z', result: 'INCOMPLETE', failed: false, reason: 'output refused: Malformed reference', findings: null },
    { at: '2026-10-14T14:00:00Z', result: 'OK', failed: false, findings: 'Informe de las 14' },
    { at: '2026-10-13T14:00:00Z', result: 'OK', failed: false, findings: 'Informe del día anterior' },
  ];
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ ...item, content: JSON.stringify({ ...task, history, history_total: 3 }) }], shared: [] });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: /Mi vigilancia de SPY/ }));
  expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
  expect(screen.getByText('Análisis incompleto')).toBeVisible();
  expect(screen.getByText('output refused: Malformed reference')).not.toBeVisible();
  expect(screen.getByText('Informe de las 14')).not.toBeVisible();
  expect(screen.queryByText(task.findings)).not.toBeInTheDocument();
});

test('edita instrucciones y modelo mediante un pedido pendiente, sin cambiar frecuencia ni estado', async () => {
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: /Mi vigilancia de SPY/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Qué debe hacer' }), { target: { value: 'Observar QQQ y avisar' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Modelo' }), { target: { value: 'haiku' } });
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ ...item, content: JSON.stringify({ ...task, request: { settings: { objective: 'Observar QQQ y avisar', model: 'haiku' } } }) }], shared: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledTimes(1));
  const saved = JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content);
  expect(saved.request.settings).toEqual({ objective: 'Observar QQQ y avisar', model: 'haiku' });
  expect(saved.schedule).toBe(task.schedule);
  expect(saved.status).toBe('active');
  expect(await screen.findByText('Guardando cambios…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Editar' })).toBeDisabled();
});

const fullTask = {
  ...task, schedule_spec: { frequency: 'weekdays', time: '10:00', timezone: 'America/New_York' },
  tools: ['Read', 'Bash(python -B -m galecore_ai.adapters.cli state:*)', 'Bash(python -B -m galecore_ai.adapters.cli kb search:*)'],
  tools_available: ['Read', 'Bash(python -B -m galecore_ai.adapters.cli state:*)', 'Bash(python -B -m galecore_ai.adapters.cli kb search:*)'],
  delivery: ['historial'],
};
const openEditor = async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ ...item, content: JSON.stringify(fullTask) }], shared: [] });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: /Mi vigilancia de SPY/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
};
const savedSettings = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledTimes(1));
  return JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content).request.settings;
};

test('cambiar a días elegidos pide la frecuencia con esos días y no deja guardar sin ninguno', async () => {
  await openEditor();
  fireEvent.change(screen.getByRole('combobox', { name: 'Frecuencia' }), { target: { value: 'days' } });
  expect(screen.getByRole('checkbox', { name: 'Lun' })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Lun' }));
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Mié' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Jue' }));
  const settings = await savedSettings();
  expect(settings.schedule).toEqual({ frequency: 'days', days: ['wed', 'thu'], time: '10:00', timezone: 'America/New_York' });
  expect(settings.tools).toBeUndefined();
  expect(settings.delivery).toBeUndefined();
});

test('quitar una herramienta manda sólo las que quedan; dejar todas no manda nada', async () => {
  await openEditor();
  fireEvent.click(screen.getByRole('checkbox', { name: 'kb search' }));
  const settings = await savedSettings();
  expect(settings.tools).toEqual(['Read', 'Bash(python -B -m galecore_ai.adapters.cli state:*)']);
  expect(settings.schedule).toBeUndefined();
});

test('volver a marcar todas las herramientas manda null (todas las de la skill)', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ ...item, content: JSON.stringify({ ...fullTask, tools: ['Read', 'Bash(python -B -m galecore_ai.adapters.cli state:*)'] }) }], shared: [] });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: /Mi vigilancia de SPY/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'kb search' }));
  expect((await savedSettings()).tools).toBeNull();
});

test('pedir el informe en la Biblioteca manda la entrega, y el historial no se puede quitar', async () => {
  await openEditor();
  expect(screen.getByRole('checkbox', { name: 'Historial de corridas' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Informe en la Biblioteca' }));
  expect((await savedSettings()).delivery).toEqual(['historial', 'biblioteca']);
});

test('guardar sin cambiar nada cierra el editor y no escribe ningún pedido', async () => {
  await openEditor();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  expect(await screen.findByRole('button', { name: 'Editar' })).toBeEnabled();
  expect(saveSpaceItem).not.toHaveBeenCalled();
});

test('muestra el método del agente y la última corrida de cada script, o que no hubo', async () => {
  const skill_scripts = { skill: 'revisar-swing-etfs', scripts: [
    { script: 'revision_swing.py', last_run: { at: '2026-11-01T13:00:00Z', ok: false, error: 'Traceback\nTimeout tras 180 s' } },
    { script: 'otro.py', last_run: null },
  ] };
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ ...item, content: JSON.stringify({ ...task, skill_scripts }) }], shared: [] });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: /Mi vigilancia de SPY/ }));
  expect(screen.getByText(/Método:/)).toHaveTextContent('Revisar');
  expect(screen.getByText(/revision_swing\.py/)).toHaveTextContent(/Falló.*Timeout tras 180 s/);
  expect(screen.queryByText(/Traceback/)).not.toBeInTheDocument();
  expect(screen.getByText(/otro\.py/)).toHaveTextContent('Sin corridas');
});

// ── WS-0079: agentes en la nube ─────────────────────────────────────────────

const cloud = {
  id: 'Resumen diario', runs_on: 'cloud', capability: 'routine', status: 'active', objective: 'Resumí SPY y VIX',
  schedule: 'todos los días a las 08:00 (America/New_York)', schedule_spec: { frequency: 'daily', time: '08:00', timezone: 'America/New_York' },
  trigger_id: 'trig_1', routine_url: 'https://claude.ai/code/routines/trig_1', model: 'claude-sonnet-5',
};
const cloudItem: SpaceItem = { ...item, key: 'resumen-diario', title: 'Resumen diario', content: JSON.stringify(cloud) };
const run = { id: 'r1', agent_key: 'resumen-diario', origin: 'manual', status: 'ok', summary: 'SPY **sube**', session_url: 'https://claude.ai/code/session_1', created_at: '2026-11-09T13:00:00Z', finished_at: '2026-11-09T13:02:00Z' };

function openCloud(content: object = cloud) {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ ...cloudItem, content: JSON.stringify(content) }], shared: [] });
  api.fetchRuns.mockResolvedValue([run as any]);
  api.fetchFireToken.mockResolvedValue({ exists: false });
  render(<Agentes />);
  return screen.findByRole('button', { name: 'Resumen diario' }).then(b => fireEvent.click(b));
}

test('Nuevo agente pide nombre, qué hace y cuándo, y escribe la pieza en la nube con su pedido de alta', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [], shared: [] });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: 'Nuevo agente' }));
  expect(screen.queryByLabelText('Partir de una plantilla')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Modelo')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Crear' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Resumen diario' } });
  fireEvent.change(screen.getByLabelText('Qué hace'), { target: { value: 'Resumí SPY y VIX' } });
  fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '08:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledTimes(1));
  const [kind, key, body] = (saveSpaceItem as jest.Mock).mock.calls[0];
  expect([kind, key, body.title]).toEqual(['agent', 'resumen-diario', 'Resumen diario']);
  const piece = JSON.parse(body.content);
  expect(piece).toMatchObject({ id: 'Resumen diario', runs_on: 'cloud', capability: 'routine', status: 'pending', objective: 'Resumí SPY y VIX', trigger_id: null });
  expect(piece.schedule_spec).toEqual({ frequency: 'daily', time: '08:00', timezone: 'America/New_York' });
  expect(piece.request.create).toEqual({ id: 'Resumen diario', objective: 'Resumí SPY y VIX', schedule_spec: piece.schedule_spec });
  expect(typeof piece.request.at).toBe('string');
});

test('un agente que se está creando se ve como «Creando…»', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ ...cloudItem, content: JSON.stringify({ ...cloud, status: 'pending', trigger_id: null, request: { create: {}, at: '2026-11-09T13:00:00Z' } }) }], shared: [] });
  render(<Agentes />);
  expect(await screen.findByRole('button', { name: 'Resumen diario' })).toBeInTheDocument();
  expect(screen.getAllByText('Creando…').length).toBeGreaterThan(0);
});

test('el detalle de un agente en la nube muestra sus corridas del back, con resumen y link a la sesión', async () => {
  await openCloud();
  expect(await screen.findByText('Completada')).toBeInTheDocument();
  expect(api.fetchRuns).toHaveBeenCalledWith('resumen-diario');
  expect(screen.getByText('SPY **sube**')).not.toBeVisible();
  expect(screen.getByRole('link', { name: /Ver la sesión/ })).toHaveAttribute('href', 'https://claude.ai/code/session_1');
  expect(screen.getByText('Manual')).toBeInTheDocument();
});

test('una corrida pedida que no reportó se ve como «No reportó»', async () => {
  await openCloud();
  api.fetchRuns.mockResolvedValue([{ ...run, status: 'no_report', summary: null } as any]);
  fireEvent.click(screen.getByRole('button', { name: 'Agentes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Resumen diario' }));
  expect(await screen.findByText('No reportó')).toBeInTheDocument();
  expect(screen.getByText('La corrida no reportó su resultado.')).toBeInTheDocument();
});

test('Ejecutar con token llama a la API y avisa; sin token escribe request.run para el Lab', async () => {
  await openCloud();
  api.fetchFireToken.mockResolvedValue({ exists: true, trigger_id: 'trig_1', token_hint: 'abcd' });
  api.runAgent.mockResolvedValue({ ...run, status: 'requested' } as any);
  fireEvent.click(screen.getByRole('button', { name: 'Agentes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Resumen diario' }));
  await screen.findByText(/Token cargado …abcd/);
  fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));
  await waitFor(() => expect(api.runAgent).toHaveBeenCalledWith('resumen-diario'));
  expect(await screen.findByText(/la corrida aparece en la lista/)).toBeInTheDocument();
  expect(saveSpaceItem).not.toHaveBeenCalled();
});

test('Ejecutar sin token pide la corrida al Lab', async () => {
  await openCloud();
  await screen.findByText('Completada');
  fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledTimes(1));
  expect(api.runAgent).not.toHaveBeenCalled();
  expect(JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content)).toMatchObject({ ...cloud, request: { run: true } });
  expect(await screen.findByText('Se ejecuta cuando el Lab esté abierto.')).toBeInTheDocument();
});

test.each([
  [409, 'La rutina está pausada: activala en claude.ai.'],
  [502, 'El token de esta rutina no anda: generá otro en claude.ai.'],
  [429, 'Esperá unos minutos antes de volver a ejecutarlo.'],
])('los errores %s de Ejecutar salen con el mensaje de la API', async (status, error) => {
  await openCloud();
  api.fetchFireToken.mockResolvedValue({ exists: true, trigger_id: 'trig_1', token_hint: 'abcd' });
  api.runAgent.mockRejectedValue({ response: { status, data: { error } } });
  fireEvent.click(screen.getByRole('button', { name: 'Agentes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Resumen diario' }));
  await screen.findByText(/Token cargado/);
  fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(error);
});

test('editar instrucciones y horario escribe request.settings con sólo esos campos', async () => {
  await openCloud();
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Qué hace' }), { target: { value: 'Resumí QQQ' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Frecuencia' }), { target: { value: 'weekdays' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledTimes(1));
  const saved = JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content);
  expect(saved.request.settings).toEqual({ objective: 'Resumí QQQ', schedule_spec: { frequency: 'weekdays', time: '08:00', timezone: 'America/New_York' } });
  expect(saved.status).toBe('active');
});

test('pausar un agente en la nube escribe request.status', async () => {
  await openCloud();
  fireEvent.click(screen.getByRole('switch', { name: 'Pausar tarea' }));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledTimes(1));
  expect(JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content).request).toMatchObject({ status: 'paused' });
});

test('el token de disparo se guarda sin volver a mostrarse: sólo los últimos 4; Quitar lo borra', async () => {
  await openCloud();
  api.saveFireToken.mockResolvedValue({ exists: true, trigger_id: 'trig_1', token_hint: 'wxyz' });
  fireEvent.change(await screen.findByLabelText('Token de la rutina'), { target: { value: 'secreto-wxyz' } });
  api.fetchFireToken.mockResolvedValue({ exists: true, trigger_id: 'trig_1', token_hint: 'wxyz' });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar token' }));
  await waitFor(() => expect(api.saveFireToken).toHaveBeenCalledWith('resumen-diario', 'trig_1', 'secreto-wxyz'));
  expect(await screen.findByText(/Token cargado …wxyz/)).toBeInTheDocument();
  expect(screen.queryByDisplayValue('secreto-wxyz')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Abrir la rutina en claude.ai' })).toHaveAttribute('href', cloud.routine_url);
  api.deleteFireToken.mockResolvedValue();
  api.fetchFireToken.mockResolvedValue({ exists: false });
  fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
  await waitFor(() => expect(api.deleteFireToken).toHaveBeenCalledWith('resumen-diario'));
  expect(await screen.findByLabelText('Token de la rutina')).toBeInTheDocument();
});

test('la ayuda genera la clave de agentes, la muestra una sola vez y explica el entorno', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [], shared: [] });
  api.fetchAgentKey.mockResolvedValue({ exists: false });
  api.generateAgentKey.mockResolvedValue({ key: 'gca_secreta1234', hint: '1234' });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ayuda' }));
  for (const name of ['GALECORE_BASE_URL', 'GALECORE_ALLOWED_BASE_URL', 'GALECORE_API_KEY', 'GALECORE_AGENT_KEY']) expect(await screen.findByText(name)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Generar clave' }));
  expect(await screen.findByText('gca_secreta1234')).toBeInTheDocument();
  expect(screen.getByText(/Se ve una sola vez/)).toBeInTheDocument();
  api.revokeAgentKey.mockResolvedValue();
  fireEvent.click(screen.getByRole('button', { name: 'Revocar' }));
  await waitFor(() => expect(api.revokeAgentKey).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('gca_secreta1234')).not.toBeInTheDocument());
});

test('las tareas de la PC siguen en la lista junto a los agentes en la nube', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [item, cloudItem], shared: [] });
  render(<Agentes />);
  expect(await screen.findByRole('button', { name: /Mi vigilancia de SPY/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resumen diario' })).toBeInTheDocument();
});
