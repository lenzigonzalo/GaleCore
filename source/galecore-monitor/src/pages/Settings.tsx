import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, BookOpen, Brain, Lock, Pencil, Plug, Power, SlidersHorizontal, Trash2, User, Users } from 'lucide-react';
import { Connections } from '../components/settings/Connections';
import { PlatformServices } from '../components/settings/PlatformServices';
import './Settings.css';
import { LocalMcp } from '../components/settings/LocalMcp';
import { localMcpAvailable } from '../api/localMcp';
import { PreferencesForm, Switch } from '../components/settings/PreferencesForm';
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
 *   GENERAL          usuario · contraseña
 *   CONEXIONES       IA, GaleCore, bróker
 *   PERSONALIZACIÓN  preferencias (idioma, forma de las respuestas, fuentes) · avisos
 *   MEMORIA          lo que GaleCore-AI recuerda (notas, objetivos y reglas, juntos) · métodos y skills
 *   EQUIPO           compartido conmigo
 *
 * Nada se muestra como JSON ni como caja libre cuando se puede elegir: las opciones son interruptores y listas, y se
 * guardan solas. El estado vive en esta pantalla (no en un store de módulo): muere con la sesión.
 */
export type Section = 'mcp-local' | 'conexiones' | 'usuario' | 'contrasena' | 'broker' | 'perfil' | 'memoria' | 'skills'
  | 'compartido' | 'avisos' | 'servicios';

const NAV: { group: string; items: { id: Section; label: string; Icon: React.ComponentType<{ size?: number }> }[] }[] = [
  { group: 'General', items: [{ id: 'usuario', label: 'Usuario', Icon: User }, { id: 'contrasena', label: 'Contraseña', Icon: Lock }] },
  { group: 'Conexiones', items: [{ id: 'conexiones', label: 'Conexiones', Icon: Plug }] },
  { group: 'Personalización', items: [{ id: 'perfil', label: 'Preferencias', Icon: SlidersHorizontal }, { id: 'avisos', label: 'Avisos', Icon: Bell }] },
  { group: 'Memoria', items: [{ id: 'memoria', label: 'Lo que recuerda', Icon: Brain }, { id: 'skills', label: 'Métodos y skills', Icon: BookOpen }] },
  { group: 'Equipo', items: [{ id: 'compartido', label: 'Compartido conmigo', Icon: Users }] },
  { group: 'Plataforma', items: [{ id: 'servicios', label: 'Servicios', Icon: Power }] },
];

const SECTION_KIND: Partial<Record<Section, SpaceKind>> = { perfil: 'profile', memoria: 'memory', skills: 'skill' };

const INTRO: Partial<Record<Section, string>> = {
  perfil: 'Cómo responde GaleCore-AI y de dónde saca los datos. Se guarda solo.',
  servicios: 'Los servicios que corren solos para toda la plataforma. Las estrategias se prenden en su ficha de Estrategias y las tareas en Agentes.',
  memoria: 'Todo lo que GaleCore-AI tiene en cuenta en cada chat: notas, objetivos y reglas. También se agrega desde el chat («acordate de…»).',
  skills: 'Los métodos que GaleCore-AI sabe aplicar. Se leen en texto y se pueden ajustar en markdown.',
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

// ── memoria: notas, objetivos y reglas en una sola lista ────────

const MEMORY_TYPES: { kind: SpaceKind; label: string; plural: string }[] = [
  { kind: 'memory', label: 'Nota', plural: 'Notas' },
  { kind: 'objective', label: 'Objetivo', plural: 'Objetivos' },
  { kind: 'convention', label: 'Regla', plural: 'Reglas' },
];
const typeOf = (kind: SpaceKind) => MEMORY_TYPES.find((t) => t.kind === kind);
const PLACEHOLDER: Partial<Record<SpaceKind, string>> = {
  memory: 'Ej.: prefiero vencimientos de 30 a 45 días',
  objective: 'Ej.: retorno anual de 10 a 15 % vendiendo prima con riesgo definido',
  convention: 'Ej.: no abrir posiciones nuevas la semana del FOMC',
};

function MemoryEditor({ item, taken, onDone }: { item?: SpaceItem; taken: Set<string>; onDone: (saved: boolean) => void }) {
  const [kind, setKind] = useState<SpaceKind>(item?.kind ?? 'memory');
  const [content, setContent] = useState(item?.content ?? '');
  const [shared, setShared] = useState(item?.visibility === 'shared');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    // El título sale de la primera línea: se escribe una sola cosa, como en la memoria de ChatGPT o de Claude.
    const title = item?.title ?? content.trim().split('\n')[0].slice(0, 60);
    let key = item?.key ?? keyFromTitle(title);
    if (!item && taken.has(`${kind}/${key}`)) key = `${key.slice(0, 50)}-${Date.now().toString(36)}`;
    try {
      await saveSpaceItem(kind, key, { title, content: content.trim(), format: 'markdown', visibility: shared ? 'shared' : 'private' });
      onDone(true);
    } catch (e: any) { setError(e?.response?.data?.error ?? 'No se pudo guardar'); }
  };
  return (
    <div className="mem-editor">
      {!item && <div className="mem-chips" role="radiogroup" aria-label="Tipo">
        {MEMORY_TYPES.map((t) => <button key={t.kind} role="radio" aria-checked={kind === t.kind} className={kind === t.kind ? 'is-on' : ''} onClick={() => setKind(t.kind)}>{t.label}</button>)}
      </div>}
      <textarea autoFocus rows={3} aria-label="Contenido" value={content} onChange={(e) => setContent(e.target.value)} placeholder={PLACEHOLDER[kind]} />
      <div className="mem-editor-bar">
        <label className="mem-share"><Switch on={shared} label="Compartir con el equipo" onChange={setShared} />Compartir con el equipo</label>
        <span style={{ flex: 1 }} />
        <button className="settings-action" onClick={() => onDone(false)}>Cancelar</button>
        <button className="settings-action is-primary" disabled={!content.trim()} onClick={save}>Guardar</button>
      </div>
      {error && <div className="settings-error" role="alert">{error}</div>}
    </div>
  );
}

