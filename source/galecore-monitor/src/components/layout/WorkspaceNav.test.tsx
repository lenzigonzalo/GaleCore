import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceNav } from './WorkspaceNav';
let mockAdmin = false;
jest.mock('../../store/useCurrentUserStore', () => ({ useCurrentUserStore: (select: any) => select({ user: { username: 'demo', isAdmin: mockAdmin } }) }));
test('los destinos permanecen al entrar al chat, sin duplicados; en el chat la barra queda en íconos', () => {
  mockAdmin = false; const change = jest.fn();
  const { rerender } = render(<WorkspaceNav active="gex" onChange={change}/>);
  for (const name of ['Inicio','Mercado','Macro','Posiciones','Estrategias','Chat','Agentes']) expect(screen.getAllByRole('button',{ name })).toHaveLength(1);
  for (const name of ['Biblioteca','Mesa de operación','Cartera','Seguimiento RPF','Seguimiento SHADOW']) expect(screen.queryByRole('button',{ name })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{ name:'Posiciones' })); expect(change).toHaveBeenCalledWith('monitor');
  rerender(<WorkspaceNav active="lab" onChange={change}/>);
  expect(screen.getByRole('button',{ name:'Chat' })).toHaveAttribute('aria-current','page');
  expect(document.querySelector('.workspace-navigation')).toHaveClass('compact');
  expect(screen.getByRole('button',{ name:'Estrategias' })).toBeInTheDocument();
});
test('administración sólo aparece en el menú de un admin; usuario puede salir', () => {
  mockAdmin = true; const change=jest.fn(), logout=jest.fn();
  const { rerender }=render(<WorkspaceNav active="inicio" onChange={change} onLogout={logout}/>);
  expect(screen.queryByRole('menuitem',{ name:'Administración' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{ name:'Menú de usuario' }));
  fireEvent.click(screen.getByRole('menuitem',{ name:'Administración' })); expect(change).toHaveBeenCalledWith('admin');
  mockAdmin=false; rerender(<WorkspaceNav active="inicio" onChange={change} onLogout={logout}/>);
  fireEvent.click(screen.getByRole('button',{ name:'Menú de usuario' }));
  expect(screen.queryByRole('menuitem',{ name:'Administración' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitem',{ name:'Salir' })); expect(logout).toHaveBeenCalled();
});
test('Macro tiene su propia entrada (owner, 14/10)',()=>{
 render(<WorkspaceNav active="macro" onChange={()=>{}}/>);
 expect(screen.getByRole('button',{name:'Macro'})).toHaveAttribute('aria-current','page');
 expect(screen.getByRole('button',{name:'Mercado'})).not.toHaveAttribute('aria-current');
});
