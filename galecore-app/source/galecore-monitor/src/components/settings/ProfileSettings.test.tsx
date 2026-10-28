import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileSettings } from './ProfileSettings';
import { deleteSpaceItem, saveSpaceItem, SpaceItem } from '../../api/space';
jest.mock('../../api/space', () => ({
  saveSpaceItem: jest.fn(), deleteSpaceItem: jest.fn(), keyFromTitle: (t: string) => t.toLowerCase().replace(/\W+/g, '-'),
}));

const item = (kind: string, key: string, title: string, content: string) =>
  ({ kind, key, title, content, format: 'markdown', visibility: 'private', isOwn: true } as SpaceItem);
const items = [
  item('convention', 'como-te-llamo', 'Cómo te llamo', 'Llamame «Gonza».'),
  item('convention', 'intereses', 'Intereses', 'opciones sobre SPY'),
  item('memory', 'riesgo', 'Riesgo por posición', 'nunca más del 20 % del riesgo del portfolio'),
  item('profile', 'perfil', 'Perfil', '{"version":12}'),
];
const view = (changed = jest.fn()) => render(<ProfileSettings items={items} onChanged={changed} />);

beforeEach(() => { (saveSpaceItem as jest.Mock).mockReset().mockResolvedValue(undefined); (deleteSpaceItem as jest.Mock).mockReset().mockResolvedValue(undefined); });

test('muestra sólo nombre, intereses y memoria', () => {
  view();
  expect(screen.getByLabelText('¿Cómo querés que te llame?')).toHaveValue('Gonza');
  expect(screen.getByLabelText('Qué te interesa')).toHaveValue('opciones sobre SPY');
  expect(screen.getByText('Riesgo por posición')).toBeInTheDocument();
  expect(screen.getByText('nunca más del 20 % del riesgo del portfolio')).toBeInTheDocument();
  expect(screen.queryByText(/Versión vigente|Capital de referencia|Límites/)).toBeNull();
});

test('agregar un ítem de memoria guarda título y un renglón', async () => {
  const changed = jest.fn(); view(changed);
  fireEvent.click(screen.getByText('+ Agregar'));
  expect(screen.getByText('Guardar')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Horizonte' } });
  fireEvent.change(screen.getByLabelText('Un renglón'), { target: { value: 'operaciones de 30 a 45 días' } });
  fireEvent.click(screen.getByText('Guardar'));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(saveSpaceItem).toHaveBeenCalledWith('memory', 'horizonte', expect.objectContaining({ title: 'Horizonte', content: 'operaciones de 30 a 45 días' }));
});

test('editar y borrar un ítem de memoria', async () => {
  const changed = jest.fn(); view(changed);
  fireEvent.click(screen.getByLabelText('Editar Riesgo por posición'));
  fireEvent.change(screen.getByLabelText('Un renglón'), { target: { value: 'nunca más del 15 %' } });
  fireEvent.click(screen.getByText('Guardar'));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledWith('memory', 'riesgo', expect.objectContaining({ content: 'nunca más del 15 %' })));
  fireEvent.click(await screen.findByLabelText('Borrar Riesgo por posición'));
  fireEvent.click(screen.getByText('Borrar'));
  await waitFor(() => expect(deleteSpaceItem).toHaveBeenCalledWith('memory', 'riesgo'));
});

test('el nombre y los intereses se guardan al salir del campo', async () => {
  view();
  fireEvent.change(screen.getByLabelText('Qué te interesa'), { target: { value: 'volatilidad' } });
  fireEvent.blur(screen.getByLabelText('Qué te interesa'));
  await waitFor(() => expect(saveSpaceItem).toHaveBeenCalledWith('convention', 'intereses', expect.objectContaining({ content: 'volatilidad' })));
  fireEvent.change(screen.getByLabelText('¿Cómo querés que te llame?'), { target: { value: '' } });
  fireEvent.blur(screen.getByLabelText('¿Cómo querés que te llame?'));
  await waitFor(() => expect(deleteSpaceItem).toHaveBeenCalledWith('convention', 'como-te-llamo'));
});
