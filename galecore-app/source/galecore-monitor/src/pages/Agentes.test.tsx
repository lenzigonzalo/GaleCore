import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Agentes } from './Agentes';
import { deleteSpaceItem, fetchSpace, saveSpaceItem, SpaceItem } from '../api/space';
import * as agentsApi from '../api/agents';

jest.mock('../api/space', () => ({ fetchSpace: jest.fn(), saveSpaceItem: jest.fn(), deleteSpaceItem: jest.fn() }));
jest.mock('../api/agents', () => ({
  ...jest.requireActual('../api/agents'),
  fetchRuns: jest.fn(),
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

test('Ejecutar siempre escribe request.run para el Lab', async () => {
  await openCloud();
  await screen.findByText('Completada');
  fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledTimes(1));
  expect(JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content)).toMatchObject({ ...cloud, request: { run: true } });
  expect(await screen.findByText('Se ejecuta en cuanto el Lab esté abierto.')).toBeInTheDocument();
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

test('el detalle muestra el link a la rutina y ya no ofrece token de disparo', async () => {
  await openCloud();
  expect(screen.getByRole('link', { name: 'Abrir la rutina en claude.ai' })).toHaveAttribute('href', cloud.routine_url);
  expect(screen.queryByText(/Ejecutar sin PC/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Token de la rutina')).not.toBeInTheDocument();
});

test('la ayuda explica qué es un agente, cómo crearlo y un solo paso de primera vez, sin claves ni variables', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [], shared: [] });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ayuda' }));
  expect(screen.getByRole('heading', { name: 'Qué es un agente' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Cómo crear uno' })).toBeInTheDocument();
  expect(screen.getByText(/creame un agente que de lunes a viernes a las 9 me resuma el mercado/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Primera vez' })).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  const link = screen.getByRole('link', { name: /Abrir claude.ai/ });
  expect(link).toHaveAttribute('href', 'https://claude.ai/code');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  expect(screen.queryByText(/GALECORE_/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /clave/i })).not.toBeInTheDocument();
});

test('en la ayuda, Copiar copia el dominio de la API', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [], shared: [] });
  process.env.REACT_APP_API_BASE_URL = 'https://api.galecore.test';
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ayuda' }));
  expect(screen.getByText('api.galecore.test')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Copiar/ }));
  expect(await screen.findByRole('button', { name: 'Copiada' })).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith('api.galecore.test');
});

test('si el portapapeles falla, Copiar pide copiar a mano', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [], shared: [] });
  process.env.REACT_APP_API_BASE_URL = 'https://api.galecore.test';
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('no')) } });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ayuda' }));
  fireEvent.click(screen.getByRole('button', { name: /Copiar/ }));
  expect(await screen.findByText('Seleccionala y copiala a mano')).toBeInTheDocument();
});

test('las tareas de la PC siguen en la lista junto a los agentes en la nube', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [item, cloudItem], shared: [] });
  render(<Agentes />);
  expect(await screen.findByRole('button', { name: /Mi vigilancia de SPY/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resumen diario' })).toBeInTheDocument();
});

test('borrar un agente con rutina pide confirmación y escribe request.delete', async () => {
  await openCloud();
  fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Se pausa la rutina en claude.ai y el agente sale de la lista.');
  expect(saveSpaceItem).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Borrar' }));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledTimes(1));
  expect(JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content).request).toMatchObject({ delete: true });
  expect(deleteSpaceItem).not.toHaveBeenCalled();
});

test('borrar un agente sin rutina borra la pieza directo y con delete pedido muestra Borrando', async () => {
  await openCloud({ ...cloud, status: 'pending', trigger_id: null, routine_url: null });
  fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Borrar' }));
  await waitFor(() => expect(deleteSpaceItem).toHaveBeenCalledWith('agent', 'resumen-diario'));
  expect(saveSpaceItem).not.toHaveBeenCalled();
});

