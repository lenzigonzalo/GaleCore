import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, MessageSquare, MoreHorizontal, Plus, X } from 'lucide-react';
import type { WorkspaceProject, WorkspaceState } from '../../api/lab';
import './LabProjectList.css';

const STORAGE = 'galecore:lab:groups:v1';
const COLORS = { neutral: ['Gris', 'var(--text-secondary)'], green: ['Verde', 'var(--green)'], blue: ['Azul', '#8ebcff'], amber: ['Ámbar', '#edc477'], rose: ['Rosa', '#eda1bb'], violet: ['Violeta', '#b9a4ed'] };
type Color = keyof typeof COLORS;
type Group = { id: string; label: string; color: Color; collapsed: boolean };
type Organization = { groups: Group[]; members: Record<string, string>; colors: Record<string, Color> };
type Chat = WorkspaceState['chats'][number];
function readOrganization(): Organization {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    if (!value || !Array.isArray(value.groups)) throw new Error();
    const ids = new Set<string>();
    const groups = value.groups.filter((g: Group) => {
      if (!g || typeof g.id !== 'string' || !g.id || ids.has(g.id) || typeof g.label !== 'string' || !g.label.trim() || !Object.prototype.hasOwnProperty.call(COLORS, g.color)) return false;
      ids.add(g.id); return true;
    }).map((g: Group) => ({ id: g.id, label: g.label, color: g.color, collapsed: g.collapsed === true }));
    const members = Object.fromEntries(Object.entries(value.members || {}).filter(([key, id]) => /^(p|c):/.test(key) && typeof id === 'string' && ids.has(id)));
    const colors = Object.fromEntries(Object.entries(value.colors || {}).filter(([key, color]) => key.startsWith('p:') && typeof color === 'string' && Object.prototype.hasOwnProperty.call(COLORS, color)));
    return { groups, members, colors } as Organization;
  } catch { return { groups: [], members: {}, colors: {} }; }
}
function Palette({ value, onChange }: { value: Color; onChange: (color: Color) => void }) {
  return <div className="lab-group-palette" role="group" aria-label="Paleta de colores">{(Object.keys(COLORS) as Color[]).map(color => <button type="button" key={color} aria-label={COLORS[color][0]} title={COLORS[color][0]} aria-pressed={value === color} style={{ '--group-color': COLORS[color][1] } as React.CSSProperties} onClick={() => onChange(color)}><span/>{value === color && <b aria-hidden="true">✓</b>}</button>)}</div>;
}
interface Props {
  state: WorkspaceState | null;
  projectId: string;
  chatId: string | null;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onProject: (project: WorkspaceProject) => void;
  onChat: (project: WorkspaceProject, chat: Chat) => void;
  onNewChat: (project: WorkspaceProject) => void;
  onCreateProject: () => void;
  name: (id: string, label: string) => string;
  onRename: (id: string, label: string) => void;
  editing: string | null;
  renameInput: (id: string, label: string) => React.ReactNode;
}
export function LabProjectList(props: Props) {
  const { state, projectId, chatId, expanded, onToggle, onProject, onChat, onNewChat, onCreateProject, name, onRename, editing, renameInput } = props;
  const [organization, setOrganization] = useState(readOrganization);
  const [storageError, setStorageError] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ id?: string; label: string; color: Color; member?: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (menu || editor || !lastTrigger.current) return;
    const label = lastTrigger.current.getAttribute('aria-label');
    const trigger = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button') || []).find(button => button.getAttribute('aria-label') === label);
    trigger?.focus();
  }, [menu, editor]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify(organization)); setStorageError(false); }
    catch { setStorageError(true); }
  }, [organization]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { lastTrigger.current = null; setMenu(null); } };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(null); setEditor(null); lastTrigger.current?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);
  const projects = state?.projects.filter(p => !p.strategyName?.startsWith('shadow_runtime_test_')) || [];
  const chats = state?.chats.filter(c => !/^test[_ -]/i.test(c.title) && projects.some(p => p.id === c.project)) || [];
  const move = (key: string, group: string) => {
    setOrganization(old => {
      const members = { ...old.members }; if (group) members[key] = group; else delete members[key];
      return { ...old, members, groups: old.groups.map(g => g.id === group ? { ...g, collapsed: false } : g) };
    }); setMenu(null); lastTrigger.current?.focus();
  };
  const optionsButton = (key: string, label: string) => <button type="button" className="lab-icon lab-more" aria-label={'Opciones de ' + label} aria-expanded={menu === key} aria-controls={menu === key ? 'lab-group-options' : undefined} onClick={e => { lastTrigger.current = e.currentTarget; setMenu(menu === key ? null : key); setEditor(null); }}><MoreHorizontal size={17}/></button>;
  const itemOptions = (key: string, label: string, original: string) => menu === key && <div className="lab-group-options" id="lab-group-options" role="group" aria-label={'Organizar ' + label}>
    <button type="button" onClick={() => { onRename(key.slice(2), original); setMenu(null); }}>Renombrar</button>
    <label>Mover a grupo<select aria-label={'Grupo de ' + label} value={organization.members[key] || ''} onChange={e => move(key, e.target.value)}><option value="">{key.startsWith('c:') ? 'Dentro de su proyecto' : 'Sin grupo'}</option>{organization.groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
    {organization.members[key] && <button type="button" onClick={() => move(key, '')}>Sacar del grupo</button>}
    <button type="button" onClick={() => { setEditor({ label: '', color: 'neutral', member: key }); setMenu(null); }}>Crear grupo…</button>
    {key.startsWith('p:') && <><span>Color de carpeta</span><Palette value={organization.colors[key] || organization.groups.find(g => g.id === organization.members[key])?.color || 'neutral'} onChange={color => setOrganization(old => ({ ...old, colors: { ...old.colors, [key]: color } }))}/>{organization.colors[key] && <button type="button" onClick={() => setOrganization(old => { const colors = { ...old.colors }; delete colors[key]; return { ...old, colors }; })}>Usar color del grupo</button>}</>}
  </div>;
  const renderChat = (c: Chat, standalone = false, color?: Color) => {
    const p = projects.find(project => project.id === c.project)!;
    const label = name(c.id, c.title), key = 'c:' + c.id;
    return <div key={key} className="lab-organized-chat" style={color ? { '--group-color': COLORS[color][1] } as React.CSSProperties : undefined}>
      <div className="lab-chat-row"><button aria-current={chatId === c.id ? 'page' : undefined} onClick={() => onChat(p, c)} onDoubleClick={() => onRename(c.id, c.title)}><MessageSquare size={14}/>{editing === c.id ? renameInput(c.id, c.title) : <span>{label}{standalone && <small>{name(p.id, p.label)}</small>}</span>}{c.state === 'running' && <i aria-label="Respondiendo"/>}</button>{optionsButton(key, label)}</div>{itemOptions(key, label, c.title)}
    </div>;
  };
  const renderProject = (p: WorkspaceProject, groupColor?: Color) => {
    const key = 'p:' + p.id, label = name(p.id, p.label);
    const color = organization.colors[key] || groupColor;
    return <div className="lab-project-group" key={key} style={color ? { '--group-color': COLORS[color][1] } as React.CSSProperties : undefined}>
      <div className={'lab-project-row' + (projectId === p.id ? ' selected' : '')}><button className="lab-project-select" onClick={() => onProject(p)} onDoubleClick={() => onRename(p.id, p.label)}><Folder size={18} style={{ color: 'var(--group-color, currentColor)' }}/>{editing === p.id ? renameInput(p.id, p.label) : <span>{label}</span>}</button>{optionsButton(key, label)}<button className="lab-icon" aria-label={(expanded[p.id] ? 'Contraer ' : 'Expandir ') + p.label} aria-expanded={!!expanded[p.id]} onClick={() => onToggle(p.id)}>{expanded[p.id] ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</button></div>
      {itemOptions(key, label, p.label)}
      {expanded[p.id] && <div className="lab-project-chats">{chats.filter(c => c.project === p.id && !organization.members['c:' + c.id]).slice().reverse().map(c => renderChat(c))}<button className="lab-project-new" onClick={() => onNewChat(p)}><Plus size={14}/>Nuevo chat</button></div>}
    </div>;
  };
  const saveGroup = (event: React.FormEvent) => {
    event.preventDefault(); if (!editor?.label.trim()) return;
    const id = editor.id || 'group-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    setOrganization(old => ({ ...old, groups: editor.id ? old.groups.map(g => g.id === id ? { ...g, label: editor.label.trim(), color: editor.color } : g) : [...old.groups, { id, label: editor.label.trim(), color: editor.color, collapsed: false }], members: editor.member ? { ...old.members, [editor.member]: id } : old.members }));
    setEditor(null); lastTrigger.current?.focus();
  };
  return <div className="lab-project-list" ref={root}>
    <div className="lab-project-heading"><span>Proyectos</span><div><button className="lab-icon" aria-label="Crear grupo" title="Crear grupo" onClick={e => { lastTrigger.current = e.currentTarget; setEditor({ label: '', color: 'neutral' }); setMenu(null); }}><Folder size={17}/><Plus size={11}/></button><button className="lab-icon" aria-label="Crear proyecto" onClick={onCreateProject}><Plus size={18}/></button></div></div>
    {editor && <form className="lab-group-editor" aria-label={editor.id ? 'Editar grupo' : 'Nuevo grupo'} onSubmit={saveGroup}><header><strong>{editor.id ? 'Editar grupo' : 'Nuevo grupo'}</strong><button type="button" className="lab-icon" aria-label="Cancelar grupo" onClick={() => { setEditor(null); lastTrigger.current?.focus(); }}><X size={16}/></button></header><label>Nombre del grupo<input autoFocus required maxLength={100} value={editor.label} onChange={e => setEditor({ ...editor, label: e.target.value })}/></label><Palette value={editor.color} onChange={color => setEditor({ ...editor, color })}/><button className="lab-group-save" disabled={!editor.label.trim()}>{editor.id ? 'Guardar grupo' : 'Crear grupo'}</button></form>}
    {storageError && <p className="lab-group-empty" role="status">No se pudo guardar la organización; se conservará hasta recargar.</p>}
    <nav aria-label="Proyectos y conversaciones">
      {organization.groups.map(g => {
        const groupedProjects = projects.filter(p => organization.members['p:' + p.id] === g.id);
        const groupedChats = chats.filter(c => organization.members['c:' + c.id] === g.id);
        const count = groupedProjects.length + groupedChats.length;
        return <section className="lab-sidebar-group" key={g.id} aria-label={g.label} style={{ '--group-color': COLORS[g.color][1] } as React.CSSProperties}><div className="lab-sidebar-group-heading"><button className="lab-group-toggle" aria-label={(g.collapsed ? 'Expandir grupo ' : 'Contraer grupo ') + g.label} aria-expanded={!g.collapsed} aria-controls={'lab-group-' + g.id} onClick={() => setOrganization(old => ({ ...old, groups: old.groups.map(group => group.id === g.id ? { ...group, collapsed: !group.collapsed } : group) }))}>{g.collapsed ? <ChevronRight size={15}/> : <ChevronDown size={15}/>}<span>{g.label}</span><small>{count}</small></button>{optionsButton('g:' + g.id, 'grupo ' + g.label)}</div>
          {menu === 'g:' + g.id && <div className="lab-group-options" id="lab-group-options" role="group" aria-label={'Organizar grupo ' + g.label}><button onClick={() => { setEditor({ id: g.id, label: g.label, color: g.color }); setMenu(null); }}>Editar nombre y color</button><button onClick={() => { setOrganization(old => ({ ...old, groups: old.groups.filter(group => group.id !== g.id), members: Object.fromEntries(Object.entries(old.members).filter(([, id]) => id !== g.id)) })); setMenu(null); }}>Eliminar grupo (conservar contenido)</button></div>}
          <div className="lab-sidebar-group-content" hidden={g.collapsed} id={'lab-group-' + g.id}>{groupedProjects.map(p => renderProject(p, g.color))}<div className="lab-project-chats lab-group-loose-chats">{groupedChats.slice().reverse().map(c => renderChat(c, true, g.color))}</div>{!count && <p className="lab-group-empty">Agregá proyectos o chats desde sus tres puntos.</p>}</div>
        </section>;
      })}
      {organization.groups.length > 0 && <div className="lab-ungrouped-heading">Sin grupo</div>}
      {projects.filter(p => !organization.members['p:' + p.id]).map(p => renderProject(p))}
    </nav>
  </div>;
}
