import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LayoutPreview } from './LayoutPreview';
import { fetchSpace } from '../api/space';
import { fetchCurrentUser } from '../api/me';
jest.mock('../api/space', () => ({ fetchSpace: jest.fn() }));
jest.mock('../api/me', () => ({ fetchCurrentUser: jest.fn() }));

test('preview recorre destinos y abre conversación sin montar lecturas protegidas', () => {
  render(<LayoutPreview />);
  expect(screen.getByText(/Vista local de diseño/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mercado' }));
  expect(screen.getByText('Espacio del gráfico')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cartera' }));
  expect(screen.getByText('Valor de cuenta')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /MI CUENTA/i })).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Navegación principal' })).getByRole('button', { name: 'Abrir conversación' }));
  expect(screen.getByText('Vista de diseño. No se abre una sesión de modelo.')).toBeInTheDocument();
  expect(fetchSpace).not.toHaveBeenCalled();
  expect(fetchCurrentUser).not.toHaveBeenCalled();
});
