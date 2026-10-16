import { createPortal } from 'react-dom';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Folder, MessageSquare, Files, X, ArrowUp, Square, FileText, PanelLeftClose, PanelLeftOpen, ArrowUpRight, Mic, Paperclip, Map as MapIcon } from 'lucide-react';
import type { Tab } from '../components/layout/TabNav';
import { labRequest, WorkspaceProject, WorkspaceState, WorkspaceChat, WorkspaceFile, LabProjectKind, labUpload } from '../api/lab';
import { LabShadow } from './LabShadow';
import { LabMarkdown } from '../components/lab/LabMarkdown';
import { strategyName } from '../components/shadow/panelPresentation';
import { LabModelPicker } from '../components/lab/LabModelPicker';
import { LabProjectList } from '../components/lab/LabProjectList';
import { LabMapa } from '../components/lab/LabMapa';
import { LabSuggestions } from '../components/lab/LabSuggestions';
import './Lab.css';
const KIND = { personal: 'Personal', analysis: 'Análisis', strategy: 'Estrategia' };
const limitMapaWidth = (width: number) => Math.max(280, Math.min(width, 640));
const NARROW = '(max-width: 1100px)';
const limitSidebarWidth = (width: number, available: number) => Math.max(200, Math.min(width, 480, Math.max(200, available - 420)));
function FileTree({ nodes, selected, onSelect }: { nodes: WorkspaceFile[]; selected: string; onSelect: (path: string) => void }) {
  return <ul className="lab-file-tree">{nodes.map(n => <li key={n.path}>{n.kind === 'folder' ? <details open><summary><Folder size={16}/>{n.name}</summary><FileTree nodes={n.children || []} selected={selected} onSelect={onSelect}/></details> : <button aria-pressed={selected === n.path} onClick={() => onSelect(n.path)}><FileText size={16}/>{n.name}</button>}</li>)}</ul>;
}
export function Lab({ onMonitor, onNavigate = () => {}, sidebarHidden = false, onSidebarToggle, onLogout, embedded = false, active = false, projectRequest, onFollowStrategy }: { embedded?: boolean; active?: boolean; projectRequest?: { id: string; sequence: number }; onFollowStrategy?: (spec: string) => void; onMonitor: () => void; onNavigate?: (tab: Tab) => void; sidebarHidden?: boolean; onSidebarToggle?: () => void; onLogout?: () => void }) {
  const [projectHost, setProjectHost] = useState<HTMLElement | null>(null);
  useEffect(() => { if (embedded) setProjectHost(document.getElementById('workspace-projects')); }, [embedded]);
  // En la página del Lab el título y Mapa/Archivos van en la barra superior: una franja menos para el chat.
  const [headerHost, setHeaderHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHeaderHost(active && !embedded ? document.getElementById('workspace-header-slot') : null); }, [active, embedded]);
  const handledRequest = useRef<number | undefined>(undefined);
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
  // Mapa de la idea (WS-0039): un solo botón; al lado del chat en escritorio, alternando con el chat si no caben.
  const [mapaOpen, setMapaOpen] = useState(() => { try { return localStorage.getItem('galecore:lab:mapa') === '1'; } catch { return false; } });
  const [mapaWidth, setMapaWidth] = useState(() => { try { const v = Number(localStorage.getItem('galecore:lab:mapa-width')); return limitMapaWidth(v > 0 ? v : 380); } catch { return 380; } });
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(NARROW).matches);
  useEffect(() => { const q = window.matchMedia?.(NARROW); if (!q) return; const on = () => setNarrow(q.matches); q.addEventListener('change', on); return () => q.removeEventListener('change', on); }, []);
  useEffect(() => { try { localStorage.setItem('galecore:lab:mapa', mapaOpen ? '1' : '0'); localStorage.setItem('galecore:lab:mapa-width', String(mapaWidth)); } catch { /* vale hasta recargar */ } }, [mapaOpen, mapaWidth]);
  const chatBody = useRef<HTMLDivElement>(null);
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
  // Nombres escritos todo en minúscula («iwm prima condor 30 45d») se muestran con el mismo formato que Estrategias.
  const name = (key: string, label: string) => aliases[key] || (label === label.toLowerCase() ? strategyName(label.trim().replace(/\s+/g, '_')) : label);
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
    // Embebido, la lista de proyectos vive en la barra lateral: ajustar su ancho acá cambia el tamaño del propio
    // espacio y el observador se vuelve a disparar sin fin (colgaba el navegador al abrir el Chat).
    if (!element || embedded) return;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth > 700) setSidebarWidth(width => limitSidebarWidth(width, element.clientWidth));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [embedded]);
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
  useEffect(() => {
    if (!projectRequest || handledRequest.current === projectRequest.sequence || !state) return;
    const target = state.projects.find(item => item.id === projectRequest.id);
    if (!target) return;
    handledRequest.current = projectRequest.sequence; selectProject(target);
  }, [projectRequest, state]);
  const selectChat = (p: WorkspaceProject, c: WorkspaceState['chats'][number]) => { selection.current++; setProjectId(p.id); setChatId(c.id); setChat(null); setView('chat'); setError(''); };
  const newChat = () => { selection.current++; setChatId(null); setChat(null); setView('chat'); setError(''); };
  const createProject = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { const p = await labRequest<WorkspaceProject>('/workspaces',{ label:projectLabel,type:projectKind }); await refresh(); selectProject(p); setProjectLabel(''); setCreating(false); }
    catch(e) { setError(e instanceof Error ? e.message : 'No se pudo crear el proyecto.'); }
    finally { setBusy(false); }
  };
  // Caja de texto estilo Claude (WS-0036): adjuntos, dictado y modo de permisos por mensaje.
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [attachments, setAttachments] = useState<{ path: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [listening, setListening] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const recognition = useRef<{ stop: () => void } | null>(null);
  const Speech = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : undefined;
  useEffect(() => { setMode('manual'); setAttachments([]); }, [chatId, projectId]);
  const attach = async (files: FileList | null) => {
    if (!files?.length) return; setUploading(true); setError('');
    try { for (const file of Array.from(files)) { const up = await labUpload(projectId, file); setAttachments(list => [...list, { path: up.path, name: up.name }]); } }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo adjuntar el archivo.'); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  };
  const toggleDictation = () => {
    if (listening) { recognition.current?.stop(); return; }
    if (!Speech) return;
    const rec = new Speech(); rec.lang = 'es-AR'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (event: any) => { const said = Array.from(event.results as ArrayLike<any>).slice(event.resultIndex).filter((r: any) => r.isFinal).map((r: any) => r[0].transcript).join(' ').trim();
      if (said) setDrafts(v => ({ ...v, [draftKey]: ((v[draftKey] || '') + ' ' + said).trim() })); };
    rec.onend = () => { setListening(false); recognition.current = null; };
    rec.onerror = () => { setListening(false); recognition.current = null; };
    recognition.current = rec; rec.start(); setListening(true);
  };
  const send = (e: React.FormEvent) => { e.preventDefault(); void submit(draft, true); };
  // Lo que escribió el trader o lo que eligió en una tarjeta de opciones (WS-0039): el mismo envío.
  const submit = async (text: string, fromDraft: boolean) => {
    if(!text.trim() || busy || (chatId && !chat) || chat?.state === 'running' || !project) return; setBusy(true); setError(''); const sendingSelection = selection.current;
    try {
      const target = chat || await labRequest<WorkspaceChat>('/chats',{project:projectId,provider,...(state?.chatOptions?.[provider] ? chatSettings : {})});
      const next = await labRequest<WorkspaceChat>('/chats/' + target.id + '/messages',{text,mode,attachments:fromDraft?attachments.map(a => a.path):[]}); if(fromDraft) setAttachments([]);
      if(sendingSelection === selection.current) { followBottom.current = true; setAwayFromBottom(false); setChatId(target.id); setChat(next); } if(fromDraft) setDrafts(v=>({...v,[draftKey]:''})); setExpanded(v=>({...v,[projectId]:true})); await refresh();
    } catch(e) { setError(e instanceof Error ? e.message : 'No se pudo enviar el mensaje.'); }
    finally { setBusy(false); }
  };
  const openFile = async (path:string) => { const sequence = ++fileSequence.current; setFilePath(path); setFileText(''); setFileError(''); setFileLoading(true); try { const f = await labRequest<{text:string}>('/workspaces/' + projectId + '/files?path=' + encodeURIComponent(path)); if(sequence === fileSequence.current) setFileText(f.text); } catch(e) { if(sequence === fileSequence.current) setFileError(e instanceof Error ? e.message : 'Archivo no disponible.'); } finally { if(sequence === fileSequence.current) setFileLoading(false); } };
  const stop = async () => { if(!chat) return; try { await labRequest('/chats/' + chat.id + '/stop',{}); } catch { setError('No se pudo detener la respuesta.'); } };
  const composerForm = <form className="lab-chat-composer" onSubmit={send}>{attachments.length > 0 && <div className="lab-attachments">{attachments.map(a => <span key={a.path}><Paperclip size={13}/>{a.name}<button type="button" aria-label={'Quitar ' + a.name} onClick={() => setAttachments(list => list.filter(x => x.path !== a.path))}><X size={13}/></button></span>)}</div>}<textarea ref={composer} rows={1} maxLength={12000} disabled={busy} aria-label="Mensaje al proyecto" title="Enter para enviar · Shift + Enter para otra línea" value={draft} onChange={e=>setDrafts(v=>({...v,[draftKey]:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(draft.trim()&&!busy&&chat?.state!=='running')e.currentTarget.form?.requestSubmit();}}}/><div className="lab-composer-bar"><div className="lab-composer-side"><button type="button" className="lab-tool" aria-label="Adjuntar archivo" title="Adjuntar archivo" disabled={busy || uploading || !project} onClick={() => fileInput.current?.click()}><Plus size={18}/></button><input ref={fileInput} type="file" multiple hidden onChange={e => void attach(e.target.files)}/>{Speech && <button type="button" className={'lab-tool' + (listening ? ' active' : '')} aria-label={listening ? 'Detener dictado' : 'Dictar'} title={listening ? 'Detener dictado' : 'Dictar'} onClick={toggleDictation}><Mic size={17}/></button>}{uploading && <span className="lab-uploading" role="status">Adjuntando…</span>}</div><div className="lab-composer-side"><LabModelPicker provider={activeChoice?.provider || provider} model={chatId ? activeChoice?.model || '' : chatSettings.model} effort={chatId ? activeChoice?.effort || '' : chatSettings.effort} providers={state?.providers || []} options={state?.chatOptions} locked={!!chatId || busy} onChange={value=>{setProvider(value.provider);setChatSettings({model:value.model,effort:value.effort});}}/><button type="button" className={'lab-mode ' + mode} aria-label={'Permisos: ' + (mode === 'auto' ? 'Auto' : 'Manual')} title={mode === 'auto' ? 'Auto: edita archivos y ejecuta comandos en la carpeta del proyecto sin preguntar' : 'Manual: lo que necesita permiso se frena y te avisa'} onClick={() => setMode(m => m === 'manual' ? 'auto' : 'manual')}>{mode === 'auto' ? 'Auto' : 'Manual'}</button>{chat?.state==='running'?<button type="button" className="lab-send" aria-label="Detener respuesta" onClick={stop}><Square size={15}/></button>:<button type="submit" className="lab-send" aria-label="Enviar mensaje" disabled={!draft.trim()||busy||!state||!!(chatId&&!chat)}><ArrowUp size={19}/></button>}</div></div></form>;
  const chatHeader = <header className={"lab-chat-header" + (headerHost ? " in-global-header" : "")}><div className="lab-project-title"><strong>{project ? name(project.id, project.label) : 'Lab'}</strong>{project && KIND[project.type] !== name(project.id, project.label) && <span>{KIND[project.type]}</span>}</div><div className="lab-header-actions">{project?.strategyName && <button className="lab-header-link" title="Resultados de esta estrategia en Estrategias" onClick={() => onFollowStrategy?.(project.strategyName!)}>Ver resultados<ArrowUpRight size={15}/></button>}{view==='chat' && (narrow ? <div className="lab-mapa-switch" role="group" aria-label="Vista"><button aria-pressed={!mapaOpen} onClick={()=>setMapaOpen(false)}>Chat</button><button aria-pressed={mapaOpen} onClick={()=>setMapaOpen(true)}>Mapa</button></div> : <button className="lab-files-button" aria-pressed={mapaOpen} onClick={()=>setMapaOpen(v=>!v)}><MapIcon size={17}/>Mapa</button>)}<button className="lab-files-button" aria-expanded={filesOpen} onClick={()=>setFilesOpen(true)}><Files size={17}/>Archivos</button></div></header>;
  const projectSidebar = <aside className="lab-chat-sidebar" id="lab-project-sidebar">
      <div className="lab-sidebar-heading"><button className="lab-new-chat" onClick={newChat}><MessageSquare size={19}/><span>Nuevo chat</span></button>{!embedded && !onSidebarToggle && <button className="lab-icon" aria-label={collapsed ? 'Mostrar proyectos' : 'Ocultar proyectos'} onClick={()=>setCollapsed(v=>!v)}>{collapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button>}</div>
      {!collapsed && <LabProjectList state={state} projectId={projectId} chatId={chatId} expanded={expanded}
        onToggle={id => setExpanded(v => ({ ...v, [id]: !v[id] }))} onProject={selectProject} onChat={selectChat}
        onNewChat={p => { selectProject(p); newChat(); }} onCreateProject={() => setCreating(true)}
        name={name} onRename={startEdit} editing={editing} renameInput={renameInput}/> }
    </aside>;
  return <div ref={workspace} className={'lab-chat-workspace' + (embedded ? ' embedded' : '') + (sidebarHidden ? ' sidebar-hidden' : collapsed ? ' sidebar-collapsed' : '')} style={{ '--lab-sidebar-width': sidebarWidth + 'px' } as React.CSSProperties}>
    {embedded ? (projectHost && createPortal(projectSidebar, projectHost)) : projectSidebar}
    {!embedded && !collapsed && !sidebarHidden && <div className="lab-sidebar-resize" role="separator" tabIndex={0} aria-label="Ancho de proyectos" aria-orientation="vertical" aria-controls="lab-project-sidebar"
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
    <section className={'lab-chat-main' + (!chat?.messages.length && view === 'chat' ? ' empty' : '')}>
      {headerHost ? createPortal(chatHeader, headerHost) : chatHeader}
      {view!=='chat' ? <LabShadow key={project?.id + view} mode={view} project={project} onChat={()=>setView('chat')} onMonitor={onMonitor}/> : <div ref={chatBody} className={'lab-chat-body' + (mapaOpen ? (narrow ? ' mapa-only' : ' with-mapa') : '')} style={{ '--lab-mapa-width': mapaWidth + 'px' } as React.CSSProperties}><div className="lab-chat-column">
      <div className="lab-messages" ref={messages} onScroll={e => {
        const element = e.currentTarget;
        const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        followBottom.current = nearBottom; setAwayFromBottom(!nearBottom);
      }}>
        {!chat?.messages.length && <div className="lab-chat-welcome"><h1>{project?.type==='strategy' ? '¿Qué estrategia querés construir?' : project?.type==='personal' ? 'Tu espacio personal' : '¿Qué querés investigar?'}</h1>{project?.type==='strategy' && <p>De la idea a una estrategia lista para probar en Shadow.</p>}</div>}
        {chat?.messages.map(m=><article className={'lab-message '+m.role} key={m.id}><span>{m.role==='user'?'Vos':chat.provider==='codex'?'Codex':'Claude'}</span>{m.role==='assistant' ? <LabMarkdown text={m.text} active={m.id===chat.messages[chat.messages.length-1]?.id && chat.state!=='running' && !busy} onAnswer={text=>void submit(text,false)}/> : <div>{m.text}</div>}</article>)}
        {chat?.state==='running' && <div className="lab-chat-activity" role="status"><i/>{chat.activity || 'Pensando' }…</div>}
        {(error || chat?.error) && <div className="lab-chat-error" role="alert">{error || chat?.error}<button onClick={refresh}>Reintentar conexión</button></div>}
      </div>
      {awayFromBottom && <button type="button" className="lab-jump-latest" onClick={jumpToLatest}>Ir al último mensaje</button>}
      {composerForm}
      {!chat?.messages.length && !busy && <LabSuggestions disabled={chat?.state==='running'} onPick={question => void submit(question, false)}/>}
      </div>
      {mapaOpen && !narrow && <div className="lab-sidebar-resize lab-mapa-resize" role="separator" tabIndex={0} aria-label="Ancho del mapa" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={640} aria-valuenow={mapaWidth}
        title="Arrastrá para ajustar · flechas para cambiar ancho · doble clic para restablecer"
        onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setMapaWidth(limitMapaWidth((chatBody.current?.getBoundingClientRect().right || 0) - e.clientX)); }}
        onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onDoubleClick={() => setMapaWidth(380)}
        onKeyDown={e => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); setMapaWidth(w => limitMapaWidth(w + (e.key === 'ArrowLeft' ? 1 : -1) * (e.shiftKey ? 40 : 10))); }}/>}
      {mapaOpen && <LabMapa chatId={chatId} running={chat?.state === 'running'}/>}
      </div>}
    </section>
    {creating && <div className="lab-modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="lab-create-title" className="lab-create-project"><header><h2 id="lab-create-title">Nuevo proyecto</h2><button className="lab-icon" aria-label="Cerrar" onClick={()=>setCreating(false)}><X size={19}/></button></header><form onSubmit={createProject}><label>Nombre<input autoFocus required maxLength={100} value={projectLabel} onChange={e=>setProjectLabel(e.target.value)} placeholder="Estrategia SPY"/></label><label>Tipo<select value={projectKind} onChange={e=>setProjectKind(e.target.value as LabProjectKind)}><option value="strategy">Estrategia</option><option value="analysis">Análisis</option><option value="personal">Personal</option></select></label><p>{projectKind==='strategy'?'El chat guía investigación, diseño y preparación para Shadow.':'Archivos, memoria y convenciones propias.'}</p>{error && <p role="alert">{error}</p>}<button className="btn" disabled={busy||!projectLabel.trim()}>Crear proyecto</button></form></section></div>}
    {filesOpen && <div className="lab-modal-backdrop"><section className="lab-explorer" role="dialog" aria-modal="true" aria-labelledby="lab-files-title"><header><div><h2 id="lab-files-title">Archivos</h2><span>{project?.label}</span></div><button autoFocus className="lab-icon" aria-label="Cerrar archivos" onClick={()=>setFilesOpen(false)}><X size={20}/></button></header><div className="lab-explorer-body"><aside><FileTree nodes={tree} selected={filePath} onSelect={openFile}/>{!tree.length && <p>Sin archivos disponibles.</p>}</aside><div className="lab-file-preview">{fileError?<p role="alert">{fileError}</p>:filePath?<><h3>{filePath}</h3><pre>{fileLoading ? 'Leyendo…' : fileText || 'Archivo vacío'}</pre></>:<div className="lab-explorer-empty"><Folder size={30}/><p>Elegí un archivo para verlo.</p><span>{project?.relative}</span></div>}</div></div></section></div>}
  </div>;
}
