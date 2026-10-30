import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { labRequest } from '../../api/lab';
import type { WorkspaceProject, SyncNotice } from '../../api/lab';
import './LabShare.css';

interface Member { username: string; displayName?: string | null; role: 'owner' | 'member' }
interface Suggestion { username: string; displayName?: string | null }
interface Sharing { shared: boolean; members: Member[]; owner?: string | null; mine?: boolean; removed?: boolean }

export const person = (username: string) => username.charAt(0).toUpperCase() + username.slice(1);

/** Una línea por aviso de sincronización: quién editó qué y qué quedó. */
export function noticeText(notice: SyncNotice): string {
  if (notice.error) return `No se pudo sincronizar: ${notice.error}`;
  if (!notice.conflicts.length) return notice.skipped?.length ? 'Sincronización parcial: ' + notice.skipped.map(s => s.path + ' (' + s.reason + ')').join(' · ') : 'Sincronización pendiente';
  const [first, ...rest] = notice.conflicts;
  const who = person(first.with);
  const line = first.kind === 'borrado-allá' ? `${who} borró ${first.path} y vos lo editaste: quedó tu versión`
    : first.kind === 'borrado-aquí' ? `Borraste ${first.path} y ${who} lo editó: quedó su versión`
    : `${who} y vos editaron ${first.path}: quedaron las dos versiones`;
  return rest.length ? `${line} (y ${rest.length} más)` : line;
}

export function LabShare({ project, onClose, onChanged }: { project: WorkspaceProject; onClose: () => void; onChanged: () => void }) {
  const [sharing, setSharing] = useState<Sharing | null>(null);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [options, setOptions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const picked = useRef('');   // lo último elegido de la lista: no vuelve a buscar por él
  const base = '/workspaces/' + encodeURIComponent(project.id);
  useEffect(() => {
    let alive = true;
    labRequest<Sharing>(base + '/sharing', undefined, 30000).then(s => { if (alive) setSharing(s); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [base]);
  // Sugerencias mientras escribe (2+ letras, ~150 ms de pausa); los que ya son miembros no se ofrecen. Si falla, queda el texto libre.
  const memberNames = sharing?.members.map(m => m.username).join(',') || '';
  useEffect(() => {
    const q = username.trim();
    setActive(-1);
    if (q.length < 2 || q === picked.current) { setOptions([]); return; }
    let alive = true;
    const timer = setTimeout(() => {
      labRequest<{ users?: Suggestion[] }>('/workspaces/users?q=' + encodeURIComponent(q), undefined, 15000)
        .then(r => { if (alive) setOptions((r?.users || []).filter(u => !memberNames.split(',').includes(u.username)).slice(0, 10)); })
        .catch(() => { if (alive) setOptions([]); });
    }, 150);
    return () => { alive = false; clearTimeout(timer); };
  }, [username, memberNames]);
  const pick = (u: Suggestion) => { picked.current = u.username; setUsername(u.username); setOptions([]); setActive(-1); };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!options.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i <= 0 ? options.length : i) - 1); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(options[active]); }
    else if (e.key === 'Escape') { e.stopPropagation(); setOptions([]); setActive(-1); }
  };
  const run = async (action: 'share' | 'unshare', name: string) => {
    setBusy(true); setError('');
    try { setSharing(await labRequest<Sharing>(base + '/' + action, { username: name }, 180000)); if (action === 'share') setUsername(''); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar el pedido.'); }
    finally { setBusy(false); }
  };
  const syncNow = async () => {
    setBusy(true); setError(''); setResult('');
    try {
      const r = await labRequest<{ pulled?: number; pushed?: number; conflicts?: unknown[]; busy?: boolean }>(base + '/sync', {}, 180000);
      setResult(r.busy ? 'Hay una respuesta en curso: se sincroniza al terminar.' : `Traídos ${r.pulled ?? 0} · enviados ${r.pushed ?? 0} · conflictos ${r.conflicts?.length ?? 0}`);
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo sincronizar.'); onChanged(); }
    finally { setBusy(false); }
  };
  const canEdit = !sharing?.shared || sharing.mine !== false;
  return <div className="lab-modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="lab-share-title" className="lab-create-project lab-share">
    <header><h2 id="lab-share-title">Compartir «{project.label}»</h2><button className="lab-icon" aria-label="Cerrar" onClick={onClose}><X size={19}/></button></header>
    {sharing?.removed && <p role="status">Ya no sos parte de este proyecto: tu copia queda como está.</p>}
    {sharing && sharing.members.length > 0 && <ul aria-label="Miembros">{sharing.members.map(m => <li key={m.username}>
      <span>{m.displayName || person(m.username)}<small>{m.username}{m.role === 'owner' ? ' · dueño' : ''}</small></span>
      {m.role !== 'owner' && canEdit && <button className="lab-icon" aria-label={'Quitar a ' + person(m.username)} disabled={busy} onClick={() => run('unshare', m.username)}><X size={16}/></button>}
    </li>)}</ul>}
    {canEdit && <form onSubmit={e => { e.preventDefault(); if (username.trim()) run('share', username.trim()); }}>
      <div className="lab-share-field">
        <label>Usuario de GaleCore<input autoFocus maxLength={32} value={username} onChange={e => setUsername(e.target.value)} onKeyDown={onKeyDown} placeholder="gonza" autoComplete="off"
          role="combobox" aria-expanded={options.length > 0} aria-controls="lab-share-options" aria-autocomplete="list" aria-activedescendant={active >= 0 ? 'lab-share-option-' + active : undefined}/></label>
        {options.length > 0 && <ul id="lab-share-options" role="listbox" aria-label="Usuarios sugeridos" className="lab-share-options">{options.map((u, i) =>
          <li key={u.username} id={'lab-share-option-' + i} role="option" aria-selected={i === active} onMouseDown={e => { e.preventDefault(); pick(u); }} onMouseEnter={() => setActive(i)}>
            <strong>{u.username}</strong>{u.displayName && <span>{u.displayName}</span>}
          </li>)}</ul>}
      </div>
      <button className="btn" disabled={busy || !username.trim()}>{busy ? 'Compartiendo…' : 'Compartir'}</button>
    </form>}
    {sharing?.shared && !sharing.removed && <div className="lab-share-sync">
      <button type="button" className="btn" disabled={busy} onClick={syncNow}>Sincronizar ahora</button>
      {result && <p role="status">{result}</p>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </section></div>;
}
