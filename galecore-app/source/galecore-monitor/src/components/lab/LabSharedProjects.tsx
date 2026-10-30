import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, RefreshCw, Folder, Search, Plus, Check } from 'lucide-react';
import { labRequest } from '../../api/lab';
import type { SyncNotice, WorkspaceProject } from '../../api/lab';
import { noticeText } from './LabShare';
import './LabSharedProjects.css';

interface Project {
  id: string; name: string; owner: string; local: string | null; subscribed: boolean;
  needsConfirmation?: boolean; lastSuccess?: string | null; lastError?: string | null; syncing?: boolean; working?: boolean; removed?: boolean;
  skipped?: { path: string; reason: string }[]; notice?: SyncNotice | null;
  localOnly?: boolean;
}
interface Catalog { user: string; api: string; projects: Project[] }

export function LabSharedProjects({ onClose, onChanged, onOpen, localProjects = [] }: {
  onClose: () => void; onChanged: () => Promise<void>; onOpen: (id: string) => void | Promise<void>; localProjects?: WorkspaceProject[];
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
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
  const change = async (p: Project, enabled: boolean) => {
    setBusy(p.id); setError(''); setMessage('');
    try {
      const result = await labRequest<{ error?: string }>('/shared-projects/' + encodeURIComponent(p.id) + '/' + (enabled ? 'subscribe' : 'pause'), {}, 180000);
      if (!alive.current) return;
      await onChanged();
      await load();
      if (alive.current) {
        if (result.error) setError(result.error);
        else setMessage(enabled ? 'Proyecto agregado. Revisá su estado de sincronización.' : 'Seguimiento pausado. Tu copia y tus conversaciones se conservan en esta PC.');
      }
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
  const projects = [...local, ...remote].filter(p => { const text=(p.name+' '+p.owner).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); return words.every(w=>text.includes(w)); });
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
    <ul aria-label="Proyectos disponibles">{projects.map(p => {
      const status = p.localOnly || p.needsConfirmation || !p.local ? '' : p.removed ? 'Acceso retirado' : p.syncing || busy === p.id ? 'Sincronizando…' : !p.subscribed ? 'Pausado' : p.working ? 'En uso' : p.notice?.error || p.lastError ? 'Pendiente' : p.skipped?.length || p.notice?.skipped?.length ? 'Incompleto' : p.notice?.conflicts?.length ? 'Revisar cambios' : '';
      const attention=!!(p.removed||p.lastError||p.notice?.error||p.skipped?.length||p.notice?.conflicts?.length);
      return <li key={p.id}><span className="lab-shared-folder"><Folder size={22}/></span><div className="lab-shared-description"><strong>{p.name}</strong><div className="lab-shared-meta">{!p.localOnly && <span>Dueño: {p.owner || 'No disponible'}</span>}{status && <span className={'lab-shared-state'+(attention?' attention':p.subscribed?' following':'')}>{status}</span>}</div>
        {p.notice && <small>{noticeText(p.notice)}</small>}
        {p.lastError && !p.notice?.error && <small>{p.lastError}</small>}
        {!!p.skipped?.length && <small>{p.skipped.map(s => s.path + ': ' + s.reason).join(' · ')}</small>}
      </div><div className="lab-shared-actions">
        {p.local && <span className="lab-shared-added"><Check size={16}/>Agregado</span>}
        {!p.localOnly && !p.removed && <button className={'btn'+(!p.local?' lab-shared-primary':' lab-shared-secondary')} disabled={!!busy || p.syncing} onClick={() => void change(p, !p.subscribed)}>{busy === p.id ? 'Procesando…' : !p.local ? 'Agregar' : p.subscribed ? 'Pausar' : p.needsConfirmation ? 'Sincronizar' : 'Reanudar'}</button>}
      </div></li>;
    })}{!projects.length && !loading && <li>{query ? 'No hay proyectos que coincidan con tu búsqueda.' : 'No hay proyectos disponibles.'}</li>}</ul>
  </section></div>;
}