test('con el borrado pedido se avisa y no se ofrece Borrar', async () => {
  await openCloud({ ...cloud, request: { delete: true, at: '2026-11-09T13:00:00Z' } });
  expect(screen.getByRole('status')).toHaveTextContent('Borrando… (se aplica con el Lab abierto)');
  expect(screen.queryByRole('button', { name: 'Borrar' })).toBeNull();
});

// ── WS-0099: agente que corre una skill y «cada 1 h en rueda» ──────────────────

const skillFiles = { 'SKILL.md': '---\nname: Cierre\ndescription: x\n---\n', 'scripts/cierre.py': 'print(1)', 'scripts/otro.py': 'print(2)' };
const skillItem = (key: string, title: string, own: boolean, format: 'json' | 'markdown' = 'json', content = JSON.stringify({ format: 'skill-folder/1', files: skillFiles })): SpaceItem =>
  ({ ...item, key, title, kind: 'skill', format, content, isOwn: own });

test('Nuevo agente ofrece las skills del espacio como casillas (con código o no) y manda las elegidas en el alta', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({
    items: [skillItem('cierre', 'Cierre de SPY', true), skillItem('texto', 'Sólo texto', true, 'markdown', '# hola')],
    shared: [skillItem('ajena', 'Compartida', false)],
  });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: 'Nuevo agente' }));
  const group = screen.getByRole('group', { name: 'Skills' });
  expect(within(group).getAllByRole('checkbox').map(c => c.parentElement?.textContent)).toEqual(['Cierre de SPY', 'Sólo texto', 'Compartida']);
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Cierre SPY' } });
  fireEvent.change(screen.getByLabelText('Qué hace'), { target: { value: 'Decí cómo cerró' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Frecuencia' }), { target: { value: 'market_hours' } });
  expect(screen.queryByLabelText('Hora')).not.toBeInTheDocument();
  fireEvent.click(within(group).getByRole('checkbox', { name: 'Cierre de SPY' }));
  fireEvent.click(within(group).getByRole('checkbox', { name: 'Compartida' }));
  fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledTimes(1));
  const piece = JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content);
  expect(piece.schedule_spec).toEqual({ frequency: 'market_hours', minutes: 60, timezone: 'America/New_York' });
  expect(piece.skills).toEqual(['cierre', 'ajena']);
  expect(piece.request.create).toMatchObject({ skills: ['cierre', 'ajena'], schedule_spec: piece.schedule_spec });
  expect(piece.schedule).toBe('Cada 1 h en rueda, L–V 9:30–16:00 NY');
});

test('no se pueden elegir más de 5 skills', async () => {
  const many = Array.from({ length: 6 }, (_, n) => skillItem(`s${n}`, `Skill ${n}`, true));
  (fetchSpace as jest.Mock).mockResolvedValue({ items: many, shared: [] });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: 'Nuevo agente' }));
  const group = screen.getByRole('group', { name: 'Skills' });
  for (let n = 0; n < 5; n++) fireEvent.click(within(group).getByRole('checkbox', { name: `Skill ${n}` }));
  expect(within(group).getByRole('checkbox', { name: 'Skill 5' })).toBeDisabled();
});

test('la tarjeta lista las skills y editar las cambia o las quita con request.settings', async () => {
  const content = { ...cloud, skills: ['cierre', 'texto'], schedule_spec: { frequency: 'market_hours', minutes: 60, timezone: 'America/New_York' }, schedule: 'cada 60 minutos en horario de mercado (L–V 09:30–16:00 Nueva York)' };
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ ...cloudItem, content: JSON.stringify(content) }, skillItem('cierre', 'Cierre de SPY', true), skillItem('texto', 'Sólo texto', true, 'markdown', '# hola')], shared: [] });
  api.fetchRuns.mockResolvedValue([]);
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resumen diario' }));
  expect(screen.getByText('Skills: Cierre de SPY, Sólo texto')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  expect(screen.getByRole('combobox', { name: 'Frecuencia' })).toHaveValue('market_hours');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sólo texto' }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledTimes(1));
  const saved = JSON.parse((saveSpaceItem as jest.Mock).mock.calls[0][2].content);
  expect(saved.request.settings).toEqual({ skills: ['cierre'] });
});

