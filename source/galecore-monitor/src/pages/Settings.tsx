import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, BookOpen, Brain, Lock, Pencil, Plug, Power, Trash2, User, Users } from 'lucide-react';
import { Connections } from '../components/settings/Connections';
import { PlatformServices } from '../components/settings/PlatformServices';
import './Settings.css';
import { LocalMcp } from '../components/settings/LocalMcp';
import { LanguageSetting } from '../components/settings/LanguageSetting';
import { ProfileSettings, NAME_KEY } from '../components/settings/ProfileSettings';
import { StrikeAlertForm } from '../components/settings/StrikeAlertForm';
import { SUGGESTIONS_KEY, suggestionsEnabled, saveSuggestionsEnabled } from '../components/lab/LabSuggestions';
import { STRIKE_ALERT_KEY } from '../api/account';
import { MyPasswordCard } from '../components/account/MyPasswordCard';
import { Markdown } from '../components/settings/Markdown';
import { useCurrentUserStore } from '../store/useCurrentUserStore';
import {
  SpaceItem, SpaceKind, deleteSpaceItem, fetchSpace, keyFromTitle, saveSpaceItem,
} from '../api/space';

/**
 * Configuración (GC-0007): todo lo que es de la persona, con navegación lateral, como la de cualquier app de IA.
 *
 *   GENERAL          perfil (cuenta, idioma y perfil de trading) · contraseña · avisos
 *   CONEXIONES       IA, GaleCore, bróker
 *   MEMORIA          cómo trabajás, preferencias y recuerdos · skills
 *   EQUIPO           compartido conmigo (sólo si alguien compartió algo)
 *   PLATAFORMA       estado de los servicios (admin)
 *
 * Nada se muestra como JSON ni como caja libre cuando se puede elegir: las opciones son interruptores y listas, y se
 * guardan solas. El estado vive en esta pantalla (no en un store de módulo): muere con la sesión.
 */
export type Section = 'mcp-local' | 'conexiones' | 'usuario' | 'contrasena' | 'broker' | 'memoria' | 'skills'
  | 'compartido' | 'avisos' | 'servicios';

const NAV: { group: string; items: { id: Section; label: string; Icon: React.ComponentType<{ size?: number }> }[] }[] = [
  { group: 'General', items: [{ id: 'usuario', label: 'Perfil', Icon: User }, { id: 'contrasena', label: 'Contraseña', Icon: Lock }, { id: 'avisos', label: 'Avisos', Icon: Bell }] },
  { group: 'Proveedores de IA', items: [{ id: 'conexiones', label: 'Proveedores de IA', Icon: Plug }] },
  { group: 'Memoria', items: [{ id: 'memoria', label: 'Memoria', Icon: Brain }, { id: 'skills', label: 'Skills', Icon: BookOpen }] },
  { group: 'Equipo', items: [{ id: 'compartido', label: 'Compartido conmigo', Icon: Users }] },
  { group: 'Plataforma', items: [{ id: 'servicios', label: 'Servicios', Icon: Power }] },
];

const SECTION_KIND: Partial<Record<Section, SpaceKind>> = { memoria: 'memory', skills: 'skill' };

const INTRO: Partial<Record<Section, string>> = {
  servicios: 'Lo que GaleCore corre solo, para todos: no lo crea el usuario. Tus tareas están en Agentes y las estrategias en Estrategias.',
  memoria: 'Lo que GaleCore-AI tiene en cuenta en cada chat. También se agrega desde el chat («acordate de…»).',
  skills: 'Lo que GaleCore-AI sabe hacer. Las de la plataforma se leen; las tuyas se crean y se editan acá, y el chat las usa sin nombrarlas.',
  avisos: 'Avisos de la cuenta real que suenan en la campana.',
  compartido: 'Lo que otros del equipo compartieron. Se lee, no se edita.',
};

// ── estilos ─────────────────────────────────────────────────────

const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)', borderRadius: 12, padding: '20px 22px',
};
const btn = (primary = false): React.CSSProperties => ({
  fontSize: 14, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-sans)',
  border: `1px solid ${primary ? 'var(--accent)' : 'var(--border)'}`,
  backgroundColor: primary ? 'var(--accent)' : 'transparent', color: primary ? 'var(--accent-ink)' : 'var(--text-secondary)',
});
const field: React.CSSProperties = {
  width: '100%', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-dark)',
  borderRadius: 8, padding: '10px 12px', fontSize: 15, fontFamily: 'var(--font-sans)',
};
const muted: React.CSSProperties = { fontSize: 14, color: 'var(--text-muted)' };

