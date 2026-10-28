import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LabShare, noticeText } from './LabShare';
import { labRequest } from '../../api/lab';

jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
const request = labRequest as jest.Mock;
const project = { id: 'idea', label: 'Idea SPY', type: 'analysis' as const, relative: 'workspaces/idea', strategyName: null };
const members = [{ username: 'demo', role: 'owner' }, { username: 'gonza', role: 'member' }];

beforeEach(() => request.mockReset());

test('muestra los miembros, suma a uno por usuario y puede quitarlo', async () => {
  request.mockImplementation((url: string, body?: { username: string }) => {
    if (url.endsWith('/sharing')) return Promise.resolve({ shared: true, mine: true, members: [members[0]] });
    if (url.endsWith('/share')) return Promise.resolve({ shared: true, mine: true, members });
    return Promise.resolve({ shared: true, mine: true, members: [members[0]] });
  });
  const changed = jest.fn();
  render(<LabShare project={project} onClose={jest.fn()} onChanged={changed}/>);
  expect(await screen.findByText('Demo')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Quitar a/ })).toBeNull();   // el dueño no se quita
  fireEvent.change(screen.getByLabelText('Usuario de GaleCore'), { target: { value: 'gonza' } });
  fireEvent.click(screen.getByRole('button', { name: 'Compartir' }));
  expect(await screen.findByText('Gonza')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/workspaces/idea/share', { username: 'gonza' }, expect.any(Number));
  expect(changed).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Quitar a Gonza' }));
  await waitFor(() => expect(screen.queryByText('Gonza')).toBeNull());
  expect(request).toHaveBeenCalledWith('/workspaces/idea/unshare', { username: 'gonza' }, expect.any(Number));
});

test('el error del Lab se muestra sin cerrar el modal', async () => {
  request.mockImplementation((url: string) => url.endsWith('/sharing') ? Promise.resolve({ shared: false, members: [] }) : Promise.reject(new Error("no existe el usuario 'nadie'")));
  render(<LabShare project={project} onClose={jest.fn()} onChanged={jest.fn()}/>);
  fireEvent.change(await screen.findByLabelText('Usuario de GaleCore'), { target: { value: 'nadie' } });
  fireEvent.click(screen.getByRole('button', { name: 'Compartir' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("no existe el usuario 'nadie'");
});

test('un miembro que no es dueño no puede sumar ni quitar', async () => {
  request.mockResolvedValue({ shared: true, mine: false, members });
  render(<LabShare project={project} onClose={jest.fn()} onChanged={jest.fn()}/>);
  expect(await screen.findByText('Gonza')).toBeInTheDocument();
  expect(screen.queryByLabelText('Usuario de GaleCore')).toBeNull();
  expect(screen.queryByRole('button', { name: /Quitar a/ })).toBeNull();
});

test('el aviso de conflicto dice quién y qué quedó', () => {
  const at = '2026-10-28T00:00:00Z';
  expect(noticeText({ at, conflicts: [{ path: 'README.md', with: 'gonza', copy: 'x', kind: 'editado-en-ambos' }] })).toBe('Gonza y vos editaron README.md: quedaron las dos versiones');
  expect(noticeText({ at, conflicts: [{ path: 'a.md', with: 'gonza', copy: null, kind: 'borrado-allá' }, { path: 'b.md', with: 'gonza', copy: null, kind: 'borrado-allá' }] })).toContain('(y 1 más)');
});