const salida = { evaluado_en: '2026-11-10T15:00:00Z', calidad: 'completa', valores: { spy: 600.5, cruce_oculto: { x: 1 } },
  condiciones: [{ nombre: 'Ruptura', estado: 'cumplida' }, { nombre: 'Piso', estado: 'pendiente' }, { nombre: 'Soporte', estado: 'fallida' }], cambios: ['Subió la ruptura'], secreto: 'no se muestra' };
const goodRun = { id: 'r1', agent_key: 'resumen-diario', origin: 'schedule', status: 'ok', summary: 'listo', created_at: '2026-11-10T15:05:00Z', finished_at: '2026-11-10T15:05:00Z',
  result: { corridas: [{ skill: 'cierre', script: 'cierre.py', version: 2, ok: true, error: null, salida }, { skill: 'texto', script: 'otro.py', version: 1, ok: true, error: null, salida: { valores: { vix: 15 } } }] } } as any;

async function openWithSkills(runs: any[]) {
  const content = { ...cloud, skills: ['cierre', 'texto'] };
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ ...cloudItem, content: JSON.stringify(content) }, skillItem('cierre', 'Cierre de SPY', true), skillItem('texto', 'Otra', true)], shared: [] });
  api.fetchRuns.mockResolvedValue(runs);
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resumen diario' }));
}

test('Último resultado muestra un bloque por corrida, con tablas y condiciones, sin claves desconocidas', async () => {
  await openWithSkills([goodRun]);
  const section = (await screen.findByRole('heading', { name: 'Último resultado' })).closest('section') as HTMLElement;
  expect(within(section).getByRole('heading', { name: 'Cierre de SPY · cierre.py' })).toBeInTheDocument();
  expect(within(section).getByRole('heading', { name: 'Otra · otro.py' })).toBeInTheDocument();
  expect(within(section).getByText('Datos: completa')).toBeInTheDocument();
  expect(within(section).getByRole('rowheader', { name: 'spy' })).toBeInTheDocument();
  expect(within(section).getByText('Cumplida')).toBeInTheDocument();
  expect(within(section).getByText('Pendiente')).toBeInTheDocument();
  expect(within(section).getByText('Fallida')).toBeInTheDocument();
  expect(within(section).getByText('Subió la ruptura')).toBeInTheDocument();
  expect(section.textContent).not.toContain('secreto');
  expect(section.textContent).not.toContain('cruce');
});

test('con la última corrida fallida dice Sin evaluar y deja la última buena debajo', async () => {
  const bad = { id: 'r2', agent_key: 'resumen-diario', origin: 'schedule', status: 'error', summary: 'Sin evaluar: cierre/cierre.py: boom', created_at: '2026-11-10T16:05:00Z',
    result: { corridas: [{ skill: 'cierre', script: 'cierre.py', version: 2, ok: false, error: 'boom', salida: null }] } } as any;
  await openWithSkills([bad, goodRun]);
  const section = (await screen.findByRole('heading', { name: 'Último resultado' })).closest('section') as HTMLElement;
  expect(within(section).getByText('Sin evaluar').parentElement).toHaveTextContent('Sin evaluar · boom');
  expect(within(section).getByRole('heading', { name: /Última corrida buena/ })).toBeInTheDocument();
  expect(within(section).getByRole('heading', { name: 'Cierre de SPY · cierre.py' })).toBeInTheDocument();
});

test('las tareas de la PC no ofrecen «Cada 1 h en rueda»; los agentes en la nube sí', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ ...item, content: JSON.stringify({ ...task, schedule_spec: { frequency: 'daily', time: '10:00', timezone: 'America/New_York' } }) }], shared: [] });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: /Mi vigilancia de SPY/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  expect(within(screen.getByRole('combobox', { name: 'Frecuencia' })).queryByRole('option', { name: 'Cada 1 h en rueda' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Agentes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Nuevo agente' }));
  expect(within(screen.getByRole('combobox', { name: 'Frecuencia' })).getByRole('option', { name: 'Cada 1 h en rueda' })).toBeInTheDocument();
});