const parse = (s: string): any => { try { return JSON.parse(s); } catch { return null; } };
const human = (k: string) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
function ReadableValue({ value }: { value: unknown }): React.ReactElement {
  if (value === null || value === undefined) return <span>—</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Sí' : 'No'}</span>;
  if (Array.isArray(value)) return <ul>{value.map((item, index) => <li key={index}><ReadableValue value={item}/></li>)}</ul>;
  if (typeof value === 'object') return <dl>{Object.entries(value).map(([key, item]) => <div key={key}><dt>{human(key)}</dt><dd><ReadableValue value={item}/></dd></div>)}</dl>;
  return <span>{String(value)}</span>;
}

function Visibility({ item }: { item: SpaceItem }) {
  const shared = item.visibility === 'shared';
  return (
    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 4, whiteSpace: 'nowrap',
      color: shared ? 'var(--green)' : 'var(--text-muted)', border: `1px solid ${shared ? 'var(--green-border)' : 'var(--border-dark)'}` }}>
      {item.isOwn ? (shared ? 'Compartida' : 'Sólo vos') : `De ${item.owner}`}
    </span>
  );
}

// ── vistas legibles por tipo ────────────────────────────────────

function ConventionBody({ item }: { item: SpaceItem }) {
  const d = item.format === 'json' ? parse(item.content) : null;
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', rowGap: 6, fontSize: 13 }}>
        {Object.entries(d).map(([k, v]) => (
          <React.Fragment key={k}>
            <div style={{ color: 'var(--text-muted)' }}>{human(k)}</div>
            <div style={{ color: 'var(--text-primary)' }}><ReadableValue value={v}/></div>
          </React.Fragment>
        ))}
      </div>
    );
  }
  return <Markdown text={item.content} />;
}

// ── memoria (WS-0057 A, como Configuración de claude.ai): cómo trabajás, preferencias y recuerdos ──
// «Cómo te llamo» e «Instrucciones» son convenciones: entran enteras en cada chat. Las notas son recuerdos. Los objetivos
// viven en el perfil y no se repiten acá.

const INSTRUCTIONS_KEY = 'instrucciones';
const PREF_LABELS: Record<string, string> = {
  timezone: 'Zona horaria', currency: 'Moneda', precision_decimal_places: 'Decimales',
  gex_near_zero_threshold_pct: 'Umbral de GEX «cerca de cero» (%)',
};

function MemoryEditor({ item, taken, onDone }: { item?: SpaceItem; taken: Set<string>; onDone: (saved: boolean) => void }) {
  const [content, setContent] = useState(item?.content ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const title = item?.title ?? content.trim().split('\n')[0].slice(0, 60);
    let key = item?.key ?? keyFromTitle(title);
    if (!item && taken.has(`memory/${key}`)) key = `${key.slice(0, 50)}-${Date.now().toString(36)}`;
    try {
      await saveSpaceItem(item?.kind ?? 'memory', key, { title, content: content.trim(), format: 'markdown', visibility: item?.visibility ?? 'private' });
      onDone(true);
    } catch (e: any) { setError(e?.response?.data?.error ?? 'No se pudo guardar'); }
  };
  return (
    <div className="mem-editor">
      <textarea autoFocus rows={3} aria-label="Contenido" value={content} onChange={(e) => setContent(e.target.value)}
        placeholder="Ej.: prefiero vencimientos de 30 a 45 días" />
      <div className="mem-editor-bar">
        <span style={{ flex: 1 }} />
        <button className="settings-action" onClick={() => onDone(false)}>Cancelar</button>
        <button className="settings-action is-primary" disabled={!content.trim()} onClick={save}>Guardar</button>
      </div>
      {error && <div className="settings-error" role="alert">{error}</div>}
    </div>
  );
}

