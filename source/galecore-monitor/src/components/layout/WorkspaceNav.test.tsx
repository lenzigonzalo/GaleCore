import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceNav } from './WorkspaceNav';

let mockAdmin = false;
jest.mock('../../store/useCurrentUserStore', () => ({
  useCurrentUserStore: (select: (state: { user: { isAdmin: boolean } }) => unknown) => select({ user: { isAdmin: mockAdmin } }),
}));

test('agrupa Mercado y ejecuciones en sus destinos, sin conceder administración', () => {
  mockAdmin = false;
  const change = jest.fn();
  const { rerender } = render(<WorkspaceNav active="gex" onChange={change} />);
  expect(screen.getByRole('button', { name: 'Mercado' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('button', { name: 'Administración' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cartera' })); expect(change).toHaveBeenCalledWith('monitor');
  expect(screen.queryByRole('button', { name: 'Abrir conversación' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lab' })); expect(change).toHaveBeenCalledWith('lab');
  rerender(<WorkspaceNav active="shadow" onChange={change} />);
  expect(screen.getByRole('button', { name: 'Estrategias' })).toHaveAttribute('aria-current', 'page');
});

test('contraer conserva destinos accesibles y sólo admin ve administración', () => {
  mockAdmin = true;
  render(<WorkspaceNav active="config" onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Administración' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Contraer navegación' }));
  expect(screen.getByRole('button', { name: 'Expandir navegación' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Configuración' })).toHaveAttribute('aria-current', 'page');
});
