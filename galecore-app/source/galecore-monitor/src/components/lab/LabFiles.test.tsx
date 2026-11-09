import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LabFiles } from './LabFiles';
import { labRaw, labRequest } from '../../api/lab';

jest.mock('../../api/lab', () => ({ labRequest: jest.fn(), labUpload: jest.fn(), labRaw: jest.fn() }));
const request = labRequest as jest.Mock;
beforeEach(() => {
  jest.resetAllMocks();
  request.mockImplementation(async (url: string) => url.endsWith('/sync') ? { pulled: 1, pushed: 2, conflicts: [] } : { tree: [] });
});

test('en un proyecto NO compartido, Actualizar sólo relee la carpeta', async () => {
  render(<LabFiles projectId="spy" folder="strategies/spy"/>);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(request.mock.calls.every(c => !String(c[0]).endsWith('/sync'))).toBe(true);
});

test('en un proyecto compartido, Actualizar sincroniza, relee el árbol y avisa el resultado', async () => {
  const synced = jest.fn();
  render(<LabFiles projectId="bancos" shared unsynced onSynced={synced}/>);
  expect(await screen.findByText(/Cambios sin compartir/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  expect(await screen.findByText('Sincronizando…')).toBeInTheDocument();
  expect(await screen.findByText('Sincronizado: 1 traídos, 2 subidos.')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/workspaces/bancos/sync', {}, 180000);
  const urls = request.mock.calls.map(c => c[0]);
  expect(urls.lastIndexOf('/workspaces/bancos/files')).toBeGreaterThan(urls.indexOf('/workspaces/bancos/sync'));   // primero sincroniza, después relee
  await waitFor(() => expect(synced).toHaveBeenCalled());
});

test('si el sync falla, el error queda en el estado y el árbol igual se relee', async () => {
  request.mockImplementation(async (url: string) => { if (url.endsWith('/sync')) throw new Error('GaleCore no respondió'); return { tree: [] }; });
  render(<LabFiles projectId="bancos" shared/>);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('GaleCore no respondió');
  await waitFor(() => expect(request.mock.calls.filter(c => c[0] === '/workspaces/bancos/files')).toHaveLength(2));
});

test('un html abre en Vista (iframe) y Código lleva al editor; una imagen abre su vista previa', async () => {
  (global.URL as any).createObjectURL = jest.fn(() => 'blob:x'); (global.URL as any).revokeObjectURL = jest.fn();
  (labRaw as jest.Mock).mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
  request.mockImplementation(async (url: string) => url.includes('?path=') ? { text: '<p>hola</p>' }
    : { tree: [{ path: 't.html', name: 't.html', kind: 'file' }, { path: 'g.png', name: 'g.png', kind: 'file', text: false, image: true }] });
  const { container } = render(<LabFiles projectId="spy"/>);
  fireEvent.click(await screen.findByText('t.html'));
  await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
  expect(container.querySelector('textarea')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Código' }));
  expect(container.querySelector('textarea')).not.toBeNull();
  fireEvent.click(screen.getByText('g.png'));
  expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:x');
});
