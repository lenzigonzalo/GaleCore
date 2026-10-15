import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LabProjectList } from './LabProjectList';
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
beforeEach(() => { localStorage.clear(); jest.clearAllMocks(); });
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
test('Escape cancela creación y devuelve el foco; storage no disponible lo avisa', () => {
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  render(<LabProjectList {...props}/>);
  expect(screen.getByRole('status')).toHaveTextContent('No se pudo guardar');
  fireEvent.click(screen.getByRole('button', { name: 'Crear grupo' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('form', { name: 'Nuevo grupo' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Crear grupo' })).toHaveFocus();
  spy.mockRestore();
});