function MemoryView({ items, onChanged }: { items: SpaceItem[]; onChanged: () => void }) {
  const own = useMemo(() => items.filter((i) => i.isOwn), [items]);
  // Instrucciones: la pieza propia o, si todavía no existe, la convención escrita que ya tenías (no se duplica).
  const instructions = own.find((i) => i.kind === 'convention' && i.key === INSTRUCTIONS_KEY)
    ?? own.find((i) => i.kind === 'convention' && i.format !== 'json' && i.key !== NAME_KEY);
  const prefs = own.filter((i) => i.kind === 'convention' && i.format === 'json');
  const memories = useMemo(() => own.filter((i) => i.kind === 'memory'), [own]);
  const [text, setText] = useState(instructions?.content ?? '');
  const [state, setState] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const savedText = instructions?.content ?? '';
  useEffect(() => { setText(savedText); }, [savedText]);
  const taken = useMemo(() => new Set(memories.map((i) => `memory/${i.key}`)), [memories]);
  const saveInstructions = async () => {
    try {
      await saveSpaceItem('convention', instructions?.key ?? INSTRUCTIONS_KEY, {
        title: instructions?.title ?? 'Instrucciones', content: text.trim(), format: 'markdown', visibility: instructions?.visibility ?? 'private' });
      setState('Instrucciones guardadas'); onChanged();
    } catch { setState('No se pudieron guardar las instrucciones'); }
  };
  const done = (saved: boolean) => { setEditing(null); if (saved) onChanged(); };
  const remove = async (i: SpaceItem) => { setConfirming(null); await deleteSpaceItem(i.kind, i.key); onChanged(); };
  return (
    <div className="prefs">
      <section className="prefs-group">
        <h2>Instrucciones</h2>
        <div className="prefs-block">
          <label htmlFor="mem-instructions">Instrucciones para GaleCore-AI</label>
          <small>Las tiene en cuenta en todos los chats y agentes: cómo querés las respuestas, qué evitar, cómo trabajás.</small>
          <textarea id="mem-instructions" className="prefs-textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Ej.: empezá por la conclusión en una línea y seguí con una tabla; todo monto de estrategia dice si es SHADOW o cuenta real." />
          <div className="prefs-actions">
            {state && <span role="status" className="prefs-state">{state}</span>}
            <button className="settings-action" disabled={text === savedText} onClick={() => setText(savedText)}>Descartar</button>
            <button className="settings-action is-primary" disabled={!text.trim() || text === savedText} onClick={() => void saveInstructions()}>Guardar</button>
          </div>
        </div>
      </section>

      {prefs.length > 0 && <section className="prefs-group">
        <h2>Preferencias</h2>
        {prefs.map((p) => {
          const d = parse(p.content);
          return d && typeof d === 'object' && !Array.isArray(d) ? Object.entries(d).map(([k, v]) => (
            <div className="prefs-row" key={`${p.key}/${k}`}><span>{PREF_LABELS[k] ?? human(k)}</span><strong className="tabular-nums">{String(v)}</strong></div>
          )) : null;
        })}
      </section>}

      <section className="prefs-group">
        <div className="prefs-heading"><h2>Recuerdos</h2><button className="settings-action" onClick={() => setEditing('__new__')}>+ Agregar</button></div>
        {editing === '__new__' && <MemoryEditor taken={taken} onDone={done} />}
        {memories.length === 0 && editing !== '__new__' && <p className="prefs-empty">Todavía no hay recuerdos. Pedile al chat «acordate de…» o agregalo acá.</p>}
        <ul className="mem-list">
          {memories.map((i) => {
            const id = `${i.kind}/${i.key}`;
            if (editing === id) return <li key={id}><MemoryEditor item={i} taken={taken} onDone={done} /></li>;
            return (
              <li key={id} className="mem-item">
                <div className="mem-body"><Markdown text={i.content} /></div>
                <div className="mem-actions">
                  {confirming === id ? <>
                    <button className="settings-action" onClick={() => setConfirming(null)}>No</button>
                    <button className="settings-action is-danger" onClick={() => void remove(i)}>Borrar</button>
                  </> : <>
                    <button className="mem-icon" aria-label="Editar" onClick={() => setEditing(id)}><Pencil size={16} /></button>
                    <button className="mem-icon" aria-label="Borrar" onClick={() => setConfirming(id)}><Trash2 size={16} /></button>
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

// La plantilla de una skill (WS-0054): la primera línea dice qué pedido atiende; el chat la ve en tu espacio.
const SKILL_TEMPLATE = `Qué pedido atiende y cuándo no usarla.

## Cuándo se usa
Pedidos típicos, con tus palabras.

## Qué necesita
Qué datos de GaleCore usa y qué hacer si falta alguno.

## Pasos
1. Primer paso, con el dato que trae.
2. Segundo paso.

## Qué entrega
La forma de la respuesta y un ejemplo corto.

## Errores a evitar
- Lo que no tiene que hacer.

## Cómo responder
El dato principal primero; después la forma (conclusión, tabla).
`;

function SkillsView({ items, onChanged }: { items: SpaceItem[]; onChanged: () => void }) {
  const mine = items.filter((i) => i.visibility === 'private');
  const product = items.filter((i) => i.visibility !== 'private');
  const [selected, setSelected] = useState<string | null>(mine[0]?.key ?? product[0]?.key ?? null);
  const [tab, setTab] = useState<'texto' | 'markdown'>('texto');
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const skill = creating ? undefined : items.find((i) => i.key === selected) ?? items[0];
  const editable = !!skill && skill.isOwn && skill.visibility === 'private';
  useEffect(() => { if (!creating) { setDraft(skill?.content ?? ''); setTab('texto'); } }, [creating, skill?.key, skill?.content]);
  const startNew = () => { setCreating(true); setTitle(''); setDraft(SKILL_TEMPLATE); setError(null); };
  const create = async () => {
    const key = keyFromTitle(title);
    if (items.some((i) => i.key === key)) { setError('Ya hay una skill con ese nombre.'); return; }
    try {
      await saveSpaceItem('skill', key, { title: title.trim(), content: draft, format: 'markdown', visibility: 'private' });
      setCreating(false); setSelected(key); onChanged();
    } catch { setError('No se pudo guardar la skill.'); }
  };
  const save = async () => {
    if (!skill) return;
    await saveSpaceItem(skill.kind, skill.key, { title: skill.title, content: draft, format: 'markdown', visibility: skill.visibility });
    onChanged();
  };
  const remove = async () => {
    if (!skill) return;
    await deleteSpaceItem(skill.kind, skill.key);
    setSelected(null); onChanged();
  };
  const entry = (i: SpaceItem) => (
    <button key={i.key} onClick={() => { setCreating(false); setSelected(i.key); }} style={{ display: 'block', width: '100%',
      textAlign: 'left', padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12.5,
      backgroundColor: !creating && i.key === skill?.key ? 'var(--bg-elevated)' : 'transparent',
      color: !creating && i.key === skill?.key ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
      {i.title.replace(/_/g, ' ')}
    </button>
  );
  const heading = (text: string) => (
    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)',
      padding: '8px 10px 4px' }}>{text}</div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 14, alignItems: 'start' }}>
      <div style={{ ...card, padding: 6 }}>
        <button style={{ ...btn(true), width: '100%', marginBottom: 6 }} onClick={startNew}>Nueva skill</button>
        {mine.length > 0 && <>{heading('Tuyas')}{mine.map(entry)}</>}
        {product.length > 0 && <>{heading('De la plataforma')}{product.map(entry)}</>}
      </div>
      {creating ? (
        <div style={card}>
          <input style={{ ...field, fontSize: 15, fontWeight: 600, marginBottom: 12 }} placeholder="Nombre de la skill"
            value={title} onChange={(e) => { setTitle(e.target.value); setError(null); }} autoFocus />
          <textarea style={{ ...field, minHeight: 360, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            value={draft} onChange={(e) => setDraft(e.target.value)} />
          {error && <p role="alert" style={{ color: 'var(--red-gc)', fontSize: 13 }}>{error}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button style={btn()} onClick={() => setCreating(false)}>Cancelar</button>
            <button style={btn(true)} disabled={!title.trim() || !draft.trim()} onClick={create}>Crear</button>
          </div>
        </div>
      ) : !skill ? <div style={muted}>Todavía no hay skills. Creá la primera con «Nueva skill».</div> : (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{skill.title.replace(/_/g, ' ')}</span>
            {editable && <button style={btn()} onClick={remove} aria-label="Borrar la skill"><Trash2 size={14} /></button>}
            <span style={muted}>v{skill.version}</span>
          </div>
          {editable && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-dark)' }}>
              {(['texto', 'markdown'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
                  padding: '6px 10px', color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderBottom: tab === t ? '2px solid var(--blue-gc)' : '2px solid transparent' }}>
                  {t === 'texto' ? 'Texto' : 'Markdown'}
                </button>
              ))}
            </div>
          )}
          {tab === 'texto' || !editable ? <Markdown text={skill.content} /> : (
            <>
              <textarea style={{ ...field, minHeight: 360, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                value={draft} onChange={(e) => setDraft(e.target.value)} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button style={btn()} onClick={() => setDraft(skill.content)}>Descartar</button>
                <button style={btn(true)} disabled={draft === skill.content} onClick={save}>Guardar</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── página ──────────────────────────────────────────────────────

export function Settings({ initial = 'usuario', wizard = false, onClose }: { initial?: Section; wizard?: boolean; onClose?: () => void }) {
  const [section, setSection] = useState<Section>(initial);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SpaceItem[]>([]);
  const [shared, setShared] = useState<SpaceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const user = useCurrentUserStore((s) => s.user);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchSpace();
      setItems(data.items);
      setShared(data.shared);
      setError(null);
    } catch (e: any) {
      setItems([]);
      setShared([]);
      setError(e?.response?.data?.error ?? 'No se pudo leer tu espacio de GaleCore');
    } finally { setLoading(false); }
  }, []);
  const reload = useCallback(() => { void load(true); }, [load]);
  useEffect(() => { load(); }, [load]);

  const kind = SECTION_KIND[section];
  const own = useMemo(() => (kind ? items.filter((i) => i.kind === kind) : []), [items, kind]);
  const label = NAV.flatMap((g) => g.items).find((i) => i.id === section)?.label ?? '';

  let body: React.ReactNode;
  if (section === 'mcp-local') {
    body = <LocalMcp />;
  } else if (section === 'conexiones') {
    body = <Connections skills={loading ? <p role="status">Cargando skills…</p> : error ? <p role="alert">{error}</p> : <SkillsView items={items.filter(i => i.kind === 'skill')} onChanged={reload} />} />;
  } else if (section === 'usuario') {
    body = (
      <ProfileSettings user={user} items={items} onChanged={reload}
        language={<LanguageSetting item={items.find(i => i.kind === 'profile' && i.isOwn)} onChanged={reload} />}
        suggestions={suggestionsEnabled(items.find(i => i.kind === 'preference' && i.key === SUGGESTIONS_KEY))}
        onSuggestions={next => { void saveSuggestionsEnabled(next).then(reload).catch(() => setError('No se pudo guardar la preferencia.')); }} />
    );
  } else if (section === 'servicios') {
    body = <PlatformServices />;
  } else if (section === 'contrasena') {
    body = <div style={card}><MyPasswordCard embedded /></div>;
  } else if (section === 'broker') {
    body = <p>Cuenta de bróker: próximamente.</p>;
  } else if (section === 'avisos') {
    body = loading && !items.length ? <p role="status">Cargando avisos…</p>
      : <StrikeAlertForm item={items.find(i => i.kind === 'preference' && i.key === STRIKE_ALERT_KEY)} onChanged={load} />;
  } else if (section === 'memoria') {
    body = <MemoryView items={items} onChanged={reload} />;
  } else if (section === 'skills') {
    body = <SkillsView items={own} onChanged={reload} />;
  } else if (section === 'compartido') {
    body = shared.length ? (
      <div style={{ display: 'grid', gap: 10 }}>
        {shared.map((i) => (
          <div key={`${i.owner}/${i.kind}/${i.key}`} style={card}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{i.title}</span>
              <Visibility item={i} />
            </div>
            {i.format === 'json' ? <ConventionBody item={i} /> : <Markdown text={i.content} />}
          </div>
        ))}
      </div>
    ) : <div style={muted}>Nadie del equipo compartió contenido todavía. Se puede compartir una pieza desde Mi trading o Conocimiento.</div>;
  }

  const group = NAV.find(group => group.items.some(item => item.id === section)) || NAV[0];
  const changeStep = (next: number) => { setStep(next); setSection((['conexiones', 'usuario'] as Section[])[next]); };
  return <div className={'settings-page' + (wizard ? ' settings-wizard' : '')}>
    <aside className="settings-nav" aria-label="Secciones de configuración">{wizard ? <ol>{['Conectar la IA', 'Tus datos'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}>{index + 1}. {label}</li>)}</ol> : NAV.filter(group => (group.group !== 'Plataforma' || user?.isAdmin) && (group.group !== 'Equipo' || shared.length > 0)).map(group => <button key={group.group} onClick={() => setSection(group.items[0].id)} className={group.items.some(item => item.id === section) ? 'is-selected' : ''} aria-current={group.items.some(item => item.id === section) ? 'page' : undefined}>{group.group}</button>)}</aside>
    <main className="settings-main"><h1>{wizard ? ['Conectar la IA', 'Tus datos'][step] : group.group}</h1>
      {!wizard && group.items.length > 1 && <nav className="settings-subsections" aria-label={group.group}>{group.items.map(item => <button key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}>{item.label}</button>)}</nav>}
      {INTRO[section] && <p>{INTRO[section]}</p>}
      {kind && loading ? <p role="status">Cargando {label.toLowerCase()}…</p> : error && kind ? <div role="alert"><p>{error}</p><button style={btn()} onClick={() => load()}>Reintentar</button></div> : body}
      {wizard && <footer className="settings-wizard-actions"><button onClick={onClose}>Completar más tarde</button><div>{step > 0 && <button onClick={() => changeStep(step - 1)}>Anterior</button>}<button onClick={() => step < 1 ? changeStep(step + 1) : onClose?.()}>{step < 1 ? 'Siguiente' : 'Finalizar'}</button></div></footer>}
    </main>
  </div>;
}
