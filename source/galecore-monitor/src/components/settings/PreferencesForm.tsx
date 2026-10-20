import React, { useEffect, useRef, useState } from 'react';
import { saveSpaceItem, SpaceItem } from '../../api/space';

/**
 * Preferencias (como «Personalización» de ChatGPT o de Claude): cada cosa es una opción para elegir, no una caja de
 * texto. Se guarda sola al cambiar. Lo que esta pantalla no muestra (capital, horizonte, límites, reglas, lo que
 * agregue el chat) queda en el perfil tal cual: se conserva en cada guardado.
 */
type Profile = Record<string, any>;

const LANGUAGES = ['español', 'English'];

/** Cada opción de respuesta es una línea de «forma de entrega» del perfil; `match` reconoce la que ya existe. */
const STYLE: { id: string; label: string; hint: string; line: string; match: RegExp }[] = [
  { id: 'conclusion', label: 'Empezar por la conclusión', hint: 'La primera línea es la respuesta; después, lo que la sostiene.',
    line: 'toda respuesta empieza por la conclusión en una línea', match: /conclusi[oó]n/i },
  { id: 'tables', label: 'Tablas y gráficos antes que texto', hint: 'Los números en tablas; texto mínimo.',
    line: 'tablas y gráficos primero, texto mínimo', match: /tabla|gr[aá]fico/i },
  { id: 'label', label: 'Decir si es SHADOW o cuenta real', hint: 'Todo monto o resultado de una estrategia lleva su etiqueta.',
    line: 'todo monto, resultado o riesgo de una estrategia dice si es SHADOW (simulado) o cuenta real', match: /SHADOW/ },
];

/** Fuentes de datos que GaleCore-AI puede consultar (las de config/sources.yaml), en el orden en que se prefieren. */
export const SOURCES: { id: string; label: string; hint: string }[] = [
  { id: 'galecore', label: 'GaleCore', hint: 'Tu cuenta, cadenas de opciones, GEX, volatilidad, SHADOW y macro.' },
  { id: 'fred', label: 'FRED', hint: 'Tasas, inflación, empleo y calendario macro de la Reserva Federal.' },
  { id: 'alpha_vantage', label: 'Alpha Vantage', hint: 'Resultados, fundamentales e históricos de opciones.' },
  { id: 'fmp', label: 'Financial Modeling Prep', hint: 'Fundamentales, estimaciones y calendario de resultados.' },
];

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : typeof value === 'string' && value.trim() ? value.split('\n').filter(Boolean) : [];

export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (next: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="pref-switch" onClick={() => onChange(!on)}><i/></button>;
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <div className="pref-row"><div><b>{title}</b>{hint && <small>{hint}</small>}</div>{children}</div>;
}

export function PreferencesForm({ item, onChanged }: { item?: SpaceItem; onChanged: () => void }) {
  const original: Profile | null = (() => { try { return item ? JSON.parse(item.content) : {}; } catch { return null; } })();
  const [profile, setProfile] = useState<Profile>(original ?? {});
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!original) return <p role="alert">No se pudo interpretar el perfil guardado. Recuperalo desde el chat antes de editarlo.</p>;

  const save = async (next: Profile) => {
    setState('saving');
    try {
      await saveSpaceItem('profile', item?.key || 'perfil', { title: item?.title || 'Mi perfil', content: JSON.stringify(next), format: 'json', visibility: item?.visibility || 'private' });
      setState('saved'); onChanged();
    } catch { setState('error'); }
  };
  // Los cambios seguidos (varios interruptores) se guardan juntos: un solo guardado, una sola versión del perfil.
  const change = (patch: Profile) => {
    const next = { ...profile, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    setProfile(next); setState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(next); }, 600);
  };

  const lines = asList(profile.delivery_format);
  const styleOn = (s: typeof STYLE[number]) => lines.some(line => s.match.test(line));
  const setStyle = (s: typeof STYLE[number], on: boolean) =>
    change({ delivery_format: on ? [...lines, s.line] : lines.filter(line => !s.match.test(line)) });
  const sources = asList(profile.preferred_sources);
  const setSource = (id: string, on: boolean) => change({ preferred_sources: on ? [...sources, id] : sources.filter(s => s !== id) });
  const language = typeof profile.language === 'string' && profile.language ? profile.language : '';
  const languages = language && !LANGUAGES.includes(language) ? [...LANGUAGES, language] : LANGUAGES;

  return <div className="pref-form">
    <section className="pref-group">
      <h2>Respuestas</h2>
      <Row title="Idioma" hint="En el que responde GaleCore-AI.">
        <select aria-label="Idioma" value={language} onChange={e => change({ language: e.target.value || undefined })}>
          {!language && <option value="">Sin definir</option>}
          {languages.map(l => <option key={l} value={l}>{l.replace(/^\w/, c => c.toUpperCase())}</option>)}
        </select>
      </Row>
      {STYLE.map(s => <Row key={s.id} title={s.label} hint={s.hint}><Switch on={styleOn(s)} label={s.label} onChange={on => setStyle(s, on)}/></Row>)}
    </section>
    <section className="pref-group">
      <h2>Fuentes de datos</h2>
      <p className="pref-intro">GaleCore-AI usa primero las que dejes activas. GaleCore es la fuente propia y va primero.</p>
      {SOURCES.map(s => <Row key={s.id} title={s.label} hint={s.hint}><Switch on={sources.includes(s.id)} label={s.label} onChange={on => setSource(s.id, on)}/></Row>)}
    </section>
    <p className="pref-state" role="status">{state === 'saving' ? 'Guardando…' : state === 'saved' ? 'Guardado.' : state === 'error' ? 'No se pudo guardar. Probá de nuevo.' : ''}</p>
  </div>;
}
