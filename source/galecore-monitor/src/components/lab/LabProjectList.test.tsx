import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LabProjectList } from './LabProjectList';
const spaceItems: any[] = [];
const saved: any[] = [];
jest.mock('../../api/space', () => ({ fetchSpace: jest.fn(() => Promise.resolve({ items: spaceItems, shared: [] })), saveSpaceItem: (...args: any[]) => { saved.push(args); return Promise.resolve(); } }));
import { fetchSpace } from '../../api/space';
import type { WorkspaceState } from '../../api/lab';

const storage = 'galecore:lab:groups:v1';
const state: WorkspaceState = {
  projects: [{ id: 'spy', label: 'SPY', type: 'strategy', relative: '', strategyName: 'spy' }, { id: 'personal', label: 'Personal', type: 'personal', relative: '', strategyName: null }],
  chats: [{ id: 'research', project: 'spy', title: 'Investigación', provider: 'codex', state: 'idle', activity: '', error: null }], providers: [],
};
const props = { state, projectId: 'spy', chatId: null, expanded: { spy: true }, onToggle: jest.fn(), onProject: jest.fn(), onChat: jest.fn(), onNewChat: jest.fn(), onCreateProject: jest.fn(), name: (_: string, label: string) => label, onRename: jest.fn(), editing: null, renameInput: () => null };
function createGroup(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Crear grupo' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del grupo' }), { target: { value: label } });
  fireEvent.click(screen.getByRole('button', { name: 'Azul' }));
  fireEvent.click(within(screen.getByRole('form', { name: 'Nuevo grupo' })).getByRole('button', { name: 'Crear grupo' }));
}
function move(label: string, group: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Opciones de ' + label }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Grupo de ' + label }), { target: { value: group } });
}
beforeEach(() => { localStorage.clear(); jest.clearAllMocks(); saved.length = 0; (fetchSpace as jest.Mock).mockImplementation(() => Promise.resolve({ items: spaceItems, shared: [] })); });
test('crea varios grupos, mueve proyecto y chat, persiste pliegue y conserva contexto', () => {
  const { unmount } = render(<LabProjectList {...props}/>);
  createGroup('Estrategias'); createGroup('Lecturas');
  const [strategies, readings] = JSON.parse(localStorage.getItem(storage)!).groups;
  move('SPY', strategies.id);
  const group = screen.getByRole('region', { name: 'Estrategias' });
  expect(within(group).getByRole('button', { name: 'SPY' })).toBeInTheDocument();
  expect(group.style.getPropertyValue('--group-color')).toBe('#8ebcff');
  move('Investigación', readings.id);
  const chatGroup = screen.getByRole('region', { name: 'Lecturas' });
  fireEvent.click(within(chatGroup).getByRole('button', { name: 'Investigación SPY' }));
  expect(props.onChat).toHaveBeenCalledWith(state.projects[0], state.chats[0]);
  expect(within(group).queryByRole('button', { name: /Investigación/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Contraer grupo Estrategias' }));
  expect(screen.queryByRole('button', { name: 'SPY' })).not.toBeInTheDocument();
  unmount(); render(<LabProjectList {...props}/>);
  expect(screen.getByRole('button', { name: 'Expandir grupo Estrategias' })).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Expandir grupo Estrategias' }));
  expect(within(screen.getByRole('region', { name: 'Estrategias' })).getByRole('button', { name: 'SPY' })).toBeInTheDocument();
  move('Investigación', '');
  expect(within(screen.getByRole('region', { name: 'Estrategias' })).getByRole('button', { name: 'Investigación' })).toBeInTheDocument();
});
test('editar color/nombre y eliminar grupo conserva todos sus proyectos y chats', () => {
  render(<LabProjectList {...props}/>); createGroup('Temporal');
  const id = JSON.parse(localStorage.getItem(storage)!).groups[0].id;
  move('SPY', id); move('Investigación', id);
  fireEvent.click(screen.getByRole('button', { name: 'Opciones de grupo Temporal' }));
  fireEvent.click(screen.getByRole('button', { name: 'Editar nombre y color' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del grupo' }), { target: { value: 'Opciones' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verde' }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar grupo' }));
  expect(screen.getByRole('region', { name: 'Opciones' }).style.getPropertyValue('--group-color')).toBe('var(--green)');
  fireEvent.click(screen.getByRole('button', { name: 'Opciones de grupo Opciones' }));
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar grupo (conservar contenido)' }));
  expect(screen.queryByRole('region', { name: 'Opciones' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'SPY' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Investigación' }));
  expect(props.onChat).toHaveBeenCalledWith(state.projects[0], state.chats[0]);
  expect(JSON.parse(localStorage.getItem(storage)!).members).toEqual({});
});
test('sacar proyecto y elegir color propio no altera su selección ni sus chats', () => {
  render(<LabProjectList {...props}/>); createGroup('Grupo');
  move('SPY', JSON.parse(localStorage.getItem(storage)!).groups[0].id);
  fireEvent.click(screen.getByRole('button', { name: 'Opciones de SPY' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rosa' }));
  expect(screen.getByRole('button', { name: 'SPY' }).parentElement?.parentElement?.style.getPropertyValue('--group-color')).toBe('#eda1bb');
  fireEvent.click(screen.getByRole('button', { name: 'Sacar del grupo' }));
  expect(within(screen.getByRole('region', { name: 'Grupo' })).queryByRole('button', { name: 'SPY' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'SPY' })); expect(props.onProject).toHaveBeenCalledWith(state.projects[0]);
  expect(screen.getByRole('button', { name: 'Investigación' })).toBeInTheDocument();
});
test.each(['{broken', '{"groups":[null,{"id":"x","label":"Bad","color":"unknown"}],"members":{"p:spy":"missing"}}'])('storage inválido no oculta proyectos: %s', stored => {
  localStorage.setItem(storage, stored); render(<LabProjectList {...props}/>);
  expect(screen.getByRole('button', { name: 'SPY' })).toBeInTheDocument();
});
test('Escape cancela creación y devuelve el foco; sin storage local sigue funcionando', () => {
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  render(<LabProjectList {...props}/>);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Crear grupo' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('form', { name: 'Nuevo grupo' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Crear grupo' })).toHaveFocus();
  spy.mockRestore();
});
function transfer() {
  const values: Record<string, string> = {};
  return { types: [] as string[], effectAllowed: '', dropEffect: '', setData(type: string, value: string) { values[type] = value; this.types.push(type); }, getData: (type: string) => values[type] || '' };
}
test('arrastra chat a grupo plegado, resalta destino, abre grupo y conserva contexto al sacarlo', () => {
  render(<LabProjectList {...props}/>); createGroup('Lecturas');
  fireEvent.click(screen.getByRole('button', { name: 'Contraer grupo Lecturas' }));
  const dataTransfer = transfer(), destination = screen.getByRole('region', { name: 'Lecturas' });
  expect(screen.getByRole('button', { name: 'Investigación' })).toHaveAttribute('draggable', 'true');
  fireEvent.dragStart(screen.getByRole('button', { name: 'Investigación' }), { dataTransfer });
  fireEvent.dragOver(destination, { dataTransfer });
  expect(destination).toHaveClass('lab-drop-target');
  fireEvent.drop(destination, { dataTransfer });
  expect(screen.getByRole('button', { name: 'Contraer grupo Lecturas' })).toHaveAttribute('aria-expanded', 'true');
  const chat = within(destination).getByRole('button', { name: 'Investigación SPY' });
  fireEvent.click(chat); expect(props.onChat).toHaveBeenCalledWith(state.projects[0], state.chats[0]);
  const back = transfer(); fireEvent.dragStart(chat, { dataTransfer: back });
  const ungrouped = screen.getByRole('region', { name: 'Sin grupo' });
  fireEvent.dragOver(ungrouped, { dataTransfer: back }); fireEvent.drop(ungrouped, { dataTransfer: back });
  expect(within(ungrouped).getByRole('button', { name: 'Investigación' })).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(storage)!).members).toEqual({});
});
test('arrastra proyecto entre grupos y persiste la organización', () => {
  const { unmount } = render(<LabProjectList {...props}/>); createGroup('Uno'); createGroup('Dos');
  for (const label of ['Uno', 'Dos']) {
    const dataTransfer = transfer(); fireEvent.dragStart(screen.getByRole('button', { name: 'SPY' }), { dataTransfer });
    const group = screen.getByRole('region', { name: label }); fireEvent.dragOver(group, { dataTransfer }); fireEvent.drop(group, { dataTransfer });
    expect(within(group).getByRole('button', { name: 'SPY' })).toBeInTheDocument();
  }
  unmount(); render(<LabProjectList {...props}/>);
  expect(within(screen.getByRole('region', { name: 'Dos' })).getByRole('button', { name: 'SPY' })).toBeInTheDocument();
});
test('cancelar arrastre y soltar archivos externos no cambia organización', () => {
  render(<LabProjectList {...props}/>); createGroup('Grupo');
  const before = localStorage.getItem(storage), dataTransfer = transfer(), group = screen.getByRole('region', { name: 'Grupo' });
  fireEvent.dragStart(screen.getByRole('button', { name: 'Investigación' }), { dataTransfer }); fireEvent.dragOver(group, { dataTransfer });
  fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.drop(group, { dataTransfer });
  expect(group).not.toHaveClass('lab-drop-target'); expect(localStorage.getItem(storage)).toBe(before);
  fireEvent.dragStart(screen.getByRole('button', { name: 'SPY' }), { dataTransfer }); fireEvent.dragOver(group, { dataTransfer });
  fireEvent.dragEnd(screen.getByRole('button', { name: 'SPY' }), { dataTransfer });
  const external = { types: ['Files'], getData: () => 'c:research' };
  fireEvent.dragOver(group, { dataTransfer: external }); fireEvent.drop(group, { dataTransfer: external });
  expect(group).not.toHaveClass('lab-drop-target'); expect(localStorage.getItem(storage)).toBe(before);
});
test('menú compacto fuera del scroll: renombrar, eliminar, grupo y color; chat conserva su color al recargar', () => {
  const { unmount } = render(<LabProjectList {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Opciones de Investigación' }));
  const panel = screen.getByRole('group', { name: 'Organizar Investigación' });
  expect(panel.parentElement).toBe(document.body);
  expect(within(panel).queryByRole('button', { name: /Crear grupo/ })).not.toBeInTheDocument();
  expect(within(panel).getByRole('button', { name: 'Renombrar' })).toHaveFocus();
  expect(within(panel).getByRole('combobox', { name: 'Grupo de Investigación' })).toBeInTheDocument();
  fireEvent.pointerDown(within(panel).getByRole('button', { name: 'Violeta' }));
  fireEvent.click(within(panel).getByRole('button', { name: 'Violeta' }));
  expect(screen.getByRole('group', { name: 'Organizar Investigación' })).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(storage)!).colors['c:research']).toBe('violet');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Opciones de Investigación' })).toHaveFocus();
  unmount(); render(<LabProjectList {...props}/>);
  expect(screen.getByRole('button', { name: 'Investigación' }).closest('.lab-organized-chat')).toHaveStyle('--group-color: #b9a4ed');
  fireEvent.click(screen.getByRole('button', { name: 'Opciones de SPY' }));
  fireEvent.scroll(screen.getByRole('navigation', { name: 'Proyectos y conversaciones' }));
  expect(screen.queryByRole('group', { name: 'Organizar SPY' })).not.toBeInTheDocument();
});

test('la organización guardada en la cuenta manda sobre la de este navegador y los cambios se guardan en la cuenta', async () => {
  jest.useFakeTimers();
  spaceItems.push({ kind: 'preference', key: 'chat-grupos', isOwn: true, content: JSON.stringify({ groups: [{ id: 'g1', label: 'Desde la cuenta', color: 'blue', collapsed: false }], members: { 'p:spy': 'g1' }, colors: {} }) });
  render(<LabProjectList {...props}/>);
  expect(await screen.findByRole('region', { name: 'Desde la cuenta' })).toBeInTheDocument();
  expect(saved).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Contraer grupo Desde la cuenta' }));
  act(() => { jest.advanceTimersByTime(700); });
  expect(saved[0][0]).toBe('preference');
  expect(saved[0][1]).toBe('chat-grupos');
  expect(JSON.parse(saved[0][2].content).groups[0].collapsed).toBe(true);
  spaceItems.length = 0; saved.length = 0; jest.useRealTimers();
});

test('buscador por pestaña: Proyectos busca proyectos y Conversaciones busca conversaciones, sin tildes (owner 19/10)', () => {
  render(<LabProjectList {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Buscar proyectos' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar proyectos' }), { target: { value: 'person' } });
  const results = screen.getByRole('navigation', { name: 'Resultados de la búsqueda' });
  expect(within(results).getByRole('button', { name: 'Personal' })).toBeInTheDocument();
  expect(within(results).queryByRole('button', { name: /^Investigación/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar proyectos' }), { target: { value: 'investigacion' } });
  expect(screen.getByText('Ningún proyecto con «investigacion».')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Conversaciones' }));
  fireEvent.click(screen.getByRole('button', { name: 'Buscar conversaciones' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar conversaciones' }), { target: { value: 'INVESTIGACION' } });
  expect(within(screen.getByRole('navigation', { name: 'Conversaciones' })).getByRole('button', { name: /^Investigación/ })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Buscar conversaciones' }), { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Buscar conversaciones' })).not.toBeInTheDocument();
});

test('favoritos se guardan en el espacio, sobreviven recarga y conservan grupos y proveedor', async () => {
  const { unmount } = render(<LabProjectList {...props}/>);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Favorito: Investigación' }));
  fireEvent.click(screen.getByRole('button', { name: 'Favorito: SPY' }));
  expect(screen.getByRole('button', { name: 'Favorito: Investigación' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Codex')).toBeInTheDocument();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
  expect(saved[saved.length - 1][0]).toBe('preference');
  expect(JSON.parse(saved[saved.length - 1][2].content).favorites).toEqual(['c:research', 'p:spy']);
  unmount(); render(<LabProjectList {...props}/>);
  expect(screen.getByRole('button', { name: 'Favorito: Investigación' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Favorito: Investigación' }));
  expect(screen.getByRole('button', { name: 'Favorito: Investigación' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('tab', { name: 'Conversaciones' }));
  expect(screen.getByText('Codex · SPY')).toBeInTheDocument();
});

test('favorite clicked before account loads merges with canonical groups before saving', async () => {
  let resolveSpace: (value: any) => void = () => {};
  (fetchSpace as jest.Mock).mockReturnValue(new Promise(resolve => { resolveSpace = resolve; }));
  render(<LabProjectList {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Favorito: SPY' }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
  expect(saved).toHaveLength(0);
  const canonical = { groups: [{ id: 'canonical', label: 'Cuenta', color: 'blue', collapsed: false }], members: { 'p:spy': 'canonical' }, colors: { 'p:spy': 'green' }, favorites: ['p:personal', 'p:spy'] };
  await act(async () => { resolveSpace({ items: [{ kind: 'preference', key: 'chat-grupos', isOwn: true, content: JSON.stringify(canonical) }], shared: [] }); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
  const stored = JSON.parse(saved[saved.length - 1][2].content);
  expect(stored.groups).toEqual(canonical.groups);
  expect(stored.members).toEqual(canonical.members);
  expect(stored.colors).toEqual(canonical.colors);
  expect(stored.favorites).toEqual(['p:personal', 'p:spy']);
});

test('failed account read keeps favorites local and never overwrites remote preference', async () => {
  (fetchSpace as jest.Mock).mockRejectedValue(new Error('offline'));
  render(<LabProjectList {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Favorito: SPY' }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
  expect(saved).toHaveLength(0);
  expect(JSON.parse(localStorage.getItem(storage)!).favorites).toContain('p:spy');
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent(/sincronizar/);
});
