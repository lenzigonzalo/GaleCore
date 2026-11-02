import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Agentes } from './Agentes';
import { fetchSpace, saveSpaceItem, SpaceItem } from '../api/space';

jest.mock('../api/space', () => ({ fetchSpace: jest.fn(), saveSpaceItem: jest.fn() }));
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
  expect(screen.getByRole('button', { name: 'Nueva tarea' })).toBeInTheDocument();
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

test('una plantilla completa la nueva tarea sin crearla hasta guardar', async () => {
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: 'Nueva tarea' }));
  fireEvent.change(screen.getByLabelText('Partir de una plantilla'), { target: { value: 'Briefing diario' } });
  expect(screen.getByLabelText('Nombre')).toHaveValue('Briefing diario');
  expect((screen.getByLabelText('Qué debe hacer') as HTMLTextAreaElement).value).toMatch(/briefing antes de la apertura/);
  expect(saveSpaceItem).not.toHaveBeenCalled();
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
  expect(await screen.findByText('Todavía no tenés tareas programadas')).toBeInTheDocument();
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
