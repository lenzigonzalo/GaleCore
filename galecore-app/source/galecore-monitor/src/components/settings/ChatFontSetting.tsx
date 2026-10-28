import React, { useEffect, useState } from 'react';
import { fetchSpace, saveSpaceItem, SpaceItem } from '../../api/space';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';

const KEY = 'tamano-chat';
const EVENT = 'galecore:chat-font-size';
const SIZES = [14, 16, 18, 20, 22];
function readSize(items: SpaceItem[]): string {
  try {
    const size = JSON.parse(items.find(i => i.kind === 'preference' && i.key === KEY)?.content || '{}').size;
    return SIZES.includes(size) ? String(size) : '';
  } catch { return ''; }
}

export function useChatFontSize() {
  const user = useCurrentUserStore(s => s.user);
  const [size, setSize] = useState('');
  useEffect(() => {
    let active = true, changed = false;
    setSize('');
    const update = (event: Event) => { changed = true; setSize((event as CustomEvent<string>).detail); };
    window.addEventListener(EVENT, update);
    fetchSpace().then(data => { if (active && !changed) setSize(readSize(data.items)); }).catch(() => {});
    return () => { active = false; window.removeEventListener(EVENT, update); };
  }, [user]);
  return size ? size + 'px' : undefined;
}

export function ChatFontSetting({ items, onChanged }: { items: SpaceItem[]; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const choose = async (value: string) => {
    setSaving(true); setError(false);
    try {
      await saveSpaceItem('preference', KEY, { title: 'Tamaño del texto del chat', content: JSON.stringify({ size: value ? Number(value) : null }), format: 'json', visibility: 'private' });
      window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
      onChanged();
    } catch { setError(true); }
    finally { setSaving(false); }
  };
  return <div className="prefs-row">
    <label htmlFor="chat-font-size">Tamaño del texto del chat<small>Mensajes y cuadro de escritura</small></label>
    <div className="settings-language">
      <small role="status">{saving ? 'Guardando…' : error ? 'No se pudo guardar' : ''}</small>
      <select id="chat-font-size" value={readSize(items)} disabled={saving} onChange={e => { void choose(e.target.value); }}>
        <option value="">Predeterminado (18 px; 16 px en móvil)</option>
        {SIZES.map(size => <option key={size} value={size}>{size} px</option>)}
      </select>
    </div>
  </div>;
}