function MemoryView({ items, onChanged }: { items: SpaceItem[]; onChanged: () => void }) {
  const [filter, setFilter] = useState<SpaceKind | 'all'>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const list = useMemo(() => items.filter((i) => i.isOwn && typeOf(i.kind)), [items]);
  const shown = filter === 'all' ? list : list.filter((i) => i.kind === filter);
  const taken = useMemo(() => new Set(list.map((i) => `${i.kind}/${i.key}`)), [list]);
  const done = (saved: boolean) => { setEditing(null); if (saved) onChanged(); };
  const remove = async (i: SpaceItem) => { setConfirming(null); await deleteSpaceItem(i.kind, i.key); onChanged(); };
  return (
    <div className="mem">
      <div className="mem-top">
        <div className="mem-chips" role="tablist" aria-label="Filtrar">
          <button role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'is-on' : ''} onClick={() => setFilter('all')}>Todo <span>{list.length}</span></button>
          {MEMORY_TYPES.map((t) => <button key={t.kind} role="tab" aria-selected={filter === t.kind} className={filter === t.kind ? 'is-on' : ''} onClick={() => setFilter(t.kind)}>{t.plural} <span>{list.filter((i) => i.kind === t.kind).length}</span></button>)}
        </div>
        <button className="settings-action is-primary" onClick={() => setEditing('__new__')}>+ Agregar</button>
      </div>
      {editing === '__new__' && <MemoryEditor taken={taken} onDone={done} />}
      {shown.length === 0 && editing !== '__new__' && <div style={muted}>Todavía no hay nada. Agregá una nota, un objetivo o una regla, o pedile al chat «acordate de…».</div>}
      <ul className="mem-list">
        {shown.map((i) => {
          const id = `${i.kind}/${i.key}`;
          if (editing === id) return <li key={id}><MemoryEditor item={i} taken={taken} onDone={done} /></li>;
          return (
            <li key={id} className="mem-item">
              <span className="mem-type">{typeOf(i.kind)?.label}</span>
              <div className="mem-body">{i.format === 'json' ? <ConventionBody item={i} /> : <Markdown text={i.content} />}</div>
              {i.visibility === 'shared' && <span className="mem-shared">Equipo</span>}
              <div className="mem-actions">
                {confirming === id ? <>
                  <button className="settings-action" onClick={() => setConfirming(null)}>No</button>
                  <button className="settings-action is-danger" onClick={() => remove(i)}>Borrar</button>
                </> : <>
                  {i.format !== 'json' && <button className="mem-icon" aria-label="Editar" onClick={() => setEditing(id)}><Pencil size={15} /></button>}
                  <button className="mem-icon" aria-label="Borrar" onClick={() => setConfirming(id)}><Trash2 size={15} /></button>
                </>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SkillsView({ items, onChanged }: { items: SpaceItem[]; onChanged: () => void }) {
  const [selected, setSelected] = useState<string | null>(items[0]?.key ?? null);
  const [tab, setTab] = useState<'texto' | 'markdown'>('texto');
  const [draft, setDraft] = useState('');
  const skill = items.find((i) => i.key === selected) ?? items[0];
  useEffect(() => { setDraft(skill?.content ?? ''); setTab('texto'); }, [skill?.key, skill?.content]);
  if (!skill) return <div style={muted}>Todavía no hay skills en tu espacio. Creá un método desde el chat para guardarlo acá.</div>;
  const save = async () => {
    await saveSpaceItem(skill.kind, skill.key, { title: skill.title, content: draft, format: 'markdown', visibility: skill.visibility });
    onChanged();
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 14, alignItems: 'start' }}>
      <div style={{ ...card, padding: 6 }}>
        {items.map((i) => (
          <button key={i.key} onClick={() => setSelected(i.key)} style={{ display: 'block', width: '100%', textAlign: 'left',
            padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12.5,
            backgroundColor: i.key === skill.key ? 'var(--bg-elevated)' : 'transparent',
            color: i.key === skill.key ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {i.title.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{skill.title.replace(/_/g, ' ')}</span>
          <Visibility item={skill} />
          <span style={muted}>v{skill.version}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border-dark)' }}>
          {(['texto', 'markdown'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
              padding: '6px 10px', color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--blue-gc)' : '2px solid transparent' }}>
              {t === 'texto' ? 'Texto' : 'Markdown'}
            </button>
          ))}
        </div>
        {tab === 'texto' ? <Markdown text={skill.content} /> : (
          <>
            <textarea style={{ ...field, minHeight: 280, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              value={draft} readOnly={!skill.isOwn} onChange={(e) => setDraft(e.target.value)} />
            {skill.isOwn && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button style={btn()} onClick={() => setDraft(skill.content)}>Descartar</button>
                <button style={btn(true)} disabled={draft === skill.content} onClick={save}>Guardar</button>
              </div>
            )}
          </>
        )}
      </div>
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
    body = <div className="settings-connections"><Connections /><section style={card}><h2>GaleCore</h2><p>{loading ? 'Comprobando conexión…' : error ? 'No disponible' : 'Conectado'}</p>{error && <><p role="alert">{error}</p><button style={btn()} onClick={() => load()}>Reintentar</button></>}</section>{localMcpAvailable() && <section><h2>MCP</h2><LocalMcp /></section>}<section style={card}><h2>Cuenta de bróker</h2><p>Próximamente</p></section></div>;
  } else if (section === 'usuario') {
    body = (
      <div style={{ ...card, display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 10, fontSize: 13 }}>
        <div style={muted}>Usuario</div><div style={{ color: 'var(--text-primary)' }}>{user?.username ?? '—'}</div>
        <div style={muted}>Email</div><div style={{ color: 'var(--text-primary)' }}>{user?.email ?? '—'}</div>
        <div style={muted}>Rol</div><div style={{ color: 'var(--text-primary)' }}>{user?.isAdmin ? 'Administrador' : 'Operador'}</div>
        <div style={muted}>Chat nuevo</div><label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-primary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={suggestionsEnabled(items.find(i => i.kind === 'preference' && i.key === SUGGESTIONS_KEY))}
            onChange={e => { void saveSuggestionsEnabled(e.target.checked).then(reload).catch(() => setError('No se pudo guardar la preferencia.')); }} />
          Sugerir temas del momento al abrir un chat
        </label>
      </div>
    );
  } else if (section === 'servicios') {
    body = <PlatformServices />;
  } else if (section === 'contrasena') {
    body = <div style={card}><MyPasswordCard embedded /></div>;
  } else if (section === 'broker') {
    body = <p>Cuenta de bróker: próximamente.</p>;
  } else if (section === 'perfil') {
    body = <PreferencesForm item={own.find(item => item.isOwn)} onChanged={reload} />;
  } else if (section === 'avisos') {
    body = loading && !items.length ? <p role="status">Cargando avisos…</p>
      : <StrikeAlertForm item={items.find(i => i.kind === 'preference' && i.key === STRIKE_ALERT_KEY)} onChanged={load} />;
  } else if (section === 'memoria') {
    body = <MemoryView items={items} onChanged={reload} />;
  } else if (section === 'skills') {
    body = <SkillsView items={own} onChanged={load} />;
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
  const changeStep = (next: number) => { setStep(next); setSection((['conexiones', 'perfil'] as Section[])[next]); };
  return <div className={'settings-page' + (wizard ? ' settings-wizard' : '')}>
    <aside className="settings-nav" aria-label="Secciones de configuración">{wizard ? <ol>{['Conectar la IA', 'Tus preferencias'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}>{index + 1}. {label}</li>)}</ol> : NAV.filter(group => group.group !== 'Plataforma' || user?.isAdmin).map(group => <button key={group.group} onClick={() => setSection(group.items[0].id)} className={group.items.some(item => item.id === section) ? 'is-selected' : ''} aria-current={group.items.some(item => item.id === section) ? 'page' : undefined}>{group.group}</button>)}</aside>
    <main className="settings-main"><h1>{wizard ? ['Conectar la IA', 'Tus preferencias'][step] : group.group}</h1>
      {!wizard && group.items.length > 1 && <nav className="settings-subsections" aria-label={group.group}>{group.items.map(item => <button key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}>{item.label}</button>)}</nav>}
      {INTRO[section] && <p>{INTRO[section]}</p>}
      {kind && loading ? <p role="status">Cargando {label.toLowerCase()}…</p> : error && kind ? <div role="alert"><p>{error}</p><button style={btn()} onClick={() => load()}>Reintentar</button></div> : body}
      {wizard && <footer className="settings-wizard-actions"><button onClick={onClose}>Completar más tarde</button><div>{step > 0 && <button onClick={() => changeStep(step - 1)}>Anterior</button>}<button onClick={() => step < 1 ? changeStep(step + 1) : onClose?.()}>{step < 1 ? 'Siguiente' : 'Finalizar'}</button></div></footer>}
    </main>
  </div>;
}
