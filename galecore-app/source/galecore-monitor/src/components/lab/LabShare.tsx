import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { labRequest } from '../../api/lab';
import type { WorkspaceProject, SyncNotice } from '../../api/lab';
import './LabShare.css';

interface Member { username: string; displayName?: string | null; role: 'owner' | 'member' }
interface Suggestion { username: string; displayName?: string | null }
type Access = 'restricted' | 'everyone';
interface Sharing { shared: boolean; members: Member[]; owner?: string | null; mine?: boolean; removed?: boolean; access?: Access; notice?: string | SyncNotice | null }

const ACCESS: Record<Access, { label: string; hint: string; done: string }> = {
  restricted: { label: 'Restringido', hint: 'Sólo las personas agregadas pueden abrirlo.', done: 'sólo las personas agregadas tienen acceso' },
  everyone: { label: 'Todos los usuarios de GaleCore', hint: 'Cualquiera lo puede agregar a su Lab.', done: 'cualquier usuario de GaleCore lo puede agregar a su Lab' },
};

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
  // Sugerencias mientras escribe (2+ letras, ~150 ms de pausa); los que ya tienen acceso no se ofrecen. Si falla, queda el texto libre.
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
  // Cada cambio se aplica al instante y se confirma con «Listo: …».
  const apply = async (path: string, body: object, done: string) => {
    setBusy(true); setError(''); setResult('');
    try { setSharing(await labRequest<Sharing>(base + path, body, 180000)); setResult('Listo: ' + done); onChanged(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar el pedido.'); return false; }
    finally { setBusy(false); }
  };
  const add = async (name: string) => {
    const user = name.trim(); if (!user) return;
    picked.current = user; setOptions([]);
    if (await apply('/share', { username: user }, person(user) + ' ya tiene acceso')) setUsername('');
  };
  const pick = (u: Suggestion) => { setActive(-1); void add(u.username); };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!options.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i <= 0 ? options.length : i) - 1); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(options[active]); }
    else if (e.key === 'Escape') { e.stopPropagation(); setOptions([]); setActive(-1); }
  };
  const canEdit = !sharing?.shared || sharing.mine !== false;
  const access: Access = sharing?.access === 'everyone' ? 'everyone' : 'restricted';
  const members = sharing ? [...sharing.members].sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner')) : [];
  const notice = sharing?.notice && (typeof sharing.notice === 'string' ? sharing.notice : noticeText(sharing.notice));
  return <div className="lab-modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="lab-share-title" className="lab-create-project lab-share">
    <header><h2 id="lab-share-title">Compartir «{project.label}»</h2><button className="lab-icon" aria-label="Cerrar" onClick={onClose}><X size={19}/></button></header>
    {sharing?.removed && <p role="status">Ya no sos parte de este proyecto: tu copia queda como está.</p>}
    {canEdit && <section>
      <h3>Agregar personas</h3>
      <form onSubmit={e => { e.preventDefault(); void add(username); }}>
        <div className="lab-share-field">
          <input autoFocus aria-label="Agregar personas por usuario o mail" maxLength={80} value={username} onChange={e => { picked.current = ''; setUsername(e.target.value); }} onKeyDown={onKeyDown} placeholder="Usuario o mail" autoComplete="off"
            role="combobox" aria-expanded={options.length > 0} aria-controls="lab-share-options" aria-autocomplete="list" aria-activedescendant={active >= 0 ? 'lab-share-option-' + active : undefined}/>
          {options.length > 0 && <ul id="lab-share-options" role="listbox" aria-label="Usuarios sugeridos" className="lab-share-options">{options.map((u, i) =>
            <li key={u.username} id={'lab-share-option-' + i} role="option" aria-selected={i === active} onMouseDown={e => { e.preventDefault(); pick(u); }} onMouseEnter={() => setActive(i)}>
              <strong>{u.username}</strong>{u.displayName && <span>{u.displayName}</span>}
            </li>)}</ul>}
        </div>
        <button className="btn" disabled={busy || !username.trim()}>{busy ? 'Agregando…' : 'Agregar'}</button>
      </form>
    </section>}
    {members.length > 0 && <section>
      <h3>Personas con acceso</h3>
      <ul aria-label="Personas con acceso">{members.map(m => <li key={m.username}>
        <span>{m.displayName || person(m.username)}<small>{m.username}{m.role === 'owner' ? ' · dueño' : ''}</small></span>
        {m.role !== 'owner' && canEdit && <button className="btn" aria-label={'Quitar a ' + person(m.username)} disabled={busy} onClick={() => void apply('/unshare', { username: m.username }, person(m.username) + ' ya no tiene acceso')}>Quitar</button>}
      </li>)}</ul>
    </section>}
    {sharing && <section>
      <h3>Acceso general</h3>
      {canEdit
        ? <select aria-label="Acceso general" value={access} disabled={busy} onChange={e => { const next = e.target.value as Access; void apply('/access', { access: next }, ACCESS[next].done); }}>
            {(Object.keys(ACCESS) as Access[]).map(a => <option key={a} value={a}>{ACCESS[a].label}</option>)}
          </select>
        : <strong>{ACCESS[access].label}</strong>}
      <p>{ACCESS[access].hint}</p>
    </section>}
    {notice && <p role="status">{notice}</p>}
    {result && <p role="status">{result}</p>}
    {error && <p role="alert">{error}</p>}
  </section></div>;
}
