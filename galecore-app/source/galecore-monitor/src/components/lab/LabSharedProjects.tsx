import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, RefreshCw, Folder, Search, Plus } from 'lucide-react';
import { labRequest } from '../../api/lab';
import type { SyncAction, SyncNotice, SyncState, WorkspaceProject } from '../../api/lab';
import { noticeText } from './LabShare';
import './LabSharedProjects.css';

interface Project {
  id: string; name: string; owner: string; local: string | null; subscribed: boolean; mine?: boolean; member?: boolean; access?: 'restricted' | 'everyone';
  needsConfirmation?: boolean; lastSuccess?: string | null; lastError?: string | null; syncing?: boolean; working?: boolean; removed?: boolean;
  syncState?: SyncState; action?: SyncAction;
  skipped?: { path: string; reason: string }[]; syncNotice?: SyncNotice | null; notice?: string | null;
  localOnly?: boolean;
}
interface Catalog { user: string; api: string; projects: Project[] }
type RowAction = 'view' | 'retry' | 'sync' | 'reshare' | 'remove';

/** Estado visible de un proyecto ya agregado: texto y, si hace falta, el botón que lo resuelve. */
function syncStatus(p: Project, busy: boolean): { text: string; kind: 'ok' | 'attention' | ''; action?: RowAction } {
  if (p.removed) return { text: 'Acceso retirado', kind: 'attention', action: 'remove' };
  if (p.syncing || p.syncState === 'syncing' || busy) return { text: 'Sincronizando…', kind: '' };
  if (!p.subscribed) return { text: 'Pausado', kind: '' };
  if (p.syncState === 'conflict' || (!p.syncState && p.syncNotice?.conflicts?.length)) return { text: p.notice || 'Conflicto en ' + (p.syncNotice?.conflicts[0]?.path || 'un archivo'), kind: 'attention', action: 'view' };
  if (p.syncState === 'error' || (!p.syncState && (p.syncNotice?.error || p.lastError))) {
    const reason = p.notice || p.syncNotice?.error || p.lastError || (p.syncNotice ? noticeText(p.syncNotice) : 'sin detalle');
    return { text: 'No se pudo sincronizar: ' + reason, kind: 'attention', action: p.action || 'retry' };
  }
  if (p.syncState === 'pending') return { text: p.notice || 'Cambios sin compartir', kind: 'attention', action: 'sync' };   // el Lab vio archivos locales distintos al último sync
  // Sólo se sincroniza solo al arrancar el Lab: el botón trae y sube lo nuevo en el momento.
  return { text: 'Al día', kind: 'ok', action: 'sync' };
}
const ACTION_LABEL: Record<RowAction, string> = { view: 'Ver', retry: 'Reintentar', sync: 'Sincronizar', reshare: 'Compartir acá', remove: 'Quitar de mi Lab' };

