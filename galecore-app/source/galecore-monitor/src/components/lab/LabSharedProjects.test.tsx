import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { labRequest } from '../../api/lab';
import { LabSharedProjects } from './LabSharedProjects';

jest.mock('../../api/lab', () => ({ labRequest: jest.fn() }));
const request = labRequest as jest.Mock;
const available = { id: 'id-eric', name: 'Bancos ARG 2027', owner: 'elenzi', local: null, subscribed: false };
const catalog = (project = available) => ({ user: 'demo', api: 'http://localhost:7001', projects: [project] });
const changed = jest.fn(async () => {});
const open = jest.fn();
beforeEach(() => { jest.clearAllMocks(); });

test('consultar muestra nombre y dueño sin descargar archivos', async () => {
  request.mockResolvedValue(catalog());
  render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open}/>);
  expect(await screen.findByText('Bancos ARG 2027')).toBeInTheDocument();
  expect(screen.getByText('Dueño: elenzi')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Agregar' })).toBeEnabled();
  expect(request.mock.calls.map(c => c[0])).toEqual(['/workspaces/shared']);
});

test('agregar y pausar actualizan la lista y muestran que la copia está agregada', async () => {
  let followed = false;
  request.mockImplementation((url: string) => {
    if (url.endsWith('/subscribe')) { followed = true; return Promise.resolve({project:'bancos'}); }
    if (url.endsWith('/pause')) { followed = false; return Promise.resolve({project:'bancos'}); }
    return Promise.resolve(catalog({ ...available, local: 'bancos', subscribed: followed } as any));
  });
  render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open}/>);
  fireEvent.click(await screen.findByRole('button', {name:'Reanudar'}));
  fireEvent.click(await screen.findByRole('button', {name:'Pausar'}));
  expect(await screen.findByText(/Seguimiento pausado/)).toHaveTextContent('Tu copia y tus conversaciones se conservan');
  expect(screen.getByText('Agregado')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Abrir'})).not.toBeInTheDocument();
  expect(changed).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.some(c => c[0].includes('unshare') || c[0].includes('delete'))).toBe(false);
});

test('un fallo de red conserva el catálogo y permite actualizar', async () => {
  request.mockResolvedValueOnce(catalog()).mockRejectedValueOnce(new Error('Sin conexión')).mockResolvedValue(catalog());
  render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open}/>);
  await screen.findByText('Bancos ARG 2027');
  fireEvent.click(screen.getByRole('button',{name:'Actualizar'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión');
  expect(screen.getByText('Bancos ARG 2027')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Actualizar'}));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

test('muestra fallo de descarga persistente y archivos omitidos sin afirmar éxito completo', async () => {
  request.mockResolvedValue({user:'demo',projects:[{...available, local:'bancos',subscribed:true,lastSuccess:'2026-10-29T22:00:00Z',lastError:'Archivo pendiente',skipped:[{path:'grande.csv',reason:'mayor a 2 MB'}]}]});
  render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open}/>);
  expect(await screen.findByText('Pendiente')).toBeInTheDocument();
  expect(screen.getByText('Archivo pendiente')).toBeInTheDocument();
  expect(screen.getByText('grande.csv: mayor a 2 MB')).toBeInTheDocument();
  expect(screen.queryByText('Sincronizado')).not.toBeInTheDocument();
});

test('acceso retirado conserva Agregado, sin ofrecer volver a descargar', async () => {
  request.mockResolvedValue(catalog({...available,local:'bancos',removed:true} as any));
  const close = jest.fn();
  render(<LabSharedProjects onClose={close} onChanged={changed} onOpen={open}/>);
  expect(await screen.findByText('Acceso retirado')).toBeInTheDocument();
  expect(screen.getByText('Agregado')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Agregar'})).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
  expect(close).toHaveBeenCalledTimes(1);
});

test('el catálogo abierto descubre novedades automáticamente sin descargar', async () => {
  jest.useFakeTimers();
  request.mockResolvedValueOnce(catalog()).mockResolvedValue({user:'demo',projects:[available,{...available,id:'otro',name:'Proyecto nuevo'}]});
  try {
    render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open}/>);
    await act(async () => {});
    expect(screen.queryByText('Proyecto nuevo')).not.toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(30000); });
    expect(screen.getByText('Proyecto nuevo')).toBeInTheDocument();
    expect(request.mock.calls.every(c=>c[0]==='/workspaces/shared')).toBe(true);
  } finally { jest.useRealTimers(); }
});

test('la ventana del + permite buscar locales y compartidos, y crear sin salir', async () => {
  request.mockImplementation((url: string) => Promise.resolve(url === '/workspaces' ? {id:'nuevo',label:'Nueva idea'} : catalog()));
  render(<LabSharedProjects onClose={() => {}} onChanged={changed} onOpen={open} localProjects={[{id:'local',label:'Mi investigación',relative:'workspaces/local',strategies: []}]}/>);
  await screen.findByText('Bancos ARG 2027');
  expect(screen.getByText('Mi investigación')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox',{name:'Buscar proyectos por nombre o dueño'}),{target:{value:'elenzi'}});
  expect(screen.queryByText('Mi investigación')).not.toBeInTheDocument();
  expect(screen.getByText('Bancos ARG 2027')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Crear nuevo'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Nombre'}),{target:{value:' Nueva idea '}});
  fireEvent.click(screen.getByRole('button',{name:'Crear proyecto'}));
  await waitFor(()=>expect(open).toHaveBeenCalledWith('nuevo'));
  expect(request).toHaveBeenCalledWith('/workspaces',{label:'Nueva idea'});
});
