import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SkillsView } from './SkillsView';
import { SpaceItem, saveSpaceItem } from '../../api/space';

jest.mock('../../api/space', () => ({
  saveSpaceItem: jest.fn(), deleteSpaceItem: jest.fn(), keyFromTitle: () => 'mi-skill',
}));
const platform: SpaceItem = { kind: 'skill', key: 'aviso', title: 'Analizar aviso',
  content: 'Explica un aviso.\n\n## Pasos\n1. Leer el contexto.', format: 'markdown',
  visibility: 'shared', version: 2, updatedAt: '2026-10-23T12:00:00Z', owner: 'demo', isOwn: true };
const mine: SpaceItem = { ...platform, key: 'propia', title: 'Mi método', visibility: 'private', isOwn: true };

beforeEach(() => jest.clearAllMocks());

test('busca, filtra y permite consultar resumen y Markdown de plataforma sin editar', () => {
  render(<SkillsView items={[platform, mine]} onChanged={jest.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Tuyas' }));
  expect(screen.queryByText('Analizar aviso')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar skills' }), { target: { value: 'aviso' } });
  fireEvent.click(screen.getByText('Analizar aviso'));
  expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByRole('button', { name: 'Editar skill' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Contenido' }));
  fireEvent.click(screen.getByRole('button', { name: 'Código Markdown' }));
  expect(screen.getByText((_, element) => element?.tagName === 'PRE' && element.textContent === platform.content)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Todas las skills' }));
  expect(screen.getByRole('textbox', { name: 'Buscar skills' })).toHaveValue('aviso');
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar skills' }), { target: { value: 'inexistente' } });
  expect(screen.getByText('No hay skills que coincidan')).toBeInTheDocument();
});

test('un fallo al guardar conserva instrucciones y permite reintentar la edición privada', async () => {
  (saveSpaceItem as jest.Mock).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
  const changed = jest.fn();
  render(<SkillsView items={[mine]} onChanged={changed}/>);
  fireEvent.click(screen.getByText('Mi método'));
  fireEvent.click(screen.getByRole('button', { name: 'Editar skill' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Instrucciones en Markdown' }), { target: { value: 'Nuevo método' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar');
  expect(screen.getByRole('textbox')).toHaveValue('Nuevo método');
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(saveSpaceItem).toHaveBeenLastCalledWith('skill', 'propia', expect.objectContaining({ content: 'Nuevo método', visibility: 'private' }));
});

test('crear usa el contrato privado existente y rechaza nombre duplicado', async () => {
  (saveSpaceItem as jest.Mock).mockResolvedValue(undefined);
  const changed = jest.fn();
  const { rerender } = render(<SkillsView items={[{ ...mine, key: 'mi-skill' }]} onChanged={changed}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Nueva skill' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Mi skill' } });
  fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Ya hay una skill');
  expect(saveSpaceItem).not.toHaveBeenCalled();
  rerender(<SkillsView items={[]} onChanged={changed}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(saveSpaceItem).toHaveBeenCalledWith('skill', 'mi-skill', expect.objectContaining({ title: 'Mi skill', format: 'markdown', visibility: 'private' }));
});

test('el resumen ignora encabezados de ejemplos de código y las pestañas responden al teclado', () => {
  render(<SkillsView items={[{ ...platform, content: 'Descripción.\n\n## Sección real\n\n```markdown\n## Ejemplo interno\n```' }]} onChanged={jest.fn()}/>);
  fireEvent.click(screen.getByText('Analizar aviso'));
  expect(screen.getByText('Sección real')).toBeInTheDocument();
  expect(screen.queryByText('Ejemplo interno')).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Resumen' }), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Contenido' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Vista previa' })).toBeInTheDocument();
});
