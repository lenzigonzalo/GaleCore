import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceHeader } from './WorkspaceHeader';

test('un único marco, sin chat dividido ni controles de modo', () => {
  const navigate = jest.fn();
  render(<WorkspaceHeader active="macro" onChange={navigate} onLogout={() => {}} onSymbol={async () => {}}/>);
  for (const name of ['Monitor', 'Operativa', 'Lab', 'Ocultar barra lateral', 'Abrir chat dividido']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^GaleCore/ })); expect(navigate).toHaveBeenCalledWith('inicio');
});

test('Mercado ofrece una sola caja de busqueda en el centro y deja libre el slot del Lab', () => {
  const props = {onChange:jest.fn(),onLogout:jest.fn(),onSymbol:jest.fn(async()=>{})};
  const {container,rerender} = render(<WorkspaceHeader {...props} active="gex"/>);
  const search = screen.getByRole('button',{name:'Buscar en GaleCore'});
  expect(screen.getAllByRole('button',{name:'Buscar en GaleCore'})).toHaveLength(1);
  expect(search).toHaveClass('workspace-search-box');
  expect(search.closest('#workspace-header-slot')).toBeInTheDocument();
  expect(container.querySelector('header')).toHaveClass('workspace-market-header');
  fireEvent.click(search);
  expect(screen.getByRole('dialog',{name:'Buscar en GaleCore'})).toBeVisible();
  fireEvent.keyDown(document,{key:'Escape'});
  expect(search).toHaveFocus();
  rerender(<WorkspaceHeader {...props} active="lab"/>);
  expect(container.querySelector('#workspace-header-slot')).toBeEmptyDOMElement();
  expect(screen.getByRole('button',{name:'Buscar en GaleCore'})).toHaveClass('workspace-icon-button');
});
