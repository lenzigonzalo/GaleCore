import React, { useState } from 'react';
import { saveSpaceItem, SpaceItem } from '../../api/space';

const LANGUAGES = ['español', 'English'];

export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (next: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="pref-switch" onClick={() => onChange(!on)}><i/></button>;
}

/**
 * Idioma de las respuestas. Es lo único del perfil que se elige acá: el resto (forma de responder, fuentes, límites)
 * lo resuelve el harness para todos. Se guarda al elegir y conserva el resto del perfil tal cual.
 */
export function LanguageSetting({ item, onChanged }: { item?: SpaceItem; onChanged: () => void }) {
  const profile: Record<string, any> | null = (() => { try { return item ? JSON.parse(item.content) : {}; } catch { return null; } })();
  const [language, setLanguage] = useState(typeof profile?.language === 'string' ? profile.language : '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  if (!profile) return <p role="alert">No se pudo interpretar el perfil guardado, así que el idioma no se puede cambiar desde acá.</p>;
  const options = language && !LANGUAGES.includes(language) ? [...LANGUAGES, language] : LANGUAGES;
  const choose = async (value: string) => {
    setLanguage(value); setState('saving');
    const next = { ...profile };
    if (value) next.language = value; else delete next.language;
    try {
      await saveSpaceItem('profile', item?.key || 'perfil', { title: item?.title || 'Mi perfil', content: JSON.stringify(next), format: 'json', visibility: item?.visibility || 'private' });
      setState('saved'); onChanged();
    } catch { setState('error'); }
  };
  return (
    <div className="prefs-row">
      <label htmlFor="profile-language">Idioma</label>
      <div className="settings-language">
        <small role="status">{state === 'saving' ? 'Guardando…' : state === 'saved' ? 'Guardado' : state === 'error' ? 'No se pudo guardar' : ''}</small>
        <select id="profile-language" aria-label="Idioma" value={language} onChange={e => { void choose(e.target.value); }}>
          {!language && <option value="">Sin definir</option>}
          {options.map(l => <option key={l} value={l}>{l.replace(/^\w/, c => c.toUpperCase())}</option>)}
        </select>
      </div>
    </div>
  );
}
