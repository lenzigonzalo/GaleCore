import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceHeader } from './WorkspaceHeader';
import { useAccountStore } from '../../store/useAccountStore';
jest.mock('./WorkspaceSearch', () => ({ WorkspaceSearch: () => <input aria-label="Buscar" /> }));
jest.mock('./AccountMenu', () => ({ AccountMenu: () => <span>Perfil</span> }));
beforeEach(() => useAccountStore.getState().reset());
const props = { onChange: jest.fn(), onLogout: () => {}, conversationOpen: true, onConversation: () => {}, onSymbol: async () => {} };
test('Trabajo oculta saldo real incluso en Agentes, conservando conversación', () => {
  const { rerender } = render(<WorkspaceHeader {...props} active="agentes" />);
  expect(screen.queryByTitle('Abrir Cartera')).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Vistas del Lab' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ocultar conversación' })).toHaveAttribute('aria-pressed', 'true');
  rerender(<WorkspaceHeader {...props} active="lab" />);
  expect(screen.queryByTitle('Abrir Cartera')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ejecuciones SHADOW' }));
  expect(props.onChange).toHaveBeenCalledWith('shadow');
});
test('Gestión conserva acceso a la cuenta y no ofrece subnavegación SHADOW', () => {
  render(<WorkspaceHeader {...props} active="inicio" />);
  fireEvent.click(screen.getByTitle('Abrir Cartera'));
  expect(props.onChange).toHaveBeenCalledWith('monitor');
  expect(screen.queryByRole('navigation', { name: 'Vistas del Lab' })).not.toBeInTheDocument();
});

test('demo no mezcla saldo real ni buscador real en la cabecera', () => {
  render(<WorkspaceHeader {...props} active="inicio" mainDemo />);
  expect(screen.queryByTitle('Abrir Cartera')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Buscar' })).not.toBeInTheDocument();
  expect(screen.getByText('Vista de diseño · datos ficticios')).toBeInTheDocument();
});
