import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Folder, MessageSquare, Files, X, ArrowUp, Square, ChevronRight, ChevronDown, FileText, FlaskConical, BookOpen, Settings, PanelLeftClose, PanelLeftOpen, Pencil, LogOut } from 'lucide-react';
import type { Tab } from '../components/layout/TabNav';
import { labRequest, WorkspaceProject, WorkspaceState, WorkspaceChat, WorkspaceFile, LabProjectKind } from '../api/lab';
import { LabShadow } from './LabShadow';
import { LabMarkdown } from '../components/lab/LabMarkdown';
import { LabModelPicker } from '../components/lab/LabModelPicker';
import './Lab.css';
const KIND = { personal: 'Personal', analysis: 'Análisis', strategy: 'Estrategia' };
const limitSidebarWidth = (width: number, available: number) => Math.max(200, Math.min(width, 480, Math.max(200, available - 420)));
function FileTree({ nodes, selected, onSelect }: { nodes: WorkspaceFile[]; selected: string; onSelect: (path: string) => void }) {
  return <ul className="lab-file-tree">{nodes.map(n => <li key={n.path}>{n.kind === 'folder' ? <details open><summary><Folder size={16}/>{n.name}</summary><FileTree nodes={n.children || []} selected={selected} onSelect={onSelect}/></details> : <button aria-pressed={selected === n.path} onClick={() => onSelect(n.path)}><FileText size={16}/>{n.name}</button>}</li>)}</ul>;
}
export function Lab({ onMonitor, onNavigate = () => {}, sidebarHidden = false, onSidebarToggle, onLogout }: { onMonitor: () => void; onNavigate?: (tab: Tab) => void; sidebarHidden?: boolean; onSidebarToggle?: () => void; onLogout?: () => void }) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [projectId, setProjectId] = useState(() => sessionStorage.getItem('galecore:lab:project') || 'personal');
  const [chatId, setChatId] = useState<string | null>(() => sessionStorage.getItem('galecore:lab:chat'));
  const [chat, setChat] = useState<WorkspaceChat | null>(null);
  const [provider, setProvider] = useState<'codex' | 'claude'>('codex');
  const [chatSettings, setChatSettings] = useState({ model: '', effort: '' });
  const [view, setView] = useState<'chat' | 'design' | 'shadow'>('chat');
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem('galecore:lab:sidebar-width'));
      return limitSidebarWidth(stored >= 200 && Number.isFinite(stored) ? stored : 310, window.innerWidth);
    } catch { return 310; }
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string,string>>({});
  const [busy, setBusy] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [projectLabel, setProjectLabel] = useState('');
  const [projectKind, setProjectKind] = useState<LabProjectKind>('analysis');
  const [filesOpen, setFilesOpen] = useState(false);
  const [tree, setTree] = useState<WorkspaceFile[]>([]);
  const [filePath, setFilePath] = useState('');
  const [fileText, setFileText] = useState('');
  const [fileError, setFileError] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [aliases, setAliases] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem('galecore:lab:aliases') || '{}'); } catch { return {}; } });
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const name = (key: string, label: string) => aliases[key] || label;
  const startEdit = (key: string, label: string) => { setEditing(key); setEditValue(name(key, label)); };
  const saveEdit = (key: string, original: string) => {
    const value = editValue.trim(); const next = { ...aliases };
    if (value && value !== original) next[key] = value; else delete next[key];
    setAliases(next); setEditing(null);
    try { localStorage.setItem('galecore:lab:aliases', JSON.stringify(next)); } catch { /* sin storage: el nombre vale hasta recargar */ }
  };
  const renameInput = (key: string, original: string) => <input className="lab-rename" autoFocus aria-label="Nuevo nombre" value={editValue} onChange={e => setEditValue(e.target.value)}
    onBlur={() => saveEdit(key, original)} onKeyDown={e => { if (e.key === 'Enter') saveEdit(key, original); if (e.key === 'Escape') setEditing(null); }} onClick={e => e.stopPropagation()} />;
  const selection = useRef(0);
  const workspace = useRef<HTMLDivElement>(null);
  const fileSequence = useRef(0);
  const messages = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const followBottom = useRef(true);
  const project = state?.projects.find(p => p.id === projectId);
  const activeChoice = chat || state?.chats.find(c => c.id === chatId);
  const draftKey = projectId + '/' + (chatId || 'new');
  const draft = drafts[draftKey] || '';
  const refresh = useCallback(async () => {
    try { setState(await labRequest<WorkspaceState>('/workspaces')); setError(''); }
    catch { setError('No se pudo conectar con el Lab local.'); }
  }, []);
  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 4000); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth > 700) setSidebarWidth(width => limitSidebarWidth(width, element.clientWidth));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try { localStorage.setItem('galecore:lab:sidebar-width', String(sidebarWidth)); } catch { /* disponible hasta recargar */ }
  }, [sidebarWidth]);
  const resizeSidebar = (width: number) => setSidebarWidth(limitSidebarWidth(width, workspace.current?.clientWidth || window.innerWidth));
  useEffect(() => { const ok = state?.providers.find(x => x.installed); if (ok && !state?.providers.find(x => x.id === provider)?.installed) { setProvider(ok.id); setChatSettings({model:'',effort:''}); } }, [state, provider]);
  useEffect(() => { sessionStorage.setItem('galecore:lab:project', projectId); }, [projectId]);
  useEffect(() => { if(chatId) sessionStorage.setItem('galecore:lab:chat',chatId); else sessionStorage.removeItem('galecore:lab:chat'); },[chatId]);
  useEffect(() => {
    if(!chatId) { setChat(null); return; }
    let active = true;
    const poll = async () => { try { const c = await labRequest<WorkspaceChat>('/chats/' + chatId); if(active) setChat(c); } catch { if(active) setError('No se pudo recuperar esta conversación.'); } };
    poll(); const timer = window.setInterval(poll, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [chatId]);
  useEffect(() => { followBottom.current = true; setAwayFromBottom(false); }, [projectId, chatId]);
  useEffect(() => {
    const element = messages.current;
    if (element && followBottom.current) element.scrollTop = element.scrollHeight;
  }, [chat, view]);
  useEffect(() => {
    const element = composer.current;
    if (!element) return;
    const fit = () => {
      element.style.height = 'auto';
      element.style.height = Math.min(element.scrollHeight, 168) + 'px';
    };
    fit();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth; fit();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [draft, view]);
  const jumpToLatest = () => {
    followBottom.current = true; setAwayFromBottom(false);
    if (messages.current) messages.current.scrollTop = messages.current.scrollHeight;
  };
  useEffect(() => {
    if(!filesOpen) return;
    const sequenceRef = fileSequence; let active = true; setTree([]); setFileText(''); setFilePath(''); setFileError(''); fileSequence.current++;
    labRequest<{tree:WorkspaceFile[]}>('/workspaces/' + projectId + '/files').then(v => { if(active) setTree(v.tree); }).catch(() => { if(active) setFileError('No se pudieron leer los archivos.'); });
    return () => { active = false; sequenceRef.current++; };
  }, [projectId, filesOpen]);
  useEffect(() => { const close = (e: KeyboardEvent) => { if(e.key === 'Escape') { setFilesOpen(false); setCreating(false); } }; window.addEventListener('keydown',close); return () => window.removeEventListener('keydown',close); }, []);

  useEffect(() => {
    if(!creating && !filesOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const trap = (e: KeyboardEvent) => {
      if(e.key !== 'Tab') return;
      const dialog = document.querySelector('[role="dialog"]');
      const elements = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') || []);
      const first = elements[0], last = elements[elements.length - 1];
      if(!first) return;
      if(e.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown',trap);
    return () => { window.removeEventListener('keydown',trap); previous?.focus(); };
  },[creating,filesOpen]);
  const selectProject = (p: WorkspaceProject) => { selection.current++; setProjectId(p.id); setChatId(null); setChat(null); setView('chat'); setExpanded(v=>({...v,[p.id]:true})); setError(''); };
  const selectChat = (p: WorkspaceProject, c: WorkspaceState['chats'][number]) => { selection.current++; setProjectId(p.id); setChatId(c.id); setChat(null); setView('chat'); setError(''); };
  const newChat = () => { selection.current++; setChatId(null); setChat(null); setView('chat'); setError(''); };
  const createProject = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { const p = await labRequest<WorkspaceProject>('/workspaces',{ label:projectLabel,type:projectKind }); await refresh(); selectProject(p); setProjectLabel(''); setCreating(false); }
    catch(e) { setError(e instanceof Error ? e.message : 'No se pudo crear el proyecto.'); }
    finally { setBusy(false); }
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); if(!draft.trim() || busy || (chatId && !chat) || chat?.state === 'running' || !project) return; setBusy(true); setError(''); const sendingSelection = selection.current;
    try {
      const target = chat || await labRequest<WorkspaceChat>('/chats',{project:projectId,provider,...(state?.chatOptions?.[provider] ? chatSettings : {})});
      const next = await labRequest<WorkspaceChat>('/chats/' + target.id + '/messages',{text:draft});
      if(sendingSelection === selection.current) { followBottom.current = true; setAwayFromBottom(false); setChatId(target.id); setChat(next); } setDrafts(v=>({...v,[draftKey]:''})); setExpanded(v=>({...v,[projectId]:true})); await refresh();
    } catch(e) { setError(e instanceof Error ? e.message : 'No se pudo enviar el mensaje.'); }
    finally { setBusy(false); }
  };
  const openFile = async (path:string) => { const sequence = ++fileSequence.current; setFilePath(path); setFileText(''); setFileError(''); setFileLoading(true); try { const f = await labRequest<{text:string}>('/workspaces/' + projectId + '/files?path=' + encodeURIComponent(path)); if(sequence === fileSequence.current) setFileText(f.text); } catch(e) { if(sequence === fileSequence.current) setFileError(e instanceof Error ? e.message : 'Archivo no disponible.'); } finally { if(sequence === fileSequence.current) setFileLoading(false); } };
  const stop = async () => { if(!chat) return; try { await labRequest('/chats/' + chat.id + '/stop',{}); } catch { setError('No se pudo detener la respuesta.'); } };
  return <div ref={workspace} className={'lab-chat-workspace' + (sidebarHidden ? ' sidebar-hidden' : collapsed ? ' sidebar-collapsed' : '')} style={{ '--lab-sidebar-width': sidebarWidth + 'px' } as React.CSSProperties}>
    <aside className="lab-chat-sidebar" id="lab-project-sidebar">
      <div className="lab-sidebar-heading"><button className="lab-new-chat" onClick={newChat}><MessageSquare size={19}/><span>Nuevo chat</span></button>{!onSidebarToggle && <button className="lab-icon" aria-label={collapsed ? 'Mostrar proyectos' : 'Ocultar proyectos'} onClick={()=>setCollapsed(v=>!v)}>{collapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button>}</div>
      {!collapsed && <><div className="lab-project-heading"><span>Proyectos</span><button className="lab-icon" aria-label="Crear proyecto" onClick={()=>setCreating(true)}><Plus size={18}/></button></div>
      <nav aria-label="Proyectos y conversaciones">{state?.projects.map(p => <div className="lab-project-group" key={p.id}>
        <div className={'lab-project-row' + (projectId === p.id ? ' selected' : '')}><button className="lab-project-select" onClick={()=>selectProject(p)} onDoubleClick={()=>startEdit(p.id,p.label)}><Folder size={18}/>{editing===p.id ? renameInput(p.id,p.label) : <span>{name(p.id,p.label)}</span>}</button><button className="lab-icon lab-pencil" aria-label={'Renombrar ' + name(p.id,p.label)} onClick={()=>startEdit(p.id,p.label)}><Pencil size={14}/></button><button className="lab-icon" aria-label={(expanded[p.id] ? 'Contraer ' : 'Expandir ') + p.label} aria-expanded={!!expanded[p.id]} onClick={()=>setExpanded(v=>({...v,[p.id]:!v[p.id]}))}>{expanded[p.id] ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</button></div>
        {expanded[p.id] && <div className="lab-project-chats">{state.chats.filter(c=>c.project===p.id).slice().reverse().map(c=><div className="lab-chat-row" key={c.id}><button aria-current={chatId===c.id ? 'page' : undefined} onClick={()=>selectChat(p,c)} onDoubleClick={()=>startEdit(c.id,c.title)}><MessageSquare size={14}/>{editing===c.id ? renameInput(c.id,c.title) : <span>{name(c.id,c.title)}</span>}{c.state==='running' && <i aria-label="Respondiendo"/>}</button><button className="lab-icon lab-pencil" aria-label={'Renombrar ' + name(c.id,c.title)} onClick={()=>startEdit(c.id,c.title)}><Pencil size={13}/></button></div>)}<button className="lab-project-new" onClick={()=>{selectProject(p);newChat();}}><Plus size={14}/>Nuevo chat</button></div>}
      </div>)}</nav>
      <footer className="lab-sidebar-footer"><button onClick={()=>onNavigate('inteligencia')}><BookOpen size={17}/>Biblioteca</button><button onClick={()=>onNavigate('config')}><Settings size={17}/>Configuración</button>{onLogout && <button onClick={onLogout}><LogOut size={17}/>Salir</button>}<span><i className={state && !error ? 'online' : ''}/>{state ? 'En tu equipo' : 'Conectando…'}</span></footer></>}
    </aside>
    {!collapsed && !sidebarHidden && <div className="lab-sidebar-resize" role="separator" tabIndex={0} aria-label="Ancho de proyectos" aria-orientation="vertical" aria-controls="lab-project-sidebar"
      aria-valuemin={200} aria-valuemax={limitSidebarWidth(480, workspace.current?.clientWidth || window.innerWidth)} aria-valuenow={sidebarWidth}
      title="Arrastrá para ajustar · flechas para cambiar ancho · doble clic para restablecer"
      onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) resizeSidebar(e.clientX - (workspace.current?.getBoundingClientRect().left || 0)); }}
      onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onDoubleClick={() => resizeSidebar(310)}
      onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        resizeSidebar(e.key === 'Home' ? 200 : e.key === 'End' ? 480 : sidebarWidth + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 40 : 10));
      }}/>}
    <section className="lab-chat-main">
      <header className="lab-chat-header"><div className="lab-project-title"><strong>{project ? name(project.id, project.label) : 'Lab'}</strong>{project && <span>{KIND[project.type]}</span>}</div><LabModelPicker provider={activeChoice?.provider || provider} model={chatId ? activeChoice?.model || '' : chatSettings.model} effort={chatId ? activeChoice?.effort || '' : chatSettings.effort} providers={state?.providers || []} options={state?.chatOptions} locked={!!chatId || busy} onChange={value=>{setProvider(value.provider);setChatSettings({model:value.model,effort:value.effort});}}/><div className="lab-header-actions"><nav aria-label="Vistas del proyecto"><button aria-current={view==='chat'?'page':undefined} onClick={()=>setView('chat')}>Chat</button>{project?.type==='strategy'&&<button aria-current={view==='design'?'page':undefined} onClick={()=>setView('design')}>Diseño</button>}<button aria-current={view==='shadow'?'page':undefined} onClick={()=>setView('shadow')}><FlaskConical size={15}/>Shadow</button></nav><button className="lab-files-button" aria-expanded={filesOpen} onClick={()=>setFilesOpen(true)}><Files size={17}/>Files</button></div></header>
      {view!=='chat' ? <LabShadow key={project?.id + view} mode={view} project={project} onChat={()=>setView('chat')} onMonitor={onMonitor}/> : <>
      <div className="lab-messages" ref={messages} onScroll={e => {
        const element = e.currentTarget;
        const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        followBottom.current = nearBottom; setAwayFromBottom(!nearBottom);
      }}>
        {!chat?.messages.length && <div className="lab-chat-welcome"><h1>{project?.type==='strategy' ? '¿Qué estrategia querés construir?' : project?.type==='personal' ? 'Tu espacio personal' : '¿Qué querés investigar?'}</h1>{project?.type==='strategy' && <p>De la idea a una estrategia lista para probar en Shadow.</p>}</div>}
        {chat?.messages.map(m=><article className={'lab-message '+m.role} key={m.id}><span>{m.role==='user'?'Vos':chat.provider==='codex'?'Codex':'Claude'}</span>{m.role==='assistant' ? <LabMarkdown text={m.text}/> : <div>{m.text}</div>}</article>)}
        {chat?.state==='running' && <div className="lab-chat-activity" role="status"><i/>{chat.activity || 'Pensando' }…</div>}
        {(error || chat?.error) && <div className="lab-chat-error" role="alert">{error || chat?.error}<button onClick={refresh}>Reintentar conexión</button></div>}
      </div>
      {awayFromBottom && <button type="button" className="lab-jump-latest" onClick={jumpToLatest}>Ir al último mensaje</button>}
      <form className="lab-chat-composer" onSubmit={send}><textarea ref={composer} rows={1} maxLength={12000} disabled={busy} aria-label="Mensaje al proyecto" aria-describedby="lab-composer-hint" title="Enter para enviar · Shift + Enter para otra línea" value={draft} onChange={e=>setDrafts(v=>({...v,[draftKey]:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(draft.trim()&&!busy&&chat?.state!=='running')e.currentTarget.form?.requestSubmit();}}}/><div className="lab-composer-toolbar">{chat?.state==='running'?<button type="button" className="lab-send" aria-label="Detener respuesta" onClick={stop}><Square size={15}/></button>:<button type="submit" className="lab-send" aria-label="Enviar mensaje" disabled={!draft.trim()||busy||!state||!!(chatId&&!chat)}><ArrowUp size={19}/></button>}</div><small id="lab-composer-hint" className="lab-composer-hint">Enter para enviar · Shift + Enter para otra línea</small></form>
      </>}
    </section>
    {creating && <div className="lab-modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="lab-create-title" className="lab-create-project"><header><h2 id="lab-create-title">Nuevo proyecto</h2><button className="lab-icon" aria-label="Cerrar" onClick={()=>setCreating(false)}><X size={19}/></button></header><form onSubmit={createProject}><label>Nombre<input autoFocus required maxLength={100} value={projectLabel} onChange={e=>setProjectLabel(e.target.value)} placeholder="Estrategia SPY"/></label><label>Tipo<select value={projectKind} onChange={e=>setProjectKind(e.target.value as LabProjectKind)}><option value="strategy">Estrategia</option><option value="analysis">Análisis</option><option value="personal">Personal</option></select></label><p>{projectKind==='strategy'?'El chat guía investigación, diseño y preparación para Shadow.':'Archivos, memoria y convenciones propias.'}</p>{error && <p role="alert">{error}</p>}<button className="btn" disabled={busy||!projectLabel.trim()}>Crear proyecto</button></form></section></div>}
    {filesOpen && <div className="lab-modal-backdrop"><section className="lab-explorer" role="dialog" aria-modal="true" aria-labelledby="lab-files-title"><header><div><h2 id="lab-files-title">Files</h2><span>{project?.label}</span></div><button autoFocus className="lab-icon" aria-label="Cerrar Files" onClick={()=>setFilesOpen(false)}><X size={20}/></button></header><div className="lab-explorer-body"><aside><FileTree nodes={tree} selected={filePath} onSelect={openFile}/>{!tree.length && <p>Sin archivos disponibles.</p>}</aside><div className="lab-file-preview">{fileError?<p role="alert">{fileError}</p>:filePath?<><h3>{filePath}</h3><pre>{fileLoading ? 'Leyendo…' : fileText || 'Archivo vacío'}</pre></>:<div className="lab-explorer-empty"><Folder size={30}/><p>Elegí un archivo para verlo.</p><span>{project?.relative}</span></div>}</div></div></section></div>}
  </div>;
}