export function LabSharedProjects({ onClose, onChanged, onOpen, onView, onShare, onRemove, localProjects = [] }: {
  onClose: () => void; onChanged: () => Promise<void>; onOpen: (id: string) => void | Promise<void>; localProjects?: WorkspaceProject[];
  /** «Ver» un conflicto: abre el archivo (la copia en conflicto si existe) del proyecto local. */
  onView?: (localId: string, path: string) => void;
  /** «Compartir acá»: abre el diálogo de compartir del proyecto local. */
  onShare?: (localId: string) => void;
  /** «Quitar de mi Lab»: archiva la copia local. */
  onRemove?: (localId: string) => void | Promise<void>;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);   // «Quitar de mi Lab» borra la copia: se confirma con un segundo clic
  const dialog = useRef<HTMLElement>(null);
  const alive = useRef(true);
  const pending = useRef(false);
  const lastRequest = useRef(0);
  const load = useCallback(async () => {
    if (pending.current) return;
    pending.current = true; lastRequest.current = Date.now();
    setLoading(true);
    try {
      const data = await labRequest<Catalog>('/workspaces/shared', undefined, 180000);
      if (alive.current) { setCatalog(data); setError(''); }
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { pending.current = false; if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    void load();
    return () => { alive.current = false; previous?.focus(); };
  }, [load]);
  useEffect(() => {
    const update = () => { if (!document.hidden && !busy && Date.now() - lastRequest.current >= 10000) void load(); };
    const timer = window.setInterval(update, 30000);
    window.addEventListener('focus', update); window.addEventListener('online', update); document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); window.removeEventListener('online', update); document.removeEventListener('visibilitychange', update); };
  }, [load, busy]);
  const add = async (p: Project) => {
    setBusy(p.id); setError(''); setMessage('');
    try {
      const result = await labRequest<{ error?: string }>('/shared-projects/' + encodeURIComponent(p.id) + '/add', {}, 180000);
      if (!alive.current) return;
      await onChanged();
      await load();
      if (alive.current) { if (result.error) setError(result.error); else setMessage('Proyecto agregado a tu Lab.'); }
    } catch (e) { if (alive.current) { await load(); if (alive.current) setError((e as Error).message); } }
    finally { if (alive.current) setBusy(null); }
  };
  const act = async (p: Project, action: RowAction) => {
    const local = p.local; if (!local) return;
    setError(''); setMessage('');
    if (action === 'view') { const c = p.syncNotice?.conflicts[0]; if (c) onView?.(local, c.copy || c.path); return; }
    if (action === 'reshare') { onShare?.(local); return; }
    if (action === 'remove' && confirmRemove !== p.id) { setConfirmRemove(p.id); return; }
    if (action === 'remove') { setConfirmRemove(null); await onRemove?.(local); if (alive.current) await load(); return; }
    setBusy(p.id);
    try {
      await labRequest('/workspaces/' + encodeURIComponent(local) + '/sync', {}, 180000);
      await onChanged(); await load();
    } catch (e) { if (alive.current) { await load(); if (alive.current) setError((e as Error).message); } }
    finally { if (alive.current) setBusy(null); }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy('create'); setError('');
    try {
      const p = await labRequest<WorkspaceProject>('/workspaces', {label:name.trim()});
      if (alive.current) { await onChanged(); await onOpen(p.id); }
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(null); }
  };
  const remote = catalog?.projects || [];
  const local: Project[] = localProjects.filter(p => !remote.some(r => r.local === p.id)).map(p => ({id:'local:' + p.id, name:p.label, owner:'', local:p.id, subscribed:false, localOnly:true}));
  const words = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = (p: Project) => { const text = (p.name + ' ' + p.owner).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); return words.every(w => text.includes(w)); };
  const mine = [...local, ...remote.filter(p => p.mine)].filter(matches);
  const others = remote.filter(p => !p.mine).filter(matches);
  const row = (p: Project) => {
    const added = !!p.local && !p.needsConfirmation;
    const status = added && !p.localOnly ? syncStatus(p, busy === p.id) : null;
    return <li key={p.id}><span className="lab-shared-folder"><Folder size={22}/></span><div className="lab-shared-description"><strong>{p.name}</strong><div className="lab-shared-meta">{!p.localOnly && <span>Dueño: {p.owner || 'No disponible'}</span>}{status && <span className={'lab-shared-state' + (status.kind === 'attention' ? ' attention' : status.kind === 'ok' ? ' following' : '')}>{status.text}</span>}</div></div>
      <div className="lab-shared-actions">
        {status?.action && <button className="btn lab-shared-secondary" disabled={busy === p.id} onClick={() => void act(p, status.action!)}>{status.action === 'remove' && confirmRemove === p.id ? 'Sí, quitar la copia' : ACTION_LABEL[status.action]}</button>}
        {added && <button className="btn lab-shared-secondary" onClick={() => void onOpen(p.local!)}>Abrir</button>}
        {!added && !p.removed && <button className="btn lab-shared-primary" disabled={!!busy} onClick={() => void add(p)}>{busy === p.id ? 'Agregando…' : 'Agregar a mi Lab'}</button>}
      </div></li>;
  };
  const sections: [string, Project[]][] = [['Mis proyectos', mine], ['Compartidos conmigo', others]];
  return <div className="lab-modal-backdrop"><section ref={dialog} tabIndex={-1} className="lab-shared-projects" role="dialog" aria-modal="true" aria-labelledby="shared-projects-title"
    onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      if (e.key !== 'Tab') return;
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || []);
      const first = elements[0], last = elements[elements.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }}>
    <header><div><h2 id="shared-projects-title">Proyectos</h2></div><div className="lab-shared-header-actions"><button className="btn lab-shared-primary" disabled={!!busy} aria-expanded={creating} onClick={()=>setCreating(v=>!v)}><Plus size={17}/>Crear nuevo</button><button className="lab-icon" aria-label="Cerrar proyectos" onClick={onClose}><X size={20}/></button></div></header>
    <div className="lab-shared-search-row"><label className="lab-shared-search"><Search size={20}/><input autoFocus aria-label="Buscar proyectos por nombre o dueño" placeholder="Buscar proyectos o personas…" value={query} onChange={e=>setQuery(e.target.value)}/>{query && <button className="lab-icon" aria-label="Limpiar búsqueda de proyectos" onClick={()=>setQuery('')}><X size={16}/></button>}</label><button className="lab-icon lab-shared-refresh" title="Actualizar proyectos" aria-label="Actualizar" disabled={loading || !!busy} onClick={() => void load()}><RefreshCw size={19}/></button></div>
    {creating && <form className="lab-shared-create" onSubmit={create}><label>Nombre<input autoFocus maxLength={100} required placeholder="Nombre del nuevo proyecto" value={name} onChange={e=>setName(e.target.value)}/></label><button className="btn lab-shared-primary" disabled={!!busy || !name.trim()}>{busy === 'create' ? 'Creando…' : 'Crear proyecto'}</button><button type="button" className="lab-icon" aria-label="Cancelar creación" onClick={()=>setCreating(false)}><X size={18}/></button></form>}
    {error && <p role="alert">{error}. La lista anterior puede estar desactualizada.</p>}
    {message && <p role="status">{message}</p>}
    {loading && <p role="status">Consultando catálogo…</p>}
    <div className="lab-shared-lists">
      {sections.map(([title, list], i) => (i === 0 || list.length > 0) && <section key={title} aria-label={title}>
        <h3>{title}</h3>
        <ul aria-label={title}>{list.map(row)}{!list.length && !loading && <li>{query ? 'No hay proyectos que coincidan con tu búsqueda.' : 'No hay proyectos todavía.'}</li>}</ul>
      </section>)}
    </div>
  </section></div>;
}
