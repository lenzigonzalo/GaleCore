import React, { useEffect, useState } from 'react';
import { fetchSpace, saveSpaceItem, SpaceItem } from '../../api/space';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';

/**
 * Tamaño del texto de la watchlist y del chat, cada uno una preferencia propia del usuario. El predeterminado es el
 * que ya tiene la pantalla sin preferencia; el resto de la plataforma no se escala.
 */
export type TextSizeKind = 'watchlist' | 'chat';
const KINDS: Record<TextSizeKind, { key: string; title: string; label: string; hint: string; min: number; max: number; fallback: string }> = {
  watchlist: { key: 'tamano-watchlist', title: 'Tamaño del texto de la watchlist', label: 'Watchlist', hint: 'Lista de símbolos del panel lateral', min: 9, max: 24, fallback: '13' },
  chat: { key: 'tamano-chat', title: 'Tamaño del texto del chat', label: 'Chat', hint: 'Mensajes y cuadro de escritura', min: 12, max: 32, fallback: '18' },
};
const eventName = (kind: TextSizeKind) => 'galecore:text-size-' + kind;
function readSize(items: SpaceItem[], kind: TextSizeKind): string {
  const { key, min, max } = KINDS[kind];
  try {
    const size = JSON.parse(items.find(i => i.kind === 'preference' && i.key === key)?.content || '{}').size;
    return Number.isInteger(size) && size >= min && size <= max ? String(size) : '';
  } catch { return ''; }
}

/** Tamaño elegido en px (undefined = predeterminado); se actualiza al instante cuando se cambia en Configuración. */
export function useTextSize(kind: TextSizeKind): number | undefined {
  const user = useCurrentUserStore(s => s.user);
  const [size, setSize] = useState('');
  useEffect(() => {
    let active = true, changed = false;
    setSize('');
    const update = (event: Event) => { changed = true; setSize((event as CustomEvent<string>).detail); };
    window.addEventListener(eventName(kind), update);
    fetchSpace().then(data => { if (active && !changed) setSize(readSize(data.items, kind)); }).catch(() => {});
    return () => { active = false; window.removeEventListener(eventName(kind), update); };
  }, [user, kind]);
  return size ? Number(size) : undefined;
}

/** Aplica el tamaño de la watchlist en la raíz (`--watchlist-font-size`); el del chat lo aplica el Lab. */
export function useApplyTextSizes() {
  const watchlist = useTextSize('watchlist');
  useEffect(() => {
    document.documentElement.style.setProperty('--watchlist-font-size', watchlist ? `${watchlist}px` : '');
  }, [watchlist]);
}

function TextSizeRow({ kind, items, onChanged }: { kind: TextSizeKind; items: SpaceItem[]; onChanged: () => void }) {
  const { key, title, label, hint, min, max, fallback } = KINDS[kind];
  const saved = readSize(items, kind);
  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setValue(saved); }, [saved]);
  const commit = async () => {
    const text = value.trim();
    if (text === saved) { setError(''); return; }
    const size = Number(text);
    if (text && !(Number.isInteger(size) && size >= min && size <= max)) { setError(`Entre ${min} y ${max}`); return; }
    setSaving(true); setError('');
    try {
      await saveSpaceItem('preference', key, { title, content: JSON.stringify({ size: text ? size : null }), format: 'json', visibility: 'private' });
      window.dispatchEvent(new CustomEvent(eventName(kind), { detail: text }));
      onChanged();
    } catch { setError('No se pudo guardar'); setValue(saved); }
    finally { setSaving(false); }
  };
  return <div className="prefs-row">
    <label htmlFor={'text-size-' + kind}><strong>{label}</strong><small>{hint} · vacío = predeterminado ({fallback} px)</small></label>
    <div className="settings-language">
      <small role="status">{saving ? 'Guardando…' : error}</small>
      <input id={'text-size-' + kind} className="prefs-input prefs-number" type="number" inputMode="numeric" min={min} max={max} step={1}
        placeholder={fallback} value={value} disabled={saving}
        onChange={e => setValue(e.target.value)} onBlur={() => { void commit(); }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <span>px</span>
    </div>
  </div>;
}

export function TextSizeSettings({ items, onChanged }: { items: SpaceItem[]; onChanged: () => void }) {
  return <div className="prefs-block">
    <strong>Tamaño del texto</strong>
    {(['watchlist', 'chat'] as TextSizeKind[]).map(kind => <TextSizeRow key={kind} kind={kind} items={items} onChanged={onChanged} />)}
  </div>;
}
