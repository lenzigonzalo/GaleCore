import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { labRequest } from '../../api/lab';
import { LabSharedProjects } from './LabSharedProjects';

jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
const request = labRequest as jest.Mock;
const available = { id: 'id-eric', name: 'Bancos ARG 2027', owner: 'elenzi', mine: false, member: true, access: 'restricted', local: null, subscribed: false };
const catalog = (...projects: object[]) => ({ user: 'demo', api: 'http://localhost:7001', projects: projects.length ? projects : [available] });
const added = (extra: object = {}) => ({ ...available, local: 'bancos', subscribed: true, syncState: 'ok', ...extra });
const changed = jest.fn(async () => {});
const open = jest.fn();
beforeEach(() => { jest.clearAllMocks(); });

test('separa «Mis proyectos» y «Compartidos conmigo» y ofrece «Agregar a mi Lab»', async () => {
  request.mockResolvedValue(catalog(available, { ...available, id: 'mio', name: 'Mi estrategia', owner: 'demo', mine: true }));
  render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open}/>);
  expect(await screen.findByText('Bancos ARG 2027')).toBeInTheDocument();
  expect(screen.getByText('Dueño: elenzi')).toBeInTheDocument();
  const others = screen.getByRole('list', { name: 'Compartidos conmigo' });
  const mine = screen.getByRole('list', { name: 'Mis proyectos' });
  expect(others).toHaveTextContent('Bancos ARG 2027');
  expect(mine).toHaveTextContent('Mi estrategia');
  expect(mine).not.toHaveTextContent('Bancos ARG 2027');
  expect(within(others).getByRole('button', { name: 'Agregar a mi Lab' })).toBeEnabled();
  expect(request.mock.calls.map(c => c[0])).toEqual(['/workspaces/shared']);
});

test('«Agregar a mi Lab» llama a /add y actualiza la lista', async () => {
  let local: string | null = null;
  request.mockImplementation((url: string) => {
    if (url.endsWith('/add')) { local = 'bancos'; return Promise.resolve({ project: 'bancos' }); }
    return Promise.resolve(catalog(local ? added() : available));
  });
  render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open}/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Agregar a mi Lab' }));
  expect(await screen.findByText('Al día')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/shared-projects/id-eric/add', {}, expect.any(Number));
  expect(changed).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
  expect(open).toHaveBeenCalledWith('bancos');
  expect(screen.queryByRole('button', { name: /Pausar|Reanudar/ })).toBeNull();
});

test('un fallo de red conserva el catálogo y permite actualizar', async () => {
  request.mockResolvedValueOnce(catalog()).mockRejectedValueOnce(new Error('Sin conexión')).mockResolvedValue(catalog());
  render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open}/>);
  await screen.findByText('Bancos ARG 2027');
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión');
  expect(screen.getByText('Bancos ARG 2027')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

test('un error de sincronización muestra el motivo y su botón: Reintentar', async () => {
  request.mockResolvedValue(catalog(added({ syncState: 'error', action: 'retry', notice: 'sin conexión con GaleCore' })));
  render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open}/>);
  expect(await screen.findByText('No se pudo sincronizar: sin conexión con GaleCore')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith('/workspaces/bancos/sync', {}, expect.any(Number)));
});

test('según la acción del error: «Compartir acá» o «Quitar de mi Lab»', async () => {
  const share = jest.fn(), remove = jest.fn();
  request.mockResolvedValue(catalog(added({ syncState: 'error', action: 'reshare', notice: 'otro entorno' })));
  const { unmount } = render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open} onShare={share} onRemove={remove}/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Compartir acá' }));
  expect(share).toHaveBeenCalledWith('bancos');
  unmount();
  request.mockResolvedValue(catalog(added({ syncState: 'error', action: 'remove', notice: 'sin acceso' })));
  render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open} onShare={share} onRemove={remove}/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Quitar de mi Lab' }));
  expect(remove).not.toHaveBeenCalled();   // borra la copia: pide un segundo clic
  fireEvent.click(await screen.findByRole('button', { name: 'Sí, quitar la copia' }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith('bancos'));
});

test('un conflicto dice en qué archivo y «Ver» abre la copia', async () => {
  const view = jest.fn();
  request.mockResolvedValue(catalog(added({ syncState: 'conflict', notice: 'Conflicto en README.md', syncNotice: { at: 'x', conflicts: [{ path: 'README.md', with: 'elenzi', copy: 'README (conflicto).md', kind: 'editado-en-ambos' }] } })));
  render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open} onView={view}/>);
  expect(await screen.findByText('Conflicto en README.md')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
  expect(view).toHaveBeenCalledWith('bancos', 'README (conflicto).md');
});

test('acceso retirado conserva la copia y ofrece quitarla; Escape cierra', async () => {
  request.mockResolvedValue(catalog(added({ removed: true })));
  const close = jest.fn();
  render(<LabSharedProjects onClose={close} onChanged={changed} onOpen={open}/>);
  expect(await screen.findByText('Acceso retirado')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Quitar de mi Lab' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Agregar a mi Lab' })).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(1);
});

test('el catálogo abierto descubre novedades automáticamente sin descargar', async () => {
  jest.useFakeTimers();
  request.mockResolvedValueOnce(catalog()).mockResolvedValue(catalog(available, { ...available, id: 'otro', name: 'Proyecto nuevo' }));
  try {
    render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open}/>);
    await act(async () => {});
    expect(screen.queryByText('Proyecto nuevo')).not.toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(30000); });
    expect(screen.getByText('Proyecto nuevo')).toBeInTheDocument();
    expect(request.mock.calls.every(c => c[0] === '/workspaces/shared')).toBe(true);
  } finally { jest.useRealTimers(); }
});

test('la ventana del + busca en locales y compartidos, y crea sin salir', async () => {
  request.mockImplementation((url: string) => Promise.resolve(url === '/workspaces' ? { id: 'nuevo', label: 'Nueva idea' } : catalog()));
  render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open} localProjects={[{ id: 'local', label: 'Mi investigación', relative: 'workspaces/local', strategies: [] }]}/>);
  await screen.findByText('Bancos ARG 2027');
  expect(screen.getByRole('list', { name: 'Mis proyectos' })).toHaveTextContent('Mi investigación');
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar proyectos por nombre o dueño' }), { target: { value: 'elenzi' } });
  expect(screen.queryByText('Mi investigación')).not.toBeInTheDocument();
  expect(screen.getByText('Bancos ARG 2027')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Crear nuevo' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Nombre' }), { target: { value: ' Nueva idea ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('nuevo'));
  expect(request).toHaveBeenCalledWith('/workspaces', { label: 'Nueva idea' });
});
