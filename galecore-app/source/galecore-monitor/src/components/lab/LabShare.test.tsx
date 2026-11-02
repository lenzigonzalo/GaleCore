import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LabShare, noticeText } from './LabShare';
import { labRequest } from '../../api/lab';

jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
const request = labRequest as jest.Mock;
const project = { id: 'idea', label: 'Idea SPY', relative: 'workspaces/idea', strategies: [] };
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

test('«Sincronizar ahora» muestra traídos, enviados y conflictos; si falla, el motivo', async () => {
  let fail = false;
  request.mockImplementation((url: string) => {
    if (url.endsWith('/sharing')) return Promise.resolve({ shared: true, mine: true, members });
    if (url.endsWith('/sync')) return fail ? Promise.reject(new Error('GaleCore did not answer')) : Promise.resolve({ pulled: 2, pushed: 1, conflicts: [{}], skipped: [] });
    return Promise.resolve({});
  });
  render(<LabShare project={project} onClose={jest.fn()} onChanged={jest.fn()}/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Sincronizar ahora' }));
  expect(await screen.findByText('Traídos 2 · enviados 1 · conflictos 1')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/workspaces/idea/sync', {}, expect.any(Number));
  fail = true;
  fireEvent.click(screen.getByRole('button', { name: 'Sincronizar ahora' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('GaleCore did not answer');
});

test('el aviso de un sync fallido es una línea con el motivo', () => {
  expect(noticeText({ at: 'x', conflicts: [], error: 'sin conexión con GaleCore' })).toBe('No se pudo sincronizar: sin conexión con GaleCore');
});

test('sin proyecto compartido no hay «Sincronizar ahora»', async () => {
  request.mockResolvedValue({ shared: false, members: [] });
  render(<LabShare project={project} onClose={jest.fn()} onChanged={jest.fn()}/>);
  await screen.findByLabelText('Usuario de GaleCore');
  expect(screen.queryByRole('button', { name: 'Sincronizar ahora' })).toBeNull();
});

describe('sugerencias de usuarios', () => {
  const users = [{ username: 'elenzi', displayName: 'Eric Lenzi' }, { username: 'elena', displayName: null }, { username: 'demo', displayName: 'Demo' }];
  const setup = (search: () => Promise<unknown>) => {
    request.mockImplementation((url: string) => url.endsWith('/sharing') ? Promise.resolve({ shared: false, members: [] })
      : url.startsWith('/workspaces/users') ? search() : Promise.resolve({ shared: true, mine: true, members }));
    render(<LabShare project={project} onClose={jest.fn()} onChanged={jest.fn()}/>);
    return screen.findByLabelText('Usuario de GaleCore');
  };
  const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });

  test('al escribir ofrece usuarios (con espera) y elegir con clic completa el usuario', async () => {
    const input = await setup(() => Promise.resolve({ users }));
    type(input, 'elen');
    expect(request).not.toHaveBeenCalledWith(expect.stringContaining('/workspaces/users'), undefined, expect.anything());   // antes de la pausa
    expect(await screen.findByRole('option', { name: /elenzi/ })).toHaveTextContent('Eric Lenzi');
    expect(request).toHaveBeenCalledWith('/workspaces/users?q=elen', undefined, expect.any(Number));
    fireEvent.mouseDown(screen.getByRole('option', { name: /elenzi/ }));
    expect(input).toHaveValue('elenzi');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  test('con el teclado: flechas y Enter eligen; sin opción activa, Enter comparte lo escrito', async () => {
    const input = await setup(() => Promise.resolve({ users }));
    type(input, 'ele');
    await screen.findByRole('listbox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /elena/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('elenzi');
    expect(request).not.toHaveBeenCalledWith('/workspaces/idea/share', expect.anything(), expect.anything());
  });

  test('no ofrece a quien ya es miembro y, si la búsqueda falla, queda el texto libre', async () => {
    request.mockImplementation((url: string) => url.endsWith('/sharing') ? Promise.resolve({ shared: true, mine: true, members: [{ username: 'demo', role: 'owner' }] })
      : Promise.resolve({ users }));
    render(<LabShare project={project} onClose={jest.fn()} onChanged={jest.fn()}/>);
    await screen.findByText('Demo');
    type(screen.getByLabelText('Usuario de GaleCore'), 'e');
    type(screen.getByLabelText('Usuario de GaleCore'), 'el');
    await screen.findByRole('listbox');
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['elenziEric Lenzi', 'elena']);
  });

  test('si la búsqueda falla se puede escribir el usuario completo igual', async () => {
    const input = await setup(() => Promise.reject(new Error('sin conexión')));
    type(input, 'gonza');
    await waitFor(() => expect(request).toHaveBeenCalledWith('/workspaces/users?q=gonza', undefined, expect.any(Number)));
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Compartir' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/workspaces/idea/share', { username: 'gonza' }, expect.any(Number)));
  });
});
