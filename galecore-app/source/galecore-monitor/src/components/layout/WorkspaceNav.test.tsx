import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceNav } from './WorkspaceNav';
let mockAdmin = false;
jest.mock('../../store/useCurrentUserStore', () => ({ useCurrentUserStore: (select: any) => select({ user: { username: 'demo', isAdmin: mockAdmin } }) }));
test('los destinos permanecen al entrar al chat, sin duplicados; en el chat la barra queda en íconos', () => {
  mockAdmin = false; const change = jest.fn();
  const { rerender } = render(<WorkspaceNav active="gex" onChange={change}/>);
  for (const name of ['Inicio','Mercado','Macro','Biblioteca','Estrategias','Chat','Agentes']) expect(screen.getAllByRole('button',{ name })).toHaveLength(1);
  for (const name of ['Mesa de operación','Posiciones','Seguimiento RPF','Seguimiento SHADOW']) expect(screen.queryByRole('button',{ name })).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{ name:'Cartera' })).not.toBeInTheDocument(); // Cartera se unió a Inicio (15/10)
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
test('Macro tiene su propia entrada y se despliega en Global y Argentina (WS-0095)',()=>{
 try{localStorage.removeItem('galecore:macro:last');}catch{}
 const change=jest.fn();
 const {rerender}=render(<WorkspaceNav active="gex" onChange={change}/>);
 expect(screen.queryByRole('button',{name:'Global'})).not.toBeInTheDocument();   // cerrado fuera de Macro
 fireEvent.click(screen.getByRole('button',{name:'Macro'}));expect(change).toHaveBeenLastCalledWith('macro');   // por defecto Global
 rerender(<WorkspaceNav active="macro" onChange={change}/>);
 expect(screen.getByRole('button',{name:'Macro'})).toHaveAttribute('aria-expanded','true');
 expect(screen.getByRole('button',{name:'Global'})).toHaveAttribute('aria-current','page');
 expect(screen.getByRole('button',{name:'Argentina'})).not.toHaveAttribute('aria-current');
 expect(screen.getByRole('button',{name:'Mercado'})).not.toHaveAttribute('aria-current');
 fireEvent.click(screen.getByRole('button',{name:'Argentina'}));expect(change).toHaveBeenLastCalledWith('macro-ar');
 rerender(<WorkspaceNav active="macro-ar" onChange={change}/>);
 expect(screen.getByRole('button',{name:'Argentina'})).toHaveAttribute('aria-current','page');
 rerender(<WorkspaceNav active="gex" onChange={change}/>);
 fireEvent.click(screen.getByRole('button',{name:'Macro'}));expect(change).toHaveBeenLastCalledWith('macro-ar');   // vuelve al último hijo usado
});

test('Chat libera la columna y revela la navegación desde el borde, teclado o toque; conserva el menú de cuenta', () => {
  const change=jest.fn();
  const {container,rerender}=render(<WorkspaceNav active="lab" onChange={change}/>);
  const edge=screen.getByRole('button',{name:'Mostrar navegación'}),area=container.querySelector('.workspace-nav-reveal')!;
  expect(area).not.toHaveClass('is-open');
  fireEvent.pointerEnter(area,{pointerType:'mouse'});
  expect(area).toHaveClass('is-open');
  fireEvent.click(screen.getByRole('button',{name:'Mercado'}));expect(change).toHaveBeenCalledWith('gex');
  fireEvent.pointerLeave(area);expect(area).not.toHaveClass('is-open');
  fireEvent.click(edge);expect(edge).toHaveAttribute('aria-expanded','true');
  fireEvent.click(screen.getByRole('button',{name:'Menú de usuario'}));
  fireEvent.pointerLeave(area);expect(area).toHaveClass('is-open');
  fireEvent.keyDown(area,{key:'Escape'});expect(area).not.toHaveClass('is-open');
  expect(edge).toHaveFocus();
  act(()=>screen.getByRole('button',{name:'Mercado'}).focus());
  fireEvent.pointerEnter(area,{pointerType:'mouse'});fireEvent.pointerLeave(area);
  expect(area).toHaveClass('is-open');
  expect(screen.getByRole('button',{name:'Mercado'})).toHaveFocus();
  fireEvent.keyDown(area,{key:'Escape'});expect(area).not.toHaveClass('is-open');
  fireEvent.click(edge);fireEvent.blur(area,{relatedTarget:document.body});expect(area).not.toHaveClass('is-open');
  rerender(<WorkspaceNav active="gex" onChange={change}/>);
  expect(container.querySelector('.workspace-nav-reveal')).toBeNull();
});
