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
  rerender(<WorkspaceNav mode="lab" active="shadow" onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: 'Espacio de trabajo' })); expect(change).toHaveBeenCalledWith('lab');
  expect(screen.getByRole('button', { name: 'Seguimiento SHADOW' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('Tu espacio de trabajo')).toBeInTheDocument();
  expect(screen.getByText('Compartido')).toBeInTheDocument();
});

test('contraer conserva destinos accesibles y sólo admin ve administración', () => {
  mockAdmin = true;
  render(<WorkspaceNav active="config" onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Administración' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Contraer navegación' }));
  expect(screen.getByRole('button', { name: 'Expandir navegación' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Configuración' })).toHaveAttribute('aria-current', 'page');
});

test("Macro tiene un destino propio debajo de Mercado", () => {
  const change = jest.fn();
  render(<WorkspaceNav active="macro" onChange={change} />);
  const macro = screen.getByRole("button", { name: "Macro" });
  expect(macro).toHaveAttribute("aria-current", "page");
  fireEvent.click(macro);
  expect(change).toHaveBeenCalledWith("macro");
  const buttons = screen.getAllByRole("button");
  expect(buttons.indexOf(macro)).toBe(buttons.indexOf(screen.getByRole("button", { name: "Mercado" })) + 1);
});
