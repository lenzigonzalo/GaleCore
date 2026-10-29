import { createPortal } from 'react-dom';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, MessageSquare, Files, X, ArrowUp, Square, PanelLeftClose, PanelLeftOpen, Mic, Paperclip, Map as MapIcon, SquareTerminal, Users, Pencil } from 'lucide-react';
import type { Tab } from '../components/layout/TabNav';
import { labRequest, WorkspaceProject, WorkspaceState, WorkspaceChat, labUpload } from '../api/lab';
import { LabShadow } from './LabShadow';
import { LabMarkdown } from '../components/lab/LabMarkdown';
import { strategyName } from '../components/shadow/panelPresentation';
import { LabModelPicker } from '../components/lab/LabModelPicker';
import { LabProjectList } from '../components/lab/LabProjectList';
import { LabMapa } from '../components/lab/LabMapa';
import { LabSuggestions } from '../components/lab/LabSuggestions';
import { LabFiles } from '../components/lab/LabFiles';
import { Mention, filterMentions, findTrigger, mentionsFromSpace, mentionsIn, Trigger } from '../components/lab/labMentions';
import { fetchSpace } from '../api/space';
import { saveNote } from '../components/lab/labNotes';
import { LabTasks } from '../components/lab/LabTasks';
import { LabUsage } from '../components/lab/LabUsage';
import { LabFilePanel } from '../components/lab/LabFilePanel';
import { LabShell } from '../components/lab/LabShell';
import { LabShare, noticeText } from '../components/lab/LabShare';
import { notifyChat, playChatSound, readChatPrefs } from '../components/lab/labChatPrefs';
import './Lab.css';
import { useChatFontSize } from '../components/settings/ChatFontSetting';
const KIND = { personal: 'Personal', analysis: 'Análisis', strategy: 'Estrategia' };
// Owner 18/10: el mapa se abre lo que se quiera; el chat conserva al menos 360 px.
// El chat nunca queda por debajo de 420 px (revisión 19/10): el tope se mide sobre el contenedor del chat, no la ventana.
const limitMapaWidth = (width: number, room = (typeof window !== 'undefined' ? window.innerWidth : 1600)) => Math.max(280, Math.min(width, room - 420));
const NARROW = '(max-width: 1100px)';
const limitSidebarWidth = (width: number, available: number) => Math.max(200, Math.min(width, 480, Math.max(200, available - 420)));
export function Lab({ onMonitor, onNavigate = () => {}, sidebarHidden = false, onSidebarToggle, onLogout, embedded = false, active = false, projectRequest, onFollowStrategy }: { embedded?: boolean; active?: boolean; projectRequest?: { id: string; sequence: number }; onFollowStrategy?: (spec: string) => void; onMonitor: () => void; onNavigate?: (tab: Tab) => void; sidebarHidden?: boolean; onSidebarToggle?: () => void; onLogout?: () => void }) {
  const [projectHost, setProjectHost] = useState<HTMLElement | null>(null);
  const chatFontSize = useChatFontSize();
  useEffect(() => { if (embedded) setProjectHost(document.getElementById('workspace-projects')); }, [embedded]);
  // En la página del Lab el título y Mapa/Archivos van en la barra superior: una franja menos para el chat.
  const [headerHost, setHeaderHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHeaderHost(active && !embedded ? document.getElementById('workspace-header-slot') : null); }, [active, embedded]);
  const handledRequest = useRef<number | undefined>(undefined);
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [projectId, setProjectId] = useState(() => sessionStorage.getItem('galecore:lab:project') || 'personal');
  const [chatId, setChatId] = useState<string | null>(() => sessionStorage.getItem('galecore:lab:chat'));
  const [chat, setChat] = useState<WorkspaceChat | null>(null);
  const chatLoading = !!chatId && !chat;
  const chatEmpty = !chatLoading && !chat?.messages.length;
  // Proveedor, modelo y esfuerzo con que abre un chat nuevo: lo que eligió la persona en Configuración → Chat.
  const [provider, setProvider] = useState<'codex' | 'claude'>(() => readChatPrefs().provider || 'codex');
  const [chatSettings, setChatSettings] = useState(() => { const p = readChatPrefs(); return { model: p.model, effort: p.effort }; });
  // Chat, Archivos (explorador) y Shell (terminal) del proyecto, en el mismo lugar (owner 17/10).
  const [view, setView] = useState<'chat' | 'design' | 'shadow' | 'files' | 'shell'>('chat');
  const [shellOpened, setShellOpened] = useState(false);
  const [fileToOpen, setFileToOpen] = useState<string | undefined>();
  // WS-0067: el archivo de una respuesta se lee a la derecha del chat (reemplaza al Mapa mientras está abierto).
  const [filePanel, setFilePanel] = useState<string | null>(null);
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
  const [aliases, setAliases] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem('galecore:lab:aliases') || '{}'); } catch { return {}; } });
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  // Nombres escritos todo en minúscula («iwm prima condor 30 45d») se muestran con el mismo formato que Estrategias.
  const name = (key: string, label: string) => aliases[key] || (label === label.toLowerCase() ? strategyName(label.trim().replace(/\s+/g, '_')) : label);
  const startEdit = (key: string, label: string) => { setEditing(key); setEditValue(name(key, label)); };
  const saveEdit = async (key: string, original: string) => {
    const value = editValue.trim(); setEditing(null);
    if (!value || value === name(key, original)) return;
    const isChat = !!state?.chats.some(c => c.id === key);
    try {
      await labRequest(isChat ? '/chats/' + key + '/rename' : '/workspaces/' + key + '/rename', isChat ? { title: value } : { label: value });
      const next = { ...aliases }; delete next[key]; setAliases(next);
      try { localStorage.setItem('galecore:lab:aliases', JSON.stringify(next)); } catch { /* sólo caché */ }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo renombrar.'); }
  };
  const remove = async (kind: 'project' | 'chat', id: string) => {
    try {
      await labRequest(kind === 'chat' ? '/chats/' + id + '/delete' : '/workspaces/' + id + '/archive', {});
      if (kind === 'chat' && chatId === id) { setChatId(null); setChat(null); }
      if (kind === 'project' && projectId === id) { setProjectId('personal'); setChatId(null); setChat(null); }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar.'); }
  };
  const renameInput = (key: string, original: string) => <input className="lab-rename" autoFocus aria-label="Nuevo nombre" value={editValue} onChange={e => setEditValue(e.target.value)}
    onBlur={() => saveEdit(key, original)} onKeyDown={e => { if (e.key === 'Enter') saveEdit(key, original); if (e.key === 'Escape') setEditing(null); }} onClick={e => e.stopPropagation()} />;
  const selection = useRef(0);
  const workspace = useRef<HTMLDivElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const followBottom = useRef(true);
  const project = state?.projects.find(p => p.id === projectId);
  // Mapa sólo en proyectos que trabajan una estrategia (tipo estrategia o con strategyName); en Análisis y Personal no hay botón ni panel.
  const mapaShown = project?.type === 'strategy' || !!project?.strategyName;
  const side: 'file' | 'mapa' | null = filePanel ? 'file' : mapaOpen && mapaShown ? 'mapa' : null;
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
  // Motor por defecto de esta PC (GALECORE_LAB_PROVIDER en el Lab): se aplica una sola vez, al cargar; después manda lo que elija la persona.
  const defaultApplied = useRef(false);
  useEffect(() => {
    if (!state || defaultApplied.current) return;
    defaultApplied.current = true;
    if (!readChatPrefs().provider && state.defaultProvider && state.defaultProvider !== provider && state.providers.find(x => x.id === state.defaultProvider)?.installed) setProvider(state.defaultProvider);
  }, [state, provider]);
  useEffect(() => {
    const o = state?.chatOptions?.[provider];
    if (!o || (!chatSettings.model && !chatSettings.effort)) return;
    const model = !chatSettings.model || o.models.includes(chatSettings.model) ? chatSettings.model : '';
    const supported = o.modelEfforts?.[model || o.defaultModel || ''] || o.efforts;
    const effort = model === chatSettings.model && supported.includes(chatSettings.effort) ? chatSettings.effort : '';
    if (model !== chatSettings.model || effort !== chatSettings.effort) setChatSettings({ model, effort });
  }, [state, provider, chatSettings]);
  useEffect(() => { const ok = state?.providers.find(x => x.installed); if (ok && !state?.providers.find(x => x.id === provider)?.installed) { setProvider(ok.id); setChatSettings({model:'',effort:''}); } }, [state, provider]);
  useEffect(() => { sessionStorage.setItem('galecore:lab:project', projectId); setFilePanel(null); }, [projectId]);
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
    // Un cuadro después: ajustar el alto dentro del propio aviso daba «ResizeObserver loop completed» (owner 19/10).
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth; cancelAnimationFrame(frame); frame = requestAnimationFrame(fit);
    });
    observer.observe(element);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [draft, view]);
  const jumpToLatest = () => {
    followBottom.current = true; setAwayFromBottom(false);
    if (messages.current) messages.current.scrollTop = messages.current.scrollHeight;
  };
  useEffect(() => { const close = (e: KeyboardEvent) => { if(e.key === 'Escape') setCreating(false); }; window.addEventListener('keydown',close); return () => window.removeEventListener('keydown',close); }, []);
  // WS-0067: Esc corta la respuesta en curso (como ■), salvo con un diálogo abierto; con la caja vacía y sin respuesta no hace nada.
  const escape = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => { const on = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) escape.current(e); }; window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on); }, []);

  useEffect(() => {
    if(!creating) return;
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
  },[creating]);
  const [sharingOpen, setSharingOpen] = useState(false);
  // Proyecto compartido: al abrirlo se traen los cambios de los demás (el Lab no repite una sincronización reciente).
  const openedShared = state?.projects.find(p => p.id === projectId)?.shared === true;
  useEffect(() => { if (openedShared) labRequest('/workspaces/' + encodeURIComponent(projectId) + '/sync', { auto: true }, 180000).then(refresh).catch(() => { /* sin red: se sincroniza en el próximo turno */ }); }, [projectId, openedShared, refresh]);
  const selectProject = (p: WorkspaceProject) => { selection.current++; setProjectId(p.id); setFileToOpen(undefined); setChatId(null); setChat(null); setView(v => v === 'files' || v === 'shell' ? v : 'chat'); setExpanded(v=>({...v,[p.id]:true})); setError(''); };
  useEffect(() => {
    if (!projectRequest || handledRequest.current === projectRequest.sequence || !state) return;
    const target = state.projects.find(item => item.id === projectRequest.id);
    if (!target) return;
    handledRequest.current = projectRequest.sequence; selectProject(target);
  }, [projectRequest, state]);
  const selectChat = (p: WorkspaceProject, c: WorkspaceState['chats'][number]) => { selection.current++; setProjectId(p.id); setFileToOpen(undefined); setChatId(c.id); setChat(null); setView('chat'); setError(''); };
  const newChat = () => { const d = readChatPrefs(); if (d.provider) { setProvider(d.provider); setChatSettings({ model: d.model, effort: d.effort }); } setMode(d.mode); selection.current++; setChatId(null); setChat(null); setView('chat'); setError(''); };
  const createProject = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { const p = await labRequest<WorkspaceProject>('/workspaces',{ label:projectLabel }); await refresh(); selectProject(p); setProjectLabel(''); setCreating(false); }
    catch(e) { setError(e instanceof Error ? e.message : 'No se pudo crear el proyecto.'); }
    finally { setBusy(false); }
  };
  // Caja de texto estilo Claude (WS-0036): adjuntos, dictado y modo de permisos por mensaje.
  const [mode, setMode] = useState<'manual' | 'auto'>(() => readChatPrefs().mode);
  const [attachments, setAttachments] = useState<{ path: string; name: string; preview?: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [listening, setListening] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const recognition = useRef<{ stop: () => void } | null>(null);
  const Speech = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : undefined;
  // WS-0067: editar el último mensaje, cola por chat (sólo en memoria), dictado con el espacio y cita de lo seleccionado.
  const [replacing, setReplacing] = useState(false);
  const [queues, setQueues] = useState<Record<string, { text: string; files: string[] }[]>>({});
  const [paused, setPaused] = useState<Record<string, string>>({});
  const [interim, setInterim] = useState('');
  const [quote, setQuote] = useState<{ text: string; x: number; y: number } | null>(null);
  const goOn = useRef(false);
  // Reanudar al liberarse el límite: reenvía solo a esa hora mientras esta pestaña esté abierta.
  const [resume, setResume] = useState<{ chatId: string; at: number } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  // «/» skills y «@» agentes del espacio (propios y compartidos): menú filtrable bajo la caja.
  const [pieces, setPieces] = useState<Mention[]>([]);
  const [menu, setMenu] = useState<(Trigger & { index: number }) | null>(null);
  useEffect(() => { let live = true; fetchSpace().then(d => { if (live) setPieces(mentionsFromSpace([...d.items, ...d.shared])); }).catch(() => { /* sin espacio: no hay menú */ }); return () => { live = false; }; }, []);
  const menuItems = menu ? filterMentions(pieces, menu) : [];
  useEffect(() => { setMode(readChatPrefs().mode); setAttachments([]); setReplacing(false); setInterim(''); setResume(null); }, [chatId, projectId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al cambiar de conversación; seguir chat.mode pisaría el cambio local mientras responde
  useEffect(() => { if (chat?.mode) setMode(chat.mode); }, [chat?.id]);   // cada conversación recuerda su modo
  // Owner 24/10: permisos en el chat como en el CLI; el modo se puede cambiar mientras responde.
  const toggleMode = () => { const next = mode === 'manual' ? 'auto' : 'manual'; setMode(next); if (chat?.state === 'running') labRequest('/chats/' + chat.id + '/mode', { mode: next }).catch(() => setError('No se pudo cambiar el modo.')); };
  const [answering, setAnswering] = useState(false);
  const answerPermission = async (decision: 'allow' | 'always' | 'deny') => { if (!chat?.permission) return; setAnswering(true);
    try { await labRequest('/chats/' + chat.id + '/permission', { id: chat.permission.id, decision }); setChat(c => c ? { ...c, permission: null, activity: 'Trabajando' } : c); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo responder el permiso.'); } finally { setAnswering(false); } };
  const attach = async (files: FileList | File[] | null) => {
    if (!files?.length) return; setUploading(true); setError('');
    try { for (const file of Array.from(files)) { const up = await labUpload(projectId, file); setAttachments(list => [...list, { path: up.path, name: up.name, ...(file.type.startsWith('image/') ? { preview: URL.createObjectURL(file) } : {}) }]); } }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo adjuntar el archivo.'); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  };
  const draftKeyRef = useRef(draftKey); draftKeyRef.current = draftKey;
  const heldSpace = useRef(false);
  const startDictation = () => {
    if (!Speech || recognition.current) return;
    const rec = new Speech(); rec.lang = 'es-AR'; rec.continuous = true; rec.interimResults = true;
    // Lo firme se suma a la caja; lo que se va diciendo se ve en gris hasta confirmarse.
    rec.onresult = (event: any) => {
      const all = Array.from(event.results as ArrayLike<any>) as any[];
      const said = all.slice(event.resultIndex).filter(r => r.isFinal).map(r => r[0].transcript).join(' ').trim();
      setInterim(all.filter(r => !r.isFinal).map(r => r[0].transcript).join(' ').trim());
      if (said) setDrafts(v => ({ ...v, [draftKeyRef.current]: ((v[draftKeyRef.current] || '') + ' ' + said).trim() })); };
    const end = () => { setListening(false); setInterim(''); recognition.current = null; };
    rec.onend = end; rec.onerror = end;
    recognition.current = rec; rec.start(); setListening(true);
  };
  const toggleDictation = () => { if (listening) recognition.current?.stop(); else startDictation(); };
  const send = (e: React.FormEvent) => { e.preventDefault(); void submit(draft, true); };
  // Lo que escribió el trader o lo que eligió en una tarjeta de opciones (WS-0039): el mismo envío.
  // Devuelve si se envió: la tarjeta de opciones vuelve a habilitarse si no salió.
  const submit = async (text: string, fromDraft: boolean, files?: string[], retry = false): Promise<boolean> => {
    const mentions = mentionsIn(text, pieces);
    if(!text.trim() || busy || (chatId && !chat) || chat?.state === 'running' || !project) return false; setBusy(true); setError(''); const sendingSelection = selection.current;
    setPaused(v => { if (!chat || !v[chat.id]) return v; const { [chat.id]: _gone, ...rest } = v; return rest; });
    try {
      const target = chat || await labRequest<WorkspaceChat>('/chats',{project:projectId,provider,...(state?.chatOptions?.[provider] ? chatSettings : {})});
      const next = await labRequest<WorkspaceChat>('/chats/' + target.id + '/messages',{text,mode,attachments:fromDraft?attachments.map(a => a.path):files||[],...(fromDraft&&replacing?{replace:true}:retry?{replace:true,retry:true}:{}),...(mentions.length?{mentions}:{})}); if(fromDraft) { setAttachments([]); setReplacing(false); }
      if(sendingSelection === selection.current) { followBottom.current = true; setAwayFromBottom(false); setChatId(target.id); setChat(next); } if(fromDraft) setDrafts(v=>({...v,[draftKey]:''})); setExpanded(v=>({...v,[projectId]:true})); await refresh();
      return true;
    } catch(e) { setError(e instanceof Error ? e.message : 'No se pudo enviar el mensaje.'); return false; }
    finally { setBusy(false); }
  };
  const stop = async () => { if(!chat) return; try { await labRequest('/chats/' + chat.id + '/stop',{}); } catch { setError('No se pudo detener la respuesta.'); } };
  // ── WS-0067 ─────────────────────────────────────────────────────────────────────────────────────────────────
  const queue = chat ? queues[chat.id] || [] : [];
  const lastUserId = chat ? [...chat.messages].reverse().find(m => m.role === 'user')?.id : undefined;
  const dropAttachments = () => { attachments.forEach(a => a.preview && URL.revokeObjectURL(a.preview)); setAttachments([]); };
  const removeAttachment = (path: string) => setAttachments(list => { const gone = list.find(a => a.path === path); if (gone?.preview) URL.revokeObjectURL(gone.preview); return list.filter(x => x.path !== path); });
  // Mientras responde, Enter encola; al terminar el turno sale el primero (la cola es por chat y no se guarda).
  const enqueue = () => {
    if (!chat || !draft.trim()) return;
    const item = { text: draft.trim(), files: attachments.map(a => a.path) };
    setQueues(v => ({ ...v, [chat.id]: [...(v[chat.id] || []), item] }));
    setDrafts(v => ({ ...v, [draftKey]: '' })); dropAttachments();
  };
  const removeQueued = (index: number) => { if (chat) setQueues(v => ({ ...v, [chat.id]: (v[chat.id] || []).filter((_, i) => i !== index) })); };
  // Ctrl+X: el último encolado vuelve a la caja para editarlo.
  const editQueued = (index: number) => {
    const item = queue[index]; if (!chat || !item) return;
    removeQueued(index);
    setDrafts(v => ({ ...v, [draftKey]: item.text + (draft ? '\n' + draft : '') }));
    if (item.files.length) setAttachments(list => [...list, ...item.files.map(path => ({ path, name: path.replace(/^adjuntos\/\d+-/, '') }))]);
    focusEnd();
  };
  const unqueueLast = () => editQueued(queue.length - 1);
  // «Mandar ya» de uno de la cola: pasa al frente, corta la respuesta y sale.
  const sendQueuedNow = (index: number) => {
    if (!chat || !queue[index]) return;
    goOn.current = true;
    setQueues(v => { const list = [...(v[chat.id] || [])]; const [item] = list.splice(index, 1); return { ...v, [chat.id]: [item, ...list] }; });
    if (chat.state === 'running') void stop();
  };
  // Ctrl+S: manda ya. Corta la respuesta en curso y lo escrito sale primero de la cola.
  const sendNow = () => {
    if (!draft.trim()) return;
    if (chat?.state !== 'running') { void submit(draft, true); return; }
    goOn.current = true;
    setQueues(v => ({ ...v, [chat.id]: [{ text: draft.trim(), files: attachments.map(a => a.path) }, ...(v[chat.id] || [])] }));
    setDrafts(v => ({ ...v, [draftKey]: '' })); dropAttachments(); void stop();
  };
  // Sin dependencias a propósito: corre en cada render y se corta sola (la cola se achica antes de enviar).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!chat || chat.state === 'running' || busy || paused[chat.id]) return;
    // Un turno con error o cortado a mano frena la cola hasta que la persona diga «Seguir» (o mande con Ctrl+S).
    if (chat.state !== 'idle' && !goOn.current) return;
    const next = queues[chat.id]?.[0]; if (!next) return;
    goOn.current = false;
    setQueues(v => ({ ...v, [chat.id]: (v[chat.id] || []).slice(1) }));
    void submit(next.text, false, next.files).then(ok => { if (!ok) { setQueues(v => ({ ...v, [chat.id]: [next, ...(v[chat.id] || [])] })); setPaused(v => ({ ...v, [chat.id]: 'no se pudo enviar' })); } });
  });
  const queueBlock = !chat || !queue.length ? '' : paused[chat.id] || (chat.state === 'failed' ? 'el turno terminó con error' : chat.state === 'cancelled' && !goOn.current ? 'cortaste la respuesta' : '');
  const resumeQueue = () => { goOn.current = true; setPaused(v => { if (!chat) return v; const { [chat.id]: _gone, ...rest } = v; return rest; }); };
  // Esc corta (como ■); con la edición abierta, la cancela. Nada si hay un diálogo o un campo propio (renombrar, menús).
  escape.current = (e: KeyboardEvent) => {
    if (view !== 'chat' || (!active && !embedded) || creating || sharingOpen) return;
    if ((e.target as HTMLElement | null)?.closest?.('.lab-rename, [role="dialog"], [role="listbox"], [role="combobox"]')) return;
    if (chat?.state === 'running') void stop();
    else if (replacing) { setReplacing(false); setDrafts(v => ({ ...v, [draftKey]: '' })); }
  };
  const focusEnd = () => window.setTimeout(() => { const box = composer.current; if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } }, 0);
  const editLast = (text: string) => { setReplacing(true); setDrafts(v => ({ ...v, [draftKey]: text })); focusEnd(); };
  // Sonido y aviso del navegador al terminar o pedir permiso. Dos fuentes (el chat abierto cada 1 s y la lista cada 4 s), sin pisarse.
  const seen = useRef(new Map<string, { state: string; permission?: string }>());
  const openChat = useRef<(id: string) => void>(() => {});
  openChat.current = id => { const c = state?.chats.find(x => x.id === id), p = c && state?.projects.find(x => x.id === c.project); if (c && p) selectChat(p, c); };
  const observe = useCallback((source: string, id: string, title: string, st: string, permission?: string) => {
    const before = seen.current.get(source + id); seen.current.set(source + id, { state: st, permission });
    if (!before) return;
    const prefs = readChatPrefs();
    if (before.state === 'running' && st !== 'running' && st !== 'cancelled') { if (prefs.finishSound) playChatSound('done'); notifyChat(title, 'Terminó de responder', () => openChat.current(id)); }
    if (permission && permission !== before.permission) { if (prefs.permissionSound) playChatSound('permission'); notifyChat(title, 'Necesita tu permiso', () => openChat.current(id)); }
  }, []);
  useEffect(() => { state?.chats.forEach(c => { if (c.id === chatId) seen.current.delete('l:' + c.id); else observe('l:', c.id, c.title, c.state, c.permission?.id); }); }, [state, chatId, observe]);
  useEffect(() => { if (chat) observe('c:', chat.id, chat.title, chat.state, chat.permission?.id); }, [chat, observe]);
  // Dictado con el espacio apretado: con la caja vacía o fuera de un campo; con texto escrito, el espacio es un espacio.
  const dictate = useRef(startDictation); dictate.current = startDictation;
  useEffect(() => {
    const textField = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(el.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !Speech || view !== 'chat' || (!active && !embedded) || creating || sharingOpen) return;
      if (textField(e.target) && !(e.target === composer.current && !composer.current?.value.trim())) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      if (e.repeat && !heldSpace.current && !recognition.current) { heldSpace.current = true; dictate.current(); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' && heldSpace.current) { heldSpace.current = false; recognition.current?.stop(); } };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [Speech, view, active, embedded, creating, sharingOpen]);
  // «Preguntar sobre esto»: al seleccionar texto de una respuesta aparece un botón que pone la cita en la caja.
  useEffect(() => {
    const check = () => {
      const sel = window.getSelection(), text = sel?.toString().trim() || '';
      const inAnswer = (n: Node | null) => !!(n instanceof Element ? n : n?.parentElement)?.closest('.lab-message.assistant');
      if (!sel || sel.isCollapsed || !text || !(inAnswer(sel.anchorNode) || inAnswer(sel.focusNode))) { setQuote(null); return; }
      const box = sel.getRangeAt(0).getBoundingClientRect();
      // Debajo de la barra superior y dentro de la ventana; si no hay lugar arriba, va debajo de la selección.
      const above = box.top - 44;
      setQuote({ text, x: Math.min(Math.max(8, box.left), window.innerWidth - 200), y: above > 72 ? above : Math.min(box.bottom + 8, window.innerHeight - 48) });
    };
    const later = () => window.setTimeout(check, 0);
    document.addEventListener('mouseup', later); document.addEventListener('keyup', later);
    return () => { document.removeEventListener('mouseup', later); document.removeEventListener('keyup', later); };
  }, []);
  const pick = (piece: Mention) => {
    if (!menu) return;
    const caret = composer.current?.selectionStart ?? draft.length, tag = (menu.char) + piece.key + ' ';
    const next = draft.slice(0, menu.start) + tag + draft.slice(caret);
    setDrafts(v => ({ ...v, [draftKey]: next })); setMenu(null);
    window.setTimeout(() => { const box = composer.current; if (box) { box.focus(); const at = menu.start + tag.length; box.setSelectionRange(at, at); } }, 0);
  };
  const keepAsNote = async (id: string, text: string) => {
    try { const path = await saveNote(projectId, text); setNotes(v => ({ ...v, [id]: path })); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la nota.'); }
  };
  // Reintentar: el mismo mensaje otra vez (el Lab saca el pedido que falló y su resto, sin avisarle nada raro al motor).
  const retryLast = () => { const last = chat && [...chat.messages].reverse().find(m => m.role === 'user'); if (last) void submit(last.text, false, [], true); };
  const retryRef = useRef(retryLast); retryRef.current = retryLast;
  useEffect(() => {
    if (!resume) return;
    const timer = window.setTimeout(() => { setResume(null); retryRef.current(); }, Math.max(0, resume.at - Date.now()));
    return () => window.clearTimeout(timer);
  }, [resume]);
  const limitAt = chat && typeof chat.limitResetsAt === 'number' ? chat.limitResetsAt * 1000 : 0;
  const clock = (at: number) => new Date(at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const askAboutQuote = () => {
    if (!quote) return;
    const cited = quote.text.split(/\r?\n/).map(l => '> ' + l).join('\n') + '\n\n';
    setDrafts(v => ({ ...v, [draftKey]: cited + (v[draftKey] || '') })); setQuote(null); window.getSelection()?.removeAllRanges(); focusEnd();
  };
  const composerForm = <form className="lab-chat-composer" onSubmit={send}>{queue.length > 0 && <div className="lab-queue" role="status" aria-label="Mensajes en cola"><strong>En cola: salen solos cuando termine la respuesta</strong>{queue.map((q, i) => <div key={i}><span>{q.text}</span><span className="lab-queue-actions"><button type="button" title="Cargarlo en la caja para cambiarlo (Ctrl + X con el último)" aria-label={'Editar en cola: ' + q.text.slice(0, 40)} onClick={() => editQueued(i)}>Editar</button><button type="button" title="Corta la respuesta y lo manda ya (Ctrl + S)" aria-label={'Mandar ya: ' + q.text.slice(0, 40)} onClick={() => sendQueuedNow(i)}>Mandar ya</button><button type="button" aria-label={'Quitar de la cola: ' + q.text.slice(0, 40)} onClick={() => removeQueued(i)}>Quitar</button></span></div>)}{queueBlock && <p>La cola está frenada: {queueBlock}. <button type="button" onClick={resumeQueue}>Seguir</button></p>}</div>}{replacing && <div className="lab-editing" role="status"><Pencil size={13}/>Editando tu último mensaje: reemplaza al anterior y a su respuesta<button type="button" onClick={() => { setReplacing(false); setDrafts(v => ({ ...v, [draftKey]: '' })); }}>Cancelar</button></div>}{attachments.length > 0 && <div className="lab-attachments">{attachments.map(a => <span key={a.path}>{a.preview ? <img src={a.preview} alt=""/> : <Paperclip size={13}/>}{a.name}<button type="button" aria-label={'Quitar ' + a.name} onClick={() => removeAttachment(a.path)}><X size={13}/></button></span>)}</div>}{menu&&<ul className="lab-mention-menu" id="lab-mention-menu" role="listbox" aria-label={menu.char==='/'?'Skills':'Agentes'}>{menuItems.length?menuItems.map((m,i)=><li key={m.kind+m.key} id={'lab-mention-'+i} role="option" aria-selected={i===menu.index} onMouseDown={e=>{e.preventDefault();pick(m);}} onMouseEnter={()=>setMenu({...menu,index:i})}><b>{menu.char}{m.key}</b><span>{m.title}</span></li>):<li role="presentation" className="empty">{menu.char==='/'?'No hay skills que coincidan':'No hay agentes que coincidan'}</li>}</ul>}<textarea ref={composer} aria-controls={menu?'lab-mention-menu':undefined} aria-activedescendant={menu&&menuItems.length?'lab-mention-'+menu.index:undefined} rows={1} maxLength={12000} disabled={busy} aria-label="Mensaje al proyecto" title="Enter para enviar (encola si está respondiendo) · Shift + Enter para otra línea · Ctrl + S manda ya · Ctrl + X recupera el último encolado" value={draft} onChange={e=>{setDrafts(v=>({...v,[draftKey]:e.target.value}));const t=findTrigger(e.target.value,e.target.selectionStart);setMenu(t?{...t,index:0}:null);}} onPaste={e => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); void attach(files); } }} onKeyDown={e=>{
  if(menu&&menuItems.length&&['ArrowDown','ArrowUp','Enter','Tab'].includes(e.key)&&!e.nativeEvent.isComposing){e.preventDefault();if(e.key==='ArrowDown')setMenu({...menu,index:(menu.index+1)%menuItems.length});else if(e.key==='ArrowUp')setMenu({...menu,index:(menu.index+menuItems.length-1)%menuItems.length});else pick(menuItems[Math.min(menu.index,menuItems.length-1)]);return;}
  if(menu&&e.key==='Escape'){e.preventDefault();setMenu(null);return;}
  if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(draft.trim()&&!busy){if(chat?.state==='running')enqueue();else e.currentTarget.form?.requestSubmit();}}
  else if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==='s'){e.preventDefault();if(!busy)sendNow();}
  else if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==='x'&&queue.length&&e.currentTarget.selectionStart===e.currentTarget.selectionEnd){e.preventDefault();unqueueLast();}}}/>{listening&&<p className="lab-interim" aria-live="polite">{interim||'Escuchando…'}</p>}<div className="lab-composer-bar"><div className="lab-composer-side"><button type="button" className="lab-tool" aria-label="Adjuntar archivo" title="Adjuntar archivo" disabled={busy || uploading || !project} onClick={() => fileInput.current?.click()}><Plus size={18}/></button><input ref={fileInput} type="file" multiple hidden onChange={e => void attach(e.target.files)}/>{Speech && <button type="button" className={'lab-tool' + (listening ? ' active' : '')} aria-label={listening ? 'Detener dictado' : 'Dictar'} title={listening ? 'Detener dictado' : 'Dictar'} onClick={toggleDictation}><Mic size={17}/></button>}{uploading && <span className="lab-uploading" role="status">Adjuntando…</span>}</div><div className="lab-composer-side">{chat?.state==='running'&&draft.trim()&&<><button type="button" className="lab-queue-add" aria-label="Encolar mensaje" title="Sale solo cuando termine la respuesta (Enter)" disabled={busy} onClick={()=>enqueue()}>Encolar</button><button type="button" className="lab-send-now" aria-label="Mandar ya el mensaje escrito" title="Corta la respuesta y lo manda ya (Ctrl + S)" disabled={busy} onClick={()=>sendNow()}>Mandar ya</button></>}<LabModelPicker provider={activeChoice?.provider || provider} model={chatId ? activeChoice?.model || '' : chatSettings.model} effort={chatId ? activeChoice?.effort || '' : chatSettings.effort} providers={state?.providers || []} options={state?.chatOptions} locked={!!chatId || busy} onChange={value=>{setProvider(value.provider);setChatSettings({model:value.model,effort:value.effort});}}/><button type="button" className={'lab-mode ' + mode} aria-label={'Permisos: ' + (mode === 'auto' ? 'Auto' : 'Manual')} title={mode === 'auto' ? 'Auto: decide solo lo seguro y te pregunta lo demás' : 'Manual: te pregunta antes de lo que necesita permiso'} onClick={toggleMode}>{mode === 'auto' ? 'Auto' : 'Manual'}</button>{chat?.state==='running'?<button type="button" className="lab-send" aria-label="Detener respuesta" onClick={stop}><Square size={15}/></button>:<button type="submit" className="lab-send" aria-label="Enviar mensaje" disabled={!draft.trim()||busy||!state||!!(chatId&&!chat)}><ArrowUp size={19}/></button>}</div></div></form>;
  const chatHeader = <header className={"lab-chat-header" + (headerHost ? " in-global-header" : "")}><div className="lab-project-title"><strong>{project ? name(project.id, project.label) : 'Lab'}</strong>{project && KIND[project.type] !== name(project.id, project.label) && <span>{KIND[project.type]}</span>}</div><div className="lab-header-actions"><LabUsage usage={chat?.usage}/>{project && project.id !== 'personal' && <button className="lab-files-button" onClick={()=>setSharingOpen(true)}><Users size={17}/>Compartir</button>}{view==='chat' && mapaShown && <button className="lab-files-button" aria-pressed={side==='mapa'} onClick={()=>{ if (filePanel) { setFilePanel(null); setMapaOpen(true); } else setMapaOpen(v=>!v); }}><MapIcon size={17}/>Mapa</button>}<div className="lab-view-switch" role="group" aria-label="Vista del proyecto"><button aria-pressed={view==='chat' || view==='design' || view==='shadow'} onClick={()=>setView('chat')}><MessageSquare size={16}/>Chat</button><button aria-pressed={view==='files'} onClick={()=>{setFileToOpen(undefined);setView('files');}}><Files size={16}/>Archivos</button><button aria-pressed={view==='shell'} onClick={()=>{setShellOpened(true);setView('shell');}}><SquareTerminal size={16}/>Shell</button></div></div></header>;
  const projectSidebar = <aside className="lab-chat-sidebar" id="lab-project-sidebar">
      <div className="lab-sidebar-heading">{!embedded && !onSidebarToggle && <button className="lab-icon" aria-label={collapsed ? 'Mostrar proyectos' : 'Ocultar proyectos'} onClick={()=>setCollapsed(v=>!v)}>{collapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button>}</div>
      {!collapsed && <LabProjectList state={state} projectId={projectId} chatId={chatId} expanded={expanded}
        onToggle={id => setExpanded(v => ({ ...v, [id]: !v[id] }))} onProject={selectProject} onChat={selectChat}
        onNewChat={p => { selectProject(p); newChat(); }} onCreateProject={() => setCreating(true)}
        name={name} onRename={startEdit} editing={editing} renameInput={renameInput} onDelete={remove}/> }
    </aside>;
  return <div ref={workspace} className={'lab-chat-workspace' + (embedded ? ' embedded' : '') + (sidebarHidden ? ' sidebar-hidden' : collapsed ? ' sidebar-collapsed' : '')} style={{ '--lab-sidebar-width': sidebarWidth + 'px', '--lab-chat-font-size': chatFontSize } as React.CSSProperties}>
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
    <section className={'lab-chat-main' + (chatEmpty && view === 'chat' ? ' empty' : '')}>
      {headerHost ? createPortal(chatHeader, headerHost) : chatHeader}
      {project?.syncNotice && <p className="lab-sync-notice" role="status"><span>{noticeText(project.syncNotice)}</span><button className="lab-icon" aria-label="Cerrar aviso" onClick={() => labRequest('/workspaces/' + project.id + '/notice', {}).then(refresh).catch(() => {})}><X size={16}/></button></p>}
      {shellOpened && <LabShell key={projectId} projectId={projectId} folder={project?.relative} visible={view==='shell'}/>}
      {view==='files' ? <LabFiles key={projectId} projectId={projectId} folder={project?.relative} openPath={fileToOpen}/> : view==='shell' ? null : view!=='chat' ? <LabShadow key={project?.id + view} mode={view} project={project} onChat={()=>setView('chat')} onMonitor={onMonitor}/> : <div ref={chatBody} className={'lab-chat-body' + (side ? (narrow ? ' mapa-only' : ' with-mapa') : '')} style={{ '--lab-mapa-width': mapaWidth + 'px' } as React.CSSProperties}><div className="lab-chat-column" onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); void attach(Array.from(e.dataTransfer.files)); } }}>
      <div className="lab-messages" ref={messages} onScroll={e => {
        const element = e.currentTarget;
        const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        followBottom.current = nearBottom; setAwayFromBottom(!nearBottom);
      }}>
        {chatLoading && !error && <div className="lab-chat-notice" role="status">Cargando conversación…</div>}
        {chatEmpty && <div className="lab-chat-welcome"><h1>{project?.type==='strategy' ? '¿Qué estrategia querés construir?' : project?.type==='personal' ? 'Tu espacio personal' : '¿Qué querés investigar?'}</h1>{project?.type==='strategy' && <p>De la idea a una estrategia lista para probar en Shadow.</p>}</div>}
        {chat?.messages.map(m=><article className={'lab-message '+m.role} key={m.id}><span>{m.role==='user'?'Vos':chat.provider==='codex'?'Codex':'Claude'}</span>{m.role==='assistant' ? <LabMarkdown text={m.text} active={m.id===chat.messages[chat.messages.length-1]?.id && chat.state!=='running' && !busy} onAnswer={text=>submit(text,false)} files={project ? { folder: project.relative, open: p => setFilePanel(p) } : undefined}/> : <div>{m.text}</div>}{m.role==='assistant' && !(chat.state==='running' && m.id===chat.messages[chat.messages.length-1]?.id) && (notes[m.id] ? <span className="lab-note-saved">Guardada: <a href={'#'+notes[m.id]} onClick={e=>{e.preventDefault();setFilePanel(notes[m.id]);}}>{notes[m.id]}</a></span> : <button type="button" className="lab-message-edit lab-note-save" onClick={() => void keepAsNote(m.id, m.text)}>Guardar como nota</button>)}{m.role==='user' && m.id===lastUserId && chat.state!=='running' && !busy && <button type="button" className="lab-message-edit" onClick={() => editLast(m.text)}><Pencil size={13}/>Editar</button>}</article>)}
        {chat?.state==='running' && <div className="lab-chat-activity" role="status">
          {(() => { const steps = chat.steps || [], last = steps.length - 1;   // como Claude Code: qué hizo, con qué, y qué hace ahora
            return <>{steps.map((st, i) => st.kind === 'note'
              ? <span key={i} className="lab-step-note">{st.label}</span>
              : <span key={i} className={i === last ? 'lab-step-now' : 'lab-step-done'}>{i === last ? <i/> : <b>●</b>}<span>{st.label}{i === last ? '…' : ''}</span>{st.detail && <code>{st.detail}</code>}</span>)}
              {(last < 0 || steps[last].kind === 'note') && <span className="lab-step-now"><i/><span>{chat.activity && chat.activity !== 'Trabajando' ? chat.activity : 'Pensando'}…</span></span>}</>; })()}
        </div>}
        {chat?.state==='running' && <LabTasks tasks={chat.tasks}/>}
        {chat?.state==='running' && chat.permission && <div className="lab-permission" role="alertdialog" aria-label="Pedido de permiso"><p>Necesita tu permiso: <strong>{chat.permission.label === 'Trabajando' ? chat.permission.tool : chat.permission.label}</strong></p>{chat.permission.detail && <code>{chat.permission.detail}</code>}<div><button type="button" className="primary" disabled={answering} onClick={() => void answerPermission('allow')}>Permitir</button>{chat.permission.always && <button type="button" disabled={answering} onClick={() => void answerPermission('always')}>Permitir y no volver a preguntar</button>}<button type="button" disabled={answering} onClick={() => void answerPermission('deny')}>No permitir</button></div></div>}
        {chat?.state!=='running' && chat?.notice && !chat?.error && <div className="lab-chat-notice" role="status">{chat.notice}</div>}
        {(error || chat?.error) && <div className="lab-chat-error" role="alert">{error || chat?.error}{error && <button onClick={refresh}>Reintentar conexión</button>}{!error && chat?.state==='failed' && <span className="lab-chat-error-actions"><button type="button" onClick={retryLast}>Reintentar</button>{limitAt > Date.now() && (resume?.chatId === chat.id ? <><span>Se reenvía solo a las {clock(resume.at)}, mientras esta pestaña esté abierta.</span><button type="button" onClick={() => setResume(null)}>Cancelar</button></> : <button type="button" onClick={() => setResume({ chatId: chat.id, at: limitAt })}>Reanudar a las {clock(limitAt)}</button>)}</span>}</div>}
      </div>
      {awayFromBottom && <button type="button" className="lab-jump-latest" onClick={jumpToLatest}>Ir al último mensaje</button>}
      {composerForm}
      {chatEmpty && !busy && <LabSuggestions disabled={chat?.state==='running'} onPick={question => void submit(question, false)}/>}
      </div>
      {side && !narrow && <div className="lab-sidebar-resize lab-mapa-resize" role="separator" tabIndex={0} aria-label={side === 'file' ? 'Ancho del archivo' : 'Ancho del mapa'} aria-orientation="vertical" aria-valuemin={280} aria-valuemax={Math.max(280, (chatBody.current?.clientWidth || 1600) - 420)} aria-valuenow={mapaWidth}
        title="Arrastrá para ajustar · flechas para cambiar ancho · doble clic para restablecer"
        onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { const box = chatBody.current?.getBoundingClientRect(); setMapaWidth(limitMapaWidth((box?.right || 0) - e.clientX, box?.width)); } }}
        onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onDoubleClick={() => setMapaWidth(380)}
        onKeyDown={e => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); setMapaWidth(w => limitMapaWidth(w + (e.key === 'ArrowLeft' ? 1 : -1) * (e.shiftKey ? 40 : 10), chatBody.current?.clientWidth)); }}/>}
      {side === 'file' && project && filePanel && <LabFilePanel projectId={projectId} folder={project.relative} path={filePanel} narrow={narrow} onOpen={setFilePanel} onClose={() => setFilePanel(null)} onOpenInFiles={path => { setFilePanel(null); setFileToOpen(path); setView('files'); }}/>}
      {side === 'mapa' && <LabMapa chatId={chatId} projectId={projectId} running={chat?.state === 'running'} onResults={project?.strategyName ? () => onFollowStrategy?.(project.strategyName!) : undefined}/>}
      </div>}
    </section>
    {quote && createPortal(<button type="button" className="lab-quote-button" style={{ left: quote.x, top: quote.y }} onMouseDown={e => e.preventDefault()} onClick={askAboutQuote}>Preguntar sobre esto</button>, document.body)}
    {sharingOpen && project && <LabShare project={project} onClose={() => setSharingOpen(false)} onChanged={refresh}/>}
    {creating && <div className="lab-modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="lab-create-title" className="lab-create-project"><header><h2 id="lab-create-title">Nuevo proyecto</h2><button className="lab-icon" aria-label="Cerrar" onClick={()=>setCreating(false)}><X size={19}/></button></header><form onSubmit={createProject}><label>Nombre<input autoFocus required maxLength={100} value={projectLabel} onChange={e=>setProjectLabel(e.target.value)} placeholder="Prima en SPY"/></label><p>Una idea, un activo o un tema. Si en la conversación arman una estrategia, el proyecto la sigue desde ahí.</p>{error && <p role="alert">{error}</p>}<button className="btn" disabled={busy||!projectLabel.trim()}>Crear proyecto</button></form></section></div>}
  </div>;
}
