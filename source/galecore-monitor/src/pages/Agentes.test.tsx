import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Agentes } from './Agentes';
import { fetchSpace, saveSpaceItem, SpaceItem } from '../api/space';

jest.mock('../api/space', () => ({ fetchSpace: jest.fn(), saveSpaceItem: jest.fn() }));
jest.mock('../components/settings/Markdown', () => ({ Markdown: ({ text }: { text: string }) => <div>{text}</div> }));

const task = {
  id: 'spy-watch', capability: 'market_watch', status: 'active', schedule: 'Días hábiles a las 10:00',
  objective: 'Observar SPY', state: 'CURRENT', runs: 8, findings: 'Resultado publicado por el agente',
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
  expect(screen.getByRole('heading', { name: 'Historial' })).toBeInTheDocument();
  expect(screen.getByText(task.findings)).toBeInTheDocument();
  expect(screen.getByText(/8 corridas registradas/)).toHaveTextContent('únicamente la última corrida');
  expect(screen.getByText(task.schedule)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tareas programadas' }));
  expect(screen.getByRole('button', { name: 'Plantillas' })).toBeInTheDocument();
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
  expect(await screen.findByText('Apagando…')).toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
});

test('una plantilla prepara un pedido editable sin crear ni activar una tarea', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<Agentes />);
  fireEvent.click(screen.getByRole('button', { name: 'Plantillas' }));
  fireEvent.click(screen.getByRole('button', { name: /Briefing diario/ }));
  const draft = screen.getByRole('textbox', { name: 'Tu pedido' });
  fireEvent.change(draft, { target: { value: 'Preparar mi briefing' } });
  fireEvent.click(screen.getByRole('button', { name: 'Copiar pedido para el chat' }));
  expect(await screen.findByText('Pedido copiado')).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith('Preparar mi briefing');
  expect(saveSpaceItem).not.toHaveBeenCalled();
  fireEvent.keyDown(draft, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('muestra el vacío y permite reintentar una lectura fallida', async () => {
  (fetchSpace as jest.Mock).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ items: [], shared: [] });
  render(<Agentes />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo leer');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Todavía no tenés tareas programadas')).toBeInTheDocument();
});

test('el supervisor conserva su ejecución permanente y no ofrece pausa', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ ...item, content: JSON.stringify({ ...task, capability: 'supervisor', last_run: null }) }], shared: [] });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: /Mi vigilancia de SPY/ }));
  expect(screen.getByText('Siempre activo')).toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.getByText('Esta tarea todavía no corrió.')).toBeInTheDocument();
});

test('un resultado viejo conserva el aviso de falta de publicación', async () => {
  (fetchSpace as jest.Mock).mockResolvedValue({ items: [{ ...item, content: JSON.stringify({ ...task, next_expected_at: '2020-01-01T00:00:00Z' }) }], shared: [] });
  render(<Agentes />);
  fireEvent.click(await screen.findByRole('button', { name: /Mi vigilancia de SPY/ }));
  expect(screen.getByText(/Sin noticias de tu PC desde/)).toBeInTheDocument();
  expect(screen.getByText(task.findings)).toBeInTheDocument();
  expect(screen.queryByText(/Próxima:/)).not.toBeInTheDocument();
});
