import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FilePlus, FileText, Folder, FolderOpen, FolderPlus, MoreHorizontal, RefreshCw, Upload } from 'lucide-react';
import { labRequest, labUpload, WorkspaceFile } from '../../api/lab';
import { LabMarkdown } from './LabMarkdown';

/**
 * Archivos del proyecto como un explorador (owner 17/10): abrir y editar texto, crear archivo o carpeta, subir,
 * renombrar y eliminar. Los registros JSON del harness se ven pero no se editan ni se borran desde acá.
 * Atajos: F2 renombra, Supr elimina, Ctrl+S guarda.
 */
type Pending = { kind: 'file' | 'folder'; parent: string } | null;
const parentOf = (p: string) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const readOnly = (p: string) => /\.json$/i.test(p);
const isMarkdown = (p: string) => /\.md$/i.test(p);
export function LabFiles({ projectId, folder, openPath }: { projectId: string; folder?: string; openPath?: string }) {
  const [tree, setTree] = useState<WorkspaceFile[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<{ path: string; kind: 'file' | 'folder'; text?: false } | null>(null);
  const [file, setFile] = useState<{ path: string; saved: string; text: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(false);   // WS-0045: los .md se abren para leer (tablas y gráficos)
  const upload = useRef<HTMLInputElement>(null);
  const base = '/workspaces/' + encodeURIComponent(projectId) + '/files';
  const reload = useCallback(async () => {
    try { setTree((await labRequest<{ tree: WorkspaceFile[] }>(base)).tree); }
    catch { setError('No se pudieron leer los archivos.'); }
  }, [base]);
  useEffect(() => { setTree([]); setSelected(null); setFile(null); setError(''); setOpen({}); reload(); }, [reload]);
  useEffect(() => { const close = () => setMenu(null); window.addEventListener('pointerdown', close); return () => window.removeEventListener('pointerdown', close); }, []);
  const act = async (op: string, body: object, done: string) => {
    setError(''); try { await labRequest(base + '/' + op, body); setStatus(done); await reload(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar.'); return false; }
  };
  const dirty = !!file && file.text !== file.saved;
  const openFile = async (node: WorkspaceFile) => {
    setSelected({ path: node.path, kind: 'file', text: node.text }); setError(''); setStatus('');
    if (node.text === false) { setFile(null); return; }
    if (dirty && !window.confirm('Hay cambios sin guardar. ¿Descartarlos?')) return;
    try { const f = await labRequest<{ text: string }>(base + '?path=' + encodeURIComponent(node.path)); setFile({ path: node.path, saved: f.text, text: f.text }); setEditing(!isMarkdown(node.path)); }
    catch (e) { setFile(null); setError(e instanceof Error ? e.message : 'Archivo no disponible.'); }
  };
  // Un enlace a un archivo del proyecto (desde el chat o desde otro archivo) lo abre acá, con sus carpetas desplegadas.
  const openByPath = (p: string) => {
    const parts = p.split('/'); setOpen(v => ({ ...v, ...Object.fromEntries(parts.slice(0, -1).map((_, i) => [parts.slice(0, i + 1).join('/'), true])) }));
    void openFile({ path: p, name: parts[parts.length - 1], kind: 'file' });
  };
  useEffect(() => { if (openPath) openByPath(openPath); }, [openPath]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => { if (!file || !dirty) return; if (await act('write', { path: file.path, text: file.text }, 'Guardado')) setFile({ ...file, saved: file.text }); };
  // Dónde se crea lo nuevo: la carpeta elegida, o la carpeta del archivo elegido.
  const target = selected ? (selected.kind === 'folder' ? selected.path : parentOf(selected.path)) : '';
  const startNew = (kind: 'file' | 'folder') => { setPending({ kind, parent: target }); setName(kind === 'file' ? 'nuevo.md' : 'nueva carpeta'); if (target) setOpen(v => ({ ...v, [target]: true })); };
  const create = async () => {
    if (!pending || !name.trim()) { setPending(null); return; }
    const p = (pending.parent ? pending.parent + '/' : '') + name.trim();
    const ok = pending.kind === 'file' ? await act('write', { path: p, text: '', create: true }, 'Archivo creado') : await act('mkdir', { path: p }, 'Carpeta creada');
    setPending(null);
    if (ok && pending.kind === 'file') { setSelected({ path: p, kind: 'file' }); setFile({ path: p, saved: '', text: '' }); }
  };
  const rename = async (from: string) => {
    const to = (parentOf(from) ? parentOf(from) + '/' : '') + name.trim(); setRenaming(null);
    if (!name.trim() || to === from) return;
    if (await act('rename', { from, to }, 'Renombrado')) { if (file?.path === from) setFile({ ...file, path: to }); if (selected?.path === from) setSelected({ ...selected, path: to }); }
  };
  const remove = async (p: string) => {
    setConfirm(null);
    if (await act('delete', { path: p }, 'Eliminado')) { if (file && (file.path === p || file.path.startsWith(p + '/'))) setFile(null); setSelected(null); }
  };
  const startRename = (p: string) => { if (readOnly(p)) { setError('Los registros JSON los escribe el harness; no se renombran desde Archivos.'); return; } setRenaming(p); setName(p.split('/').pop() || ''); };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || !selected) return;
    if (e.key === 'F2') { e.preventDefault(); startRename(selected.path); }
    if (e.key === 'Delete') { e.preventDefault(); setConfirm(selected.path); }
  };
  // Enter y la pérdida de foco que sigue confirman una sola vez.
  const settled = useRef(false);
  const nameInput = (onDone: () => void, onCancel: () => void) => {
    const once = (f: () => void) => { if (settled.current) return; settled.current = true; f(); };
    return <input className="lab-files-name" autoFocus value={name} aria-label="Nombre" onChange={e => setName(e.target.value)}
      onFocus={e => { settled.current = false; const dot = e.target.value.lastIndexOf('.'); e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length); }}
      onKeyDown={e => { if (e.key === 'Enter') once(onDone); if (e.key === 'Escape') once(onCancel); e.stopPropagation(); }} onBlur={() => once(onDone)} onClick={e => e.stopPropagation()}/>;
  };
  const newRow = (parent: string) => pending && pending.parent === parent && <li className="lab-files-row"><span className="lab-files-item">{pending.kind === 'folder' ? <Folder size={16}/> : <FileText size={16}/>}{nameInput(create, () => setPending(null))}</span></li>;
  const rows = (nodes: WorkspaceFile[], parent: string): React.ReactNode => <ul className="lab-files-tree">{newRow(parent)}{nodes.map(n => {
    const isOpen = !!open[n.path];
    return <li key={n.path}>
      <div className={'lab-files-row' + (selected?.path === n.path ? ' selected' : '')}
        onContextMenu={e => { e.preventDefault(); setSelected({ path: n.path, kind: n.kind, text: n.text }); setMenu({ path: n.path, x: e.clientX, y: e.clientY }); }}>
        <button type="button" className="lab-files-item" aria-expanded={n.kind === 'folder' ? isOpen : undefined}
          onClick={() => n.kind === 'folder' ? (setSelected({ path: n.path, kind: 'folder' }), setOpen(v => ({ ...v, [n.path]: !isOpen }))) : openFile(n)}
          onDoubleClick={() => startRename(n.path)}>
          {n.kind === 'folder' ? <>{isOpen ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}{isOpen ? <FolderOpen size={16}/> : <Folder size={16}/>}</> : <><i/><FileText size={16}/></>}
          {renaming === n.path ? nameInput(() => rename(n.path), () => setRenaming(null)) : <span>{n.name}</span>}
        </button>
        <button type="button" className="lab-files-more" aria-label={'Opciones de ' + n.name} onPointerDown={e => e.stopPropagation()}
          onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setSelected({ path: n.path, kind: n.kind, text: n.text }); setMenu(menu?.path === n.path ? null : { path: n.path, x: r.right - 160, y: r.bottom + 4 }); }}><MoreHorizontal size={15}/></button>
      </div>
      {n.kind === 'folder' && isOpen && rows(n.children || [], n.path)}
    </li>;
  })}</ul>;
  return <div className="lab-files" onKeyDown={onKey}>
    <aside className="lab-files-side">
      <div className="lab-files-toolbar">
        <button type="button" title="Nuevo archivo" aria-label="Nuevo archivo" onClick={() => startNew('file')}><FilePlus size={17}/></button>
        <button type="button" title="Nueva carpeta" aria-label="Nueva carpeta" onClick={() => startNew('folder')}><FolderPlus size={17}/></button>
        <button type="button" title="Subir archivos" aria-label="Subir archivos" onClick={() => upload.current?.click()}><Upload size={17}/></button>
        <button type="button" title="Actualizar" aria-label="Actualizar" onClick={reload}><RefreshCw size={16}/></button>
        <input ref={upload} type="file" multiple hidden onChange={async e => {
          const files = Array.from(e.target.files || []); e.target.value = ''; setError('');
          try { for (const f of files) await labUpload(projectId, f, target); setStatus(files.length === 1 ? 'Archivo subido' : files.length + ' archivos subidos'); if (target) setOpen(v => ({ ...v, [target]: true })); await reload(); }
          catch (err) { setError(err instanceof Error ? err.message : 'No se pudo subir.'); }
        }}/>
      </div>
      <div className="lab-files-where" title={folder}>{target ? target : folder || 'Carpeta del proyecto'}</div>
      <nav aria-label="Archivos del proyecto" className="lab-files-list" onClick={e => { if (e.target === e.currentTarget) setSelected(null); }}>{rows(tree, '')}{!tree.length && !pending && <p className="lab-files-empty">Sin archivos todavía.</p>}</nav>
    </aside>
    <section className="lab-files-main">
      {file ? <>
        <header><strong>{file.path}</strong>{readOnly(file.path) ? <span>Sólo lectura: lo escribe el harness</span> : <span>{dirty ? 'Sin guardar' : status === 'Guardado' ? 'Guardado' : ''}</span>}{isMarkdown(file.path) && <button type="button" className="lab-files-save" onClick={() => setEditing(!editing)}>{editing ? 'Leer' : 'Editar'}</button>}{!readOnly(file.path) && editing && <button type="button" className="lab-files-save" disabled={!dirty} onClick={save}>Guardar</button>}</header>
        {isMarkdown(file.path) && !editing ? <div className="lab-files-read"><LabMarkdown text={file.text} files={{ folder: folder || '.', open: openByPath }} /></div> : <textarea className="lab-files-editor" spellCheck={false} readOnly={readOnly(file.path)} value={file.text} aria-label={'Contenido de ' + file.path}
          onChange={e => setFile({ ...file, text: e.target.value })}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } }}/>}
      </> : <div className="lab-files-blank"><Folder size={30}/><p>{selected?.text === false ? 'Este archivo no se puede ver acá. Podés renombrarlo o eliminarlo.' : 'Elegí un archivo para verlo y editarlo.'}</p><span>Clic derecho o ⋯ para renombrar o eliminar · F2 renombra · Supr elimina</span></div>}
      {error && <p className="lab-files-error" role="alert">{error}</p>}
    </section>
    {menu && <div className="lab-files-menu" role="menu" style={{ left: Math.max(8, menu.x), top: menu.y }} onPointerDown={e => e.stopPropagation()}>
      <button role="menuitem" onClick={() => { const p = menu.path; setMenu(null); startRename(p); }}>Renombrar</button>
      <button role="menuitem" className="danger" onClick={() => { setConfirm(menu.path); setMenu(null); }}>Eliminar</button>
    </div>}
    {confirm && <div className="lab-modal-backdrop" onPointerDown={() => setConfirm(null)}><section role="dialog" aria-modal="true" aria-labelledby="lab-files-confirm" className="lab-confirm" onPointerDown={e => e.stopPropagation()}>
      <h2 id="lab-files-confirm">¿Eliminar «{confirm.split('/').pop()}»?</h2><p>Se borra de la carpeta del proyecto. Si ya estaba guardado en la memoria, queda en su historial.</p>
      <div><button type="button" onClick={() => setConfirm(null)}>Cancelar</button><button type="button" className="danger" autoFocus onClick={() => remove(confirm)}>Eliminar</button></div>
    </section></div>}
  </div>;
}
