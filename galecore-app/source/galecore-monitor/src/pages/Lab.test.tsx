jest.mock('../api/client', () => ({ __esModule: true, default: { get: jest.fn().mockResolvedValue({ data: { items: [] } }) } }));
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Lab } from './Lab';
jest.mock('../api/space', () => ({ fetchSpace: () => Promise.resolve({ items: [], shared: [] }), saveSpaceItem: () => Promise.resolve() }));
import { labRequest } from '../api/lab';
jest.mock('../api/lab',()=>({labRequest:jest.fn()}));
jest.mock('./LabShadow',()=>({LabShadow:({strategy,mode}:{strategy?:string|null;mode?:string})=> <div data-strategy={strategy} data-mode={mode}>Seguimiento del proyecto</div>}));
jest.mock('../components/lab/LabShell',()=>({LabShell:()=> <div>Terminal del proyecto</div>}));
beforeEach(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver; });
const projects=[{id:'personal',label:'Personal',relative:'workspaces/personal'},{id:'spy',label:'Estrategia SPY',relative:'strategies/spy',strategies: ['spy_spec']}];
beforeEach(()=>{sessionStorage.clear();jest.clearAllMocks();Element.prototype.scrollIntoView=jest.fn();(labRequest as jest.Mock).mockImplementation(async(path:string,body?:any)=>{if(path==='/workspaces')return {projects,chats:[],providers:[{id:'codex',label:'Codex',installed:true}]};if(path.endsWith('/files'))return {tree:[{name:'memory',path:'memory',kind:'folder',children:[{name:'nota.md',path:'memory/nota.md',kind:'file'}]}]};if(path.includes('/files?'))return {text:'Memoria del proyecto seleccionado'};if(path==='/chats')return {id:'chat-1',project:body.project,provider:body.provider,title:'Nueva',state:'idle',messages:[]};if(path.endsWith('/messages'))return {id:'chat-1',project:'spy',provider:'codex',state:'running',messages:[{id:'m',role:'user',text:body.text}]};return {id:'chat-1',project:'spy',provider:'codex',state:'idle',messages:[]};});});
test('Archivos y Shell son vistas del proyecto seleccionado, al lado del chat; sin vistas duplicadas de Estrategias',async()=>{render(<Lab onMonitor={()=>{}}/>);await screen.findByRole('button',{name:'Personal'});expect(screen.queryByRole('navigation',{name:'Archivos del proyecto'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Estrategia SPY'}));fireEvent.click(screen.getByRole('button',{name:'Archivos'}));fireEvent.click(await screen.findByRole('button',{name:'memory'}));fireEvent.click(await screen.findByRole('button',{name:'nota.md'}));expect(await screen.findByText('Memoria del proyecto seleccionado')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Editar'}));expect(screen.getByDisplayValue('Memoria del proyecto seleccionado')).toBeInTheDocument();expect(labRequest).toHaveBeenCalledWith('/workspaces/spy/files?path=memory%2Fnota.md');fireEvent.click(screen.getByRole('button',{name:'Shell'}));expect(screen.getByText('Terminal del proyecto')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Chat'}));expect(screen.getByRole('textbox',{name:'Mensaje al proyecto'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Shadow'})).not.toBeInTheDocument();});
test('borradores separados por proyecto y envío usa el chat real con el proyecto exacto',async()=>{render(<Lab onMonitor={()=>{}}/>);await screen.findByRole('button',{name:'Personal'});fireEvent.change(screen.getByRole('textbox',{name:'Mensaje al proyecto'}),{target:{value:'Pedido personal'}});fireEvent.click(screen.getByRole('button',{name:'Estrategia SPY'}));expect(screen.getByRole('textbox',{name:'Mensaje al proyecto'})).toHaveValue('');fireEvent.change(screen.getByRole('textbox',{name:'Mensaje al proyecto'}),{target:{value:'Trabajemos una estrategia en SPY'}});fireEvent.click(screen.getByRole('button',{name:'Personal'}));expect(screen.getByRole('textbox',{name:'Mensaje al proyecto'})).toHaveValue('Pedido personal');fireEvent.click(screen.getByRole('button',{name:'Estrategia SPY'}));fireEvent.click(screen.getByRole('button',{name:'Enviar mensaje'}));await waitFor(()=>expect(labRequest).toHaveBeenCalledWith('/chats',{project:'spy',provider:'codex'}));expect(labRequest).toHaveBeenCalledWith('/chats/chat-1/messages',{text:'Trabajemos una estrategia en SPY',mode:'manual',attachments:[]});});
test('falla de conexión visible, sin historial ni respuestas inventadas',async()=>{(labRequest as jest.Mock).mockRejectedValue(new Error('offline'));render(<Lab onMonitor={()=>{}}/>);expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar');expect(screen.getByRole('button',{name:'Enviar mensaje'})).toBeDisabled();});

test('proyecto recibido desde Estrategias comparte la lateral y abre su seguimiento desde el panel Proyecto',async()=>{
 const host=document.createElement('div');host.id='workspace-projects';document.body.appendChild(host);
 localStorage.setItem('galecore:lab:mapa','1');
 const follow=jest.fn();const {unmount}=render(<Lab embedded projectRequest={{id:'spy',sequence:1}} onFollowStrategy={follow} onMonitor={()=>{}}/>);
 await screen.findByRole('button',{name:/Resultados de/});localStorage.removeItem('galecore:lab:mapa');
 expect(host.querySelector('.lab-chat-sidebar')).toBeInTheDocument();
 expect(document.querySelectorAll('.lab-chat-sidebar')).toHaveLength(1);
 expect(screen.queryByRole('button',{name:'Configuración'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Resultados de/}));expect(follow).toHaveBeenCalledWith('spy_spec');
 unmount();host.remove();
});

test('mientras responde muestra los pasos ya hechos y el actual (owner 18/10)',async()=>{
 sessionStorage.setItem('galecore:lab:chat','chat-1');
 (labRequest as jest.Mock).mockImplementation(async(path:string)=>{if(path==='/workspaces')return {projects,chats:[{id:'chat-1',project:'spy',provider:'codex',title:'Vieja',state:'running'}],providers:[{id:'codex',label:'Codex',installed:true}]};if(path.endsWith('/mapa'))return {mapa:null};return {id:'chat-1',project:'spy',provider:'codex',state:'running',activity:'Trayendo la cadena de SPY',steps:[{label:'Primero miro tu perfil.',kind:'note',at:''},{label:'Leyendo tu perfil',detail:'galecore-ai profile show',at:''},{label:'Trayendo la cadena de SPY',detail:'galecore-ai galecore get market.option_chains --symbol SPY',at:''}],messages:[{id:'m',role:'user',text:'hola'}]};});
 render(<Lab onMonitor={()=>{}}/>);
 expect(await screen.findByText('Leyendo tu perfil')).toBeInTheDocument();
 expect(screen.getByText('Primero miro tu perfil.')).toBeInTheDocument();                       // la narración, como Claude Code
 expect(screen.getByText('galecore-ai profile show')).toBeInTheDocument();                      // con qué
 expect(screen.getByText('Trayendo la cadena de SPY…')).toBeInTheDocument();                    // el actual, sin repetirse
 expect(screen.queryByText('Trayendo la cadena de SPY')).not.toBeInTheDocument();
});

test('nuevo proyecto pide sólo el nombre; la estrategia llega después, por intención (owner 19/10)',async()=>{
 const base=(labRequest as jest.Mock).getMockImplementation()!;
 (labRequest as jest.Mock).mockImplementation(async(path:string,body?:any)=>path==='/workspaces'&&body?{id:'idea_qqq',label:'Idea QQQ',relative:'workspaces/idea_qqq',strategies: []}:base(path,body));
 render(<Lab onMonitor={()=>{}}/>);await screen.findByRole('button',{name:'Personal'});
 fireEvent.click(screen.getByRole('button',{name:'Crear proyecto'}));
 const dialog=await screen.findByRole('dialog');
 expect(dialog.querySelector('select')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Crear nuevo'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Nombre'}),{target:{value:'Idea QQQ'}});
 fireEvent.submit(dialog.querySelector('form')!);
 await waitFor(()=>expect(labRequest).toHaveBeenCalledWith('/workspaces',{label:'Idea QQQ'}));
});
test('Proyecto aparece en todos los proyectos, sin tipos (WS-0071)',async()=>{
 render(<Lab onMonitor={()=>{}}/>);await screen.findByRole('button',{name:'Personal'});
 expect(await screen.findByRole('button',{name:'Proyecto'})).toBeInTheDocument();   // Personal
 fireEvent.click(screen.getByRole('button',{name:'Estrategia SPY'}));
 expect(await screen.findByRole('button',{name:'Proyecto'})).toBeInTheDocument();   // con estrategia
});
test('el panel Proyecto lista sus estrategias e informes, y cada clic abre lo suyo (WS-0071 AC-3)',async()=>{
 const base=(labRequest as jest.Mock).getMockImplementation()!;
 const argentina={id:'argentina',label:'Argentina',relative:'workspaces/argentina',strategies:['bonos_ar','evento_ar']};
 (labRequest as jest.Mock).mockImplementation(async(path:string,body?:any)=>{
  if(path==='/workspaces')return {...(await base(path,body)),projects:[argentina]};
  if(path.endsWith('/informes'))return {informes:[{path:'memory/contexto.md',name:'contexto.md',updatedAt:'2026-11-01T10:00:00Z'}]};
  if(path.includes('/strategy?name=evento_ar'))return {current:{ref:'strategy:evento_ar/1.0.0',approved:false,purpose:'x',spec_hash:'sha256:a',recorded_at:'2026-10-30T10:00:00Z'},integrity_failed:[]};
  if(path.includes('/strategy?name=bonos_ar'))return {missing:true};
  return base(path,body);});
 localStorage.setItem('galecore:lab:mapa','1');
 render(<Lab onMonitor={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Argentina'}));
 expect(await screen.findByText('En diseño · 30/10/2026')).toBeInTheDocument();
 expect(screen.getByText('Idea')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Informe contexto.md'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Diseño de Evento/}));
 const view=(await screen.findByText('Seguimiento del proyecto')) as HTMLElement;
 expect(view.dataset.strategy).toBe('evento_ar');expect(view.dataset.mode).toBe('design');   // la clickeada, no la primera
 localStorage.removeItem('galecore:lab:mapa');
});
test('un proyecto sin estrategias ni informes dice cómo empezar',async()=>{
 const base=(labRequest as jest.Mock).getMockImplementation()!;
 const idea={id:'idea',label:'Idea QQQ',relative:'workspaces/idea',strategies:[]};
 (labRequest as jest.Mock).mockImplementation(async(path:string,body?:any)=>path==='/workspaces'?{...(await base(path,body)),projects:[idea]}:path.endsWith('/informes')?{informes:[]}:base(path,body));
 localStorage.setItem('galecore:lab:mapa','1');
 render(<Lab onMonitor={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Idea QQQ'}));
 expect(await screen.findByText(/Todavía no hay estrategias ni informes/)).toBeInTheDocument();
 localStorage.removeItem('galecore:lab:mapa');
});
