import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceHeader } from './WorkspaceHeader';
jest.mock('./WorkspaceSearch', () => ({ WorkspaceSearch: () => <button>Buscar</button> }));
test('marco único reúne logo, búsqueda y control lateral sin repetir el título de página', () => {
  const toggle = jest.fn(); const navigate = jest.fn();
  const props = { active: 'macro' as const, onChange: navigate, onLogout: () => {}, conversationOpen: false,
    onConversation: () => {}, onSymbol: async () => {}, onSidebarToggle: toggle };
  const { rerender } = render(<WorkspaceHeader {...props} />);
  expect(screen.queryByRole('heading', { name: 'Macro' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ocultar barra lateral' })); expect(toggle).toHaveBeenCalledTimes(1);
  rerender(<WorkspaceHeader {...props} sidebarHidden />);
  expect(screen.getByRole('button', { name: 'Mostrar barra lateral' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /GaleCore/ })); expect(navigate).toHaveBeenCalledWith('inicio');
});
