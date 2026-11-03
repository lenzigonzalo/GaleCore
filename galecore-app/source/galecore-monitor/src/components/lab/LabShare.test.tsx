import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LabShare, noticeText } from './LabShare';
import { labRequest } from '../../api/lab';

jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
const request = labRequest as jest.Mock;
const project = { id: 'idea', label: 'Idea SPY', relative: 'workspaces/idea', strategies: [] };
const members = [{ username: 'demo', role: 'owner' }, { username: 'gonza', role: 'member' }];

beforeEach(() => request.mockReset());

test('muestra las personas con acceso, suma a una por usuario con «Listo» y puede quitarla', async () => {
  request.mockImplementation((url: string) => {
    if (url.endsWith('/sharing')) return Promise.resolve({ shared: true, mine: true, access: 'restricted', members: [members[0]] });
    if (url.endsWith('/share')) return Promise.resolve({ shared: true, mine: true, access: 'restricted', members });
    return Promise.resolve({ shared: true, mine: true, access: 'restricted', members: [members[0]] });
  });
  const changed = jest.fn();
  render(<LabShare project={project} onClose={jest.fn()} onChanged={changed}/>);
  expect(await screen.findByText('Demo')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Quitar a/ })).toBeNull();   // el dueño no se quita
  fireEvent.change(screen.getByLabelText('Agregar personas por usuario o mail'), { target: { value: 'gonza' } });
  fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));
  expect(await screen.findByText('Gonza')).toBeInTheDocument();
  expect(screen.getByText('Listo: Gonza ya tiene acceso')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/workspaces/idea/share', { username: 'gonza' }, expect.any(Number));
  expect(changed).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Quitar a Gonza' }));
  await waitFor(() => expect(screen.queryByText('Gonza')).toBeNull());
  expect(screen.getByText('Listo: Gonza ya no tiene acceso')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/workspaces/idea/unshare', { username: 'gonza' }, expect.any(Number));
});

