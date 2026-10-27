import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceHeader } from './WorkspaceHeader';
jest.mock('./WorkspaceSearch', () => ({ WorkspaceSearch: () => <button>Buscar</button> }));
test('un único marco, sin chat dividido ni controles de modo', () => {
  const navigate = jest.fn();
  render(<WorkspaceHeader active="macro" onChange={navigate} onLogout={() => {}} onSymbol={async () => {}}/>);
  for (const name of ['Monitor', 'Operativa', 'Lab', 'Ocultar barra lateral', 'Abrir chat dividido']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /GaleCore/ })); expect(navigate).toHaveBeenCalledWith('inicio');
});
