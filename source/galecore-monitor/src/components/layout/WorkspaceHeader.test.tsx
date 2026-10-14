import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceHeader } from './WorkspaceHeader';
jest.mock('./WorkspaceSearch', () => ({ WorkspaceSearch: () => <button>Buscar</button> }));
test('un único marco y chat dividido, sin controles de modo ni ocultar navegación', () => {
  const toggle = jest.fn(); const navigate = jest.fn();
  const props = { active: 'macro' as const, onChange: navigate, onLogout: () => {}, conversationOpen: false, onConversation: toggle, onSymbol: async () => {} };
  const { rerender } = render(<WorkspaceHeader {...props}/>);
  for (const name of ['Monitor', 'Operativa', 'Lab', 'Ocultar barra lateral']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir chat dividido' })); expect(toggle).toHaveBeenCalledTimes(1);
  rerender(<WorkspaceHeader {...props} conversationOpen/>);
  expect(screen.getByRole('button', { name: 'Ocultar chat dividido' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: /GaleCore/ })); expect(navigate).toHaveBeenCalledWith('inicio');
});
