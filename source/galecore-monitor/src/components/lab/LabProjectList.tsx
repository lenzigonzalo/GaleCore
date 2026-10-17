import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Folder, MessageSquare, MoreHorizontal, Plus, X } from 'lucide-react';
import type { WorkspaceProject, WorkspaceState } from '../../api/lab';
import { fetchSpace, saveSpaceItem } from '../../api/space';
import './LabProjectList.css';

const STORAGE = 'galecore:lab:groups:v1';
const DRAG_TYPE = 'application/x-galecore-lab-item';
const COLORS = { neutral: ['Gris', 'var(--text-secondary)'], green: ['Verde', 'var(--green)'], blue: ['Azul', '#8ebcff'], amber: ['Ámbar', '#edc477'], rose: ['Rosa', '#eda1bb'], violet: ['Violeta', '#b9a4ed'] };
type Color = keyof typeof COLORS;
type Group = { id: string; label: string; color: Color; collapsed: boolean };
type Organization = { groups: Group[]; members: Record<string, string>; colors: Record<string, Color> };
type Chat = WorkspaceState['chats'][number];
/** La organización es del usuario (preferencia en su espacio); la copia local sólo evita el parpadeo al abrir. */
const PREFERENCE_KEY = 'chat-grupos';
function readOrganization(): Organization {
  try { return parseOrganization(JSON.parse(localStorage.getItem(STORAGE) || 'null')); } catch { return { groups: [], members: {}, colors: {} }; }
}
function parseOrganization(value: any): Organization {
  try {
    if (!value || !Array.isArray(value.groups)) throw new Error();
    const ids = new Set<string>();
    const groups = value.groups.filter((g: Group) => {
      if (!g || typeof g.id !== 'string' || !g.id || ids.has(g.id) || typeof g.label !== 'string' || !g.label.trim() || !Object.prototype.hasOwnProperty.call(COLORS, g.color)) return false;
      ids.add(g.id); return true;
    }).map((g: Group) => ({ id: g.id, label: g.label, color: g.color, collapsed: g.collapsed === true }));
    const members = Object.fromEntries(Object.entries(value.members || {}).filter(([key, id]) => /^(p|c):/.test(key) && typeof id === 'string' && ids.has(id)));
    const colors = Object.fromEntries(Object.entries(value.colors || {}).filter(([key, color]) => /^(p|c):/.test(key) && typeof color === 'string' && Object.prototype.hasOwnProperty.call(COLORS, color)));
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
  const [editor, setEditor] = useState<{ id?: string; label: string; color: Color } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const menuPanel = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const dragged = useRef<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!menu || !lastTrigger.current || !menuPanel.current) return;
    const anchor = lastTrigger.current.getBoundingClientRect();
    const panel = menuPanel.current.getBoundingClientRect();
    setMenuPosition({ left: Math.max(8, Math.min(anchor.right - panel.width, window.innerWidth - panel.width - 8)), top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - panel.height - 8)) });
  }, [menu, organization.colors]);
  useEffect(() => {
    if (menu) menuPanel.current?.querySelector<HTMLElement>('select, button')?.focus();
  }, [menu]);
  useEffect(() => {
    if (menu || editor || !lastTrigger.current) return;
    const label = lastTrigger.current.getAttribute('aria-label');
    const trigger = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button') || []).find(button => button.getAttribute('aria-label') === label);
    trigger?.focus();
  }, [menu, editor]);
  // Lo guardado en el espacio manda; hasta que llega se muestra la copia local. Sólo se escribe lo que el usuario cambió.
  const changed = useRef(false);
  useEffect(() => {
    let alive = true;
    fetchSpace().then(({ items }) => {
      const item = items.find(i => i.kind === 'preference' && i.key === PREFERENCE_KEY && i.isOwn);
      if (alive && item && !changed.current) { try { setOrganization(parseOrganization(JSON.parse(item.content))); } catch { /* preferencia ilegible: queda la local */ } }
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify(organization)); } catch { /* sólo caché */ }
    if (!changed.current) return;
    const timer = setTimeout(() => {
      saveSpaceItem('preference', PREFERENCE_KEY, { title: 'Grupos del chat', content: JSON.stringify(organization), format: 'json', visibility: 'private' })
        .then(() => setStorageError(false)).catch(() => setStorageError(true));
    }, 600);
    return () => clearTimeout(timer);
  }, [organization]);
  const organize = (update: (old: Organization) => Organization) => { changed.current = true; setOrganization(update); };
  useEffect(() => {
    const close = (event: PointerEvent) => { if (menuPanel.current && !menuPanel.current.contains(event.target as Node) && !lastTrigger.current?.contains(event.target as Node)) { lastTrigger.current = null; setMenu(null); } };
    const dismiss = (event: Event) => { if (event.target instanceof Node && menuPanel.current?.contains(event.target)) return; lastTrigger.current = null; setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { dragged.current = null; setDragging(false); setDropTarget(null); setMenu(null); setEditor(null); lastTrigger.current?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    window.addEventListener('resize', dismiss); window.addEventListener('scroll', dismiss, true);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true); };
  }, []);
  const projects = state?.projects.filter(p => !p.strategyName?.startsWith('shadow_runtime_test_')) || [];
  // WS-0044: la más reciente arriba (último turno, o creación si todavía no respondió).
  const recent = (c: { createdAt?: string; turnStartedAt?: number }) => Math.max(c.turnStartedAt || 0, Date.parse(c.createdAt || '') || 0);
  const chats = (state?.chats.filter(c => !/^test[_ -]/i.test(c.title) && projects.some(p => p.id === c.project)) || []).sort((a, b) => recent(b) - recent(a));
  const move = (key: string, group: string) => {
    organize(old => {
      const members = { ...old.members }; if (group) members[key] = group; else delete members[key];
      return { ...old, members, groups: old.groups.map(g => g.id === group ? { ...g, collapsed: false } : g) };
    }); setMenu(null); lastTrigger.current?.focus();
  };
  const dragProps = (key: string) => ({
    draggable: editing !== key.slice(2),
    onDragStart: (event: React.DragEvent) => {
      dragged.current = key; lastTrigger.current = null; setMenu(null);
      event.dataTransfer.setData(DRAG_TYPE, key); event.dataTransfer.effectAllowed = 'move'; setDragging(true);
    },
    onDragEnd: () => { dragged.current = null; setDragging(false); setDropTarget(null); },
  });
  const dropProps = (group: string): React.HTMLAttributes<HTMLElement> => ({
    onDragOver: event => {
      if (!dragged.current || !Array.from(event.dataTransfer.types).includes(DRAG_TYPE)) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropTarget(group);
    },
    onDragLeave: event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); },
    onDrop: event => {
      const key = dragged.current;
      if (!key || event.dataTransfer.getData(DRAG_TYPE) !== key) return;
      event.preventDefault(); event.stopPropagation(); move(key, group);
      dragged.current = null; setDragging(false); setDropTarget(null);
    },
  });
  const optionsButton = (key: string, label: string) => <button type="button" className="lab-icon lab-more" aria-label={'Opciones de ' + label} aria-expanded={menu === key} aria-controls={menu === key ? 'lab-group-options' : undefined} onClick={e => { lastTrigger.current = e.currentTarget; setMenu(menu === key ? null : key); setEditor(null); }}><MoreHorizontal size={17}/></button>;
  const optionsPanel = (label: string, children: React.ReactNode) => createPortal(<div ref={menuPanel} className="lab-group-options" style={menuPosition} id="lab-group-options" role="group" aria-label={label}>{children}</div>, document.body);
  const itemOptions = (key: string, label: string) => menu === key && optionsPanel('Organizar ' + label, <>
    <label>Mover a grupo<select aria-label={'Grupo de ' + label} value={organization.members[key] || ''} onChange={e => move(key, e.target.value)}><option value="">{key.startsWith('c:') ? 'Dentro de su proyecto' : 'Sin grupo'}</option>{organization.groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
    {organization.members[key] && <button type="button" onClick={() => move(key, '')}>Sacar del grupo</button>}
    <span>{key.startsWith('p:') ? 'Color de carpeta' : 'Color del chat'}</span><Palette value={organization.colors[key] || organization.groups.find(g => g.id === organization.members[key])?.color || 'neutral'} onChange={color => organize(old => ({ ...old, colors: { ...old.colors, [key]: color } }))}/>{organization.colors[key] && <button type="button" onClick={() => organize(old => { const colors = { ...old.colors }; delete colors[key]; return { ...old, colors }; })}>Usar color del grupo</button>}
  </>);
  const renderChat = (c: Chat, standalone = false, color?: Color) => {
    const p = projects.find(project => project.id === c.project)!;
    const label = name(c.id, c.title), key = 'c:' + c.id;
    const chatColor = organization.colors[key] || color;
    return <div key={key} className="lab-organized-chat" style={chatColor ? { '--group-color': COLORS[chatColor][1] } as React.CSSProperties : undefined}>
      <div className="lab-chat-row"><button className="lab-draggable" {...dragProps(key)} aria-current={chatId === c.id ? 'page' : undefined} onClick={() => onChat(p, c)} onDoubleClick={() => onRename(c.id, c.title)}><MessageSquare size={14}/>{editing === c.id ? renameInput(c.id, c.title) : <span>{label}{standalone && <small>{name(p.id, p.label)}</small>}</span>}{c.state === 'running' && <i aria-label="Respondiendo"/>}</button>{optionsButton(key, label)}</div>{itemOptions(key, label)}
    </div>;
  };
  const renderProject = (p: WorkspaceProject, groupColor?: Color) => {
    const key = 'p:' + p.id, label = name(p.id, p.label);
    const color = organization.colors[key] || groupColor;
    return <div className="lab-project-group" key={key} style={color ? { '--group-color': COLORS[color][1] } as React.CSSProperties : undefined}>
      <div className={'lab-project-row' + (projectId === p.id ? ' selected' : '')}><button className="lab-project-select lab-draggable" {...dragProps(key)} onClick={() => onProject(p)} onDoubleClick={() => onRename(p.id, p.label)}><Folder size={18} style={{ color: 'var(--group-color, currentColor)' }}/>{editing === p.id ? renameInput(p.id, p.label) : <span>{label}</span>}</button>{optionsButton(key, label)}<button className="lab-icon" aria-label={(expanded[p.id] ? 'Contraer ' : 'Expandir ') + p.label} aria-expanded={!!expanded[p.id]} onClick={() => onToggle(p.id)}>{expanded[p.id] ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</button></div>
      {itemOptions(key, label)}
      {expanded[p.id] && <div className="lab-project-chats">{chats.filter(c => c.project === p.id && !organization.members['c:' + c.id]).map(c => renderChat(c))}<button className="lab-project-new" onClick={() => onNewChat(p)}><Plus size={14}/>Nuevo chat</button></div>}
    </div>;
  };
  const saveGroup = (event: React.FormEvent) => {
    event.preventDefault(); if (!editor?.label.trim()) return;
    const id = editor.id || 'group-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    organize(old => ({ ...old, groups: editor.id ? old.groups.map(g => g.id === id ? { ...g, label: editor.label.trim(), color: editor.color } : g) : [...old.groups, { id, label: editor.label.trim(), color: editor.color, collapsed: false }] }));
    setEditor(null); lastTrigger.current?.focus();
  };
  return <div className="lab-project-list" ref={root}>
    <div className="lab-project-heading"><span>Proyectos</span><div><button className="lab-icon" aria-label="Crear grupo" title="Crear grupo" onClick={e => { lastTrigger.current = e.currentTarget; setEditor({ label: '', color: 'neutral' }); setMenu(null); }}><Folder size={17}/><Plus size={11}/></button><button className="lab-icon" aria-label="Crear proyecto" onClick={onCreateProject}><Plus size={18}/></button></div></div>
    {editor && <form className="lab-group-editor" aria-label={editor.id ? 'Editar grupo' : 'Nuevo grupo'} onSubmit={saveGroup}><header><strong>{editor.id ? 'Editar grupo' : 'Nuevo grupo'}</strong><button type="button" className="lab-icon" aria-label="Cancelar grupo" onClick={() => { setEditor(null); lastTrigger.current?.focus(); }}><X size={16}/></button></header><label>Nombre del grupo<input autoFocus required maxLength={100} value={editor.label} onChange={e => setEditor({ ...editor, label: e.target.value })}/></label><Palette value={editor.color} onChange={color => setEditor({ ...editor, color })}/><button className="lab-group-save" disabled={!editor.label.trim()}>{editor.id ? 'Guardar grupo' : 'Crear grupo'}</button></form>}
    {storageError && <p className="lab-group-empty" role="status">No se pudo guardar la organización en tu cuenta; queda en este navegador.</p>}
    <nav aria-label="Proyectos y conversaciones">
      {organization.groups.map(g => {
        const groupedProjects = projects.filter(p => organization.members['p:' + p.id] === g.id);
        const groupedChats = chats.filter(c => organization.members['c:' + c.id] === g.id);
        const count = groupedProjects.length + groupedChats.length;
        return <section className={'lab-sidebar-group' + (dropTarget === g.id ? ' lab-drop-target' : '')} {...dropProps(g.id)} key={g.id} aria-label={g.label} style={{ '--group-color': COLORS[g.color][1] } as React.CSSProperties}><div className="lab-sidebar-group-heading"><button className="lab-group-toggle" aria-label={(g.collapsed ? 'Expandir grupo ' : 'Contraer grupo ') + g.label} aria-expanded={!g.collapsed} aria-controls={'lab-group-' + g.id} onClick={() => organize(old => ({ ...old, groups: old.groups.map(group => group.id === g.id ? { ...group, collapsed: !group.collapsed } : group) }))}><i className="lab-group-dot" aria-hidden="true"/><span>{g.label}</span><small>{count}</small>{g.collapsed ? <ChevronRight size={15}/> : <ChevronDown size={15}/>}</button>{optionsButton('g:' + g.id, 'grupo ' + g.label)}</div>
          {menu === 'g:' + g.id && optionsPanel('Organizar grupo ' + g.label, <><button onClick={() => { setEditor({ id: g.id, label: g.label, color: g.color }); setMenu(null); }}>Editar nombre y color</button><button onClick={() => { organize(old => ({ ...old, groups: old.groups.filter(group => group.id !== g.id), members: Object.fromEntries(Object.entries(old.members).filter(([, id]) => id !== g.id)) })); setMenu(null); }}>Eliminar grupo (conservar contenido)</button></>)}
          <div className="lab-sidebar-group-content" hidden={g.collapsed} id={'lab-group-' + g.id}>{groupedProjects.map(p => renderProject(p, g.color))}<div className="lab-project-chats lab-group-loose-chats">{groupedChats.map(c => renderChat(c, true, g.color))}</div>{!count && <p className="lab-group-empty">Arrastrá proyectos o chats aquí.</p>}</div>
        </section>;
      })}
      <section className={'lab-ungrouped' + (dropTarget === '' ? ' lab-drop-target' : '')} aria-label="Sin grupo" {...dropProps('')}>
        {organization.groups.length > 0 && <div className="lab-ungrouped-heading">{dragging ? 'Soltá aquí para sacar del grupo' : 'Sin grupo'}</div>}
        {projects.filter(p => !organization.members['p:' + p.id]).map(p => renderProject(p))}
      </section>
    </nav>
  </div>;
}
