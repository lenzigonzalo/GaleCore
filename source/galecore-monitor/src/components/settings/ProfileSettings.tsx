import React, { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { deleteSpaceItem, keyFromTitle, saveSpaceItem, SpaceItem } from '../../api/space';

/**
 * Perfil (WS-0058): tres secciones y nada más. Nombre, Intereses y Memoria (ítems de título y un renglón que escribe
 * el usuario). Los tres entran en cada turno del chat; topes, objetivos y forma de entrega ya no son del perfil.
 * Usuario, email, idioma y contraseña están en Cuenta.
 */

export const NAME_KEY = 'como-te-llamo';
export const INTERESTS_KEY = 'intereses';
export const nameFrom = (item?: SpaceItem) => item?.content.match(/«(.+?)»/)?.[1] ?? '';

function MemoryEditor({ item, taken, onDone }: { item?: SpaceItem; taken: Set<string>; onDone: (saved: boolean) => void }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [content, setContent] = useState(item?.content ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    let key = item?.key ?? keyFromTitle(title.trim());
    if (!item && taken.has(key)) key = `${key.slice(0, 50)}-${Date.now().toString(36)}`;
    try {
      await saveSpaceItem('memory', key, { title: title.trim(), content: content.trim(), format: 'markdown', visibility: item?.visibility ?? 'private' });
      onDone(true);
    } catch { setError('No se pudo guardar'); }
  };
  return (
    <div className="prefs-block">
      <label htmlFor="memory-title">Título</label>
      <input id="memory-title" className="prefs-input" autoFocus maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="Ej.: Riesgo por posición" />
      <label htmlFor="memory-content">Un renglón</label>
      <input id="memory-content" className="prefs-input" maxLength={200} value={content} onChange={(e) => setContent(e.target.value)}
        placeholder="Ej.: nunca más del 20 % del riesgo del portfolio" />
      {error && <div className="settings-error" role="alert">{error}</div>}
      <div className="prefs-actions">
        <button className="settings-action" onClick={() => onDone(false)}>Cancelar</button>
        <button className="settings-action is-primary" disabled={!title.trim() || !content.trim()} onClick={() => void save()}>Guardar</button>
      </div>
    </div>
  );
}

export function ProfileSettings({ items, onChanged }: { items: SpaceItem[]; onChanged: () => void }) {
  const own = items.filter((i) => i.isOwn);
  const savedName = nameFrom(own.find((i) => i.kind === 'convention' && i.key === NAME_KEY));
  const savedInterests = own.find((i) => i.kind === 'convention' && i.key === INTERESTS_KEY)?.content ?? '';
  const memories = own.filter((i) => i.kind === 'memory');
  const [name, setName] = useState(savedName);
  const [interests, setInterests] = useState(savedInterests);
  const [state, setState] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => { setName(savedName); }, [savedName]);
  useEffect(() => { setInterests(savedInterests); }, [savedInterests]);

  const saveConvention = async (key: string, title: string, content: string) => {
    try {
      if (!content) await deleteSpaceItem('convention', key);
      else await saveSpaceItem('convention', key, { title, content, format: 'markdown', visibility: 'private' });
      setState('Guardado'); onChanged();
    } catch { setState(`No se pudo guardar ${title.toLowerCase()}`); }
  };
  const saveName = () => { if (name.trim() !== savedName) void saveConvention(NAME_KEY, 'Cómo te llamo', name.trim() ? `Llamame «${name.trim()}».` : ''); };
  const saveInterests = () => { if (interests.trim() !== savedInterests) void saveConvention(INTERESTS_KEY, 'Intereses', interests.trim()); };
  const done = (saved: boolean) => { setEditing(null); if (saved) onChanged(); };
  const remove = async (i: SpaceItem) => {
    setConfirming(null);
    try { await deleteSpaceItem('memory', i.key); onChanged(); } catch { setState('No se pudo borrar'); }
  };

  return (
    <div className="prefs">
      {state && <span role="status" className="prefs-state">{state}</span>}
      <section className="prefs-group">
        <h2>Nombre</h2>
        <div className="prefs-row">
          <label htmlFor="profile-name">¿Cómo querés que te llame?</label>
          <input id="profile-name" className="prefs-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={saveName} />
        </div>
      </section>

      <section className="prefs-group">
        <h2>Intereses</h2>
        <div className="prefs-block">
          <label htmlFor="profile-interests">Qué te interesa</label>
          <textarea id="profile-interests" className="prefs-textarea" rows={2} maxLength={300} value={interests} onChange={(e) => setInterests(e.target.value)}
            onBlur={saveInterests} placeholder="Ej.: opciones sobre SPY, volatilidad, resultados de empresas grandes" />
        </div>
      </section>

      <section className="prefs-group">
        <div className="prefs-heading"><h2>Memoria</h2><button className="settings-action" onClick={() => setEditing('__new__')}>+ Agregar</button></div>
        {editing === '__new__' && <MemoryEditor taken={new Set(memories.map((i) => i.key))} onDone={done} />}
        {memories.length === 0 && editing !== '__new__' && <p className="prefs-empty">Todavía no hay nada en la memoria. Cada ítem es un título y un renglón.</p>}
        <ul className="mem-list">
          {memories.map((i) => {
            if (editing === i.key) return <li key={i.key}><MemoryEditor item={i} taken={new Set()} onDone={done} /></li>;
            return (
              <li key={i.key} className="mem-item">
                <div className="mem-body"><strong>{i.title}</strong><div>{i.content}</div></div>
                <div className="mem-actions">
                  {confirming === i.key ? <>
                    <button className="settings-action" onClick={() => setConfirming(null)}>No</button>
                    <button className="settings-action is-danger" onClick={() => void remove(i)}>Borrar</button>
                  </> : <>
                    <button className="mem-icon" aria-label={`Editar ${i.title}`} onClick={() => setEditing(i.key)}><Pencil size={16} /></button>
                    <button className="mem-icon" aria-label={`Borrar ${i.title}`} onClick={() => setConfirming(i.key)}><Trash2 size={16} /></button>
                  </>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