test('el acceso general se cambia al instante y se confirma', async () => {
  request.mockImplementation((url: string, body?: { access?: string }) => url.endsWith('/access')
    ? Promise.resolve({ shared: true, mine: true, access: body?.access, members })
    : Promise.resolve({ shared: true, mine: true, access: 'restricted', members }));
  render(<LabShare project={project} onClose={jest.fn()} onChanged={jest.fn()}/>);
  const select = await screen.findByLabelText('Acceso general');
  expect(select).toHaveValue('restricted');
  expect(screen.getByText('Sólo las personas agregadas pueden abrirlo.')).toBeInTheDocument();
  fireEvent.change(select, { target: { value: 'everyone' } });
  expect(await screen.findByText('Listo: cualquier usuario de GaleCore lo puede agregar a su Lab')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/workspaces/idea/access', { access: 'everyone' }, expect.any(Number));
  expect(screen.getByLabelText('Acceso general')).toHaveValue('everyone');
  expect(screen.getByText('Cualquiera lo puede agregar a su Lab.')).toBeInTheDocument();
});

test('el error del Lab se muestra sin cerrar el modal', async () => {
  request.mockImplementation((url: string) => url.endsWith('/sharing') ? Promise.resolve({ shared: false, members: [] }) : Promise.reject(new Error("no existe el usuario 'nadie'")));
  render(<LabShare project={project} onClose={jest.fn()} onChanged={jest.fn()}/>);
  fireEvent.change(await screen.findByLabelText('Agregar personas por usuario o mail'), { target: { value: 'nadie' } });
  fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("no existe el usuario 'nadie'");
});

test('quien no es dueño ve las personas y el acceso sin poder editar', async () => {
  request.mockResolvedValue({ shared: true, mine: false, access: 'everyone', members });
  render(<LabShare project={project} onClose={jest.fn()} onChanged={jest.fn()}/>);
  expect(await screen.findByText('Gonza')).toBeInTheDocument();
  expect(screen.queryByLabelText('Agregar personas por usuario o mail')).toBeNull();
  expect(screen.queryByRole('button', { name: /Quitar a/ })).toBeNull();
  expect(screen.queryByLabelText('Acceso general')).toBeNull();
  expect(screen.getByText('Todos los usuarios de GaleCore')).toBeInTheDocument();
});

test('el aviso de conflicto dice quién y qué quedó', () => {
  const at = '2026-10-28T00:00:00Z';
  expect(noticeText({ at, conflicts: [{ path: 'README.md', with: 'gonza', copy: 'x', kind: 'editado-en-ambos' }] })).toBe('Gonza y vos editaron README.md: quedaron las dos versiones');
  expect(noticeText({ at, conflicts: [{ path: 'a.md', with: 'gonza', copy: null, kind: 'borrado-allá' }, { path: 'b.md', with: 'gonza', copy: null, kind: 'borrado-allá' }] })).toContain('(y 1 más)');
});

test('el aviso de un sync fallido es una línea con el motivo', () => {
  expect(noticeText({ at: 'x', conflicts: [], error: 'sin conexión con GaleCore' })).toBe('No se pudo sincronizar: sin conexión con GaleCore');
});

test('no hay botón «Sincronizar ahora»', async () => {
  request.mockResolvedValue({ shared: true, mine: true, members });
  render(<LabShare project={project} onClose={jest.fn()} onChanged={jest.fn()}/>);
  await screen.findByText('Gonza');
  expect(screen.queryByRole('button', { name: 'Sincronizar ahora' })).toBeNull();
});

describe('sugerencias de usuarios', () => {
  const users = [{ username: 'elenzi', displayName: 'Eric Lenzi' }, { username: 'elena', displayName: null }, { username: 'demo', displayName: 'Demo' }];
  const label = 'Agregar personas por usuario o mail';
  const setup = (search: () => Promise<unknown>) => {
    request.mockImplementation((url: string) => url.endsWith('/sharing') ? Promise.resolve({ shared: false, members: [] })
      : url.startsWith('/workspaces/users') ? search() : Promise.resolve({ shared: true, mine: true, members }));
    render(<LabShare project={project} onClose={jest.fn()} onChanged={jest.fn()}/>);
    return screen.findByLabelText(label);
  };
  const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });

  test('al escribir ofrece usuarios (con espera) y elegir con clic los agrega al instante', async () => {
    const input = await setup(() => Promise.resolve({ users }));
    type(input, 'elen');
    expect(request).not.toHaveBeenCalledWith(expect.stringContaining('/workspaces/users'), undefined, expect.anything());   // antes de la pausa
    expect(await screen.findByRole('option', { name: /elenzi/ })).toHaveTextContent('Eric Lenzi');
    expect(request).toHaveBeenCalledWith('/workspaces/users?q=elen', undefined, expect.any(Number));
    fireEvent.mouseDown(screen.getByRole('option', { name: /elenzi/ }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/workspaces/idea/share', { username: 'elenzi' }, expect.any(Number)));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  test('con el teclado: flechas y Enter eligen', async () => {
    const input = await setup(() => Promise.resolve({ users }));
    type(input, 'ele');
    await screen.findByRole('listbox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /elena/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(request).toHaveBeenCalledWith('/workspaces/idea/share', { username: 'elenzi' }, expect.any(Number)));
  });

  test('no ofrece a quien ya tiene acceso', async () => {
    request.mockImplementation((url: string) => url.endsWith('/sharing') ? Promise.resolve({ shared: true, mine: true, members: [{ username: 'demo', role: 'owner' }] })
      : Promise.resolve({ users }));
    render(<LabShare project={project} onClose={jest.fn()} onChanged={jest.fn()}/>);
    await screen.findByText('Demo');
    type(screen.getByLabelText(label), 'e');
    type(screen.getByLabelText(label), 'el');
    await screen.findByRole('listbox');
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent)).toEqual(['elenziEric Lenzi', 'elena']);
  });

  test('si la búsqueda falla se puede escribir el usuario o mail completo igual', async () => {
    const input = await setup(() => Promise.reject(new Error('sin conexión')));
    type(input, 'gonza@mail.com');
    await waitFor(() => expect(request).toHaveBeenCalledWith('/workspaces/users?q=gonza%40mail.com', undefined, expect.any(Number)));
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/workspaces/idea/share', { username: 'gonza@mail.com' }, expect.any(Number)));
  });
});
