import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, BookOpen, Brain, Database, FileText, Lock, Plug, Scale, Target, User, Users } from 'lucide-react';
import { Connections } from '../components/settings/Connections';
import './Settings.css';
import { LocalMcp } from '../components/settings/LocalMcp';
import { localMcpAvailable } from '../api/localMcp';
import { ProfileForm } from '../components/settings/ProfileForm';
import { StrikeAlertForm } from '../components/settings/StrikeAlertForm';
import { SUGGESTIONS_KEY, suggestionsEnabled, saveSuggestionsEnabled } from '../components/lab/LabSuggestions';
import { STRIKE_ALERT_KEY } from '../api/account';
import { MyPasswordCard } from '../components/account/MyPasswordCard';
import { Markdown } from '../components/settings/Markdown';
import { useCurrentUserStore } from '../store/useCurrentUserStore';
import {
  SpaceItem, SpaceKind, SpaceVisibility, deleteSpaceItem, fetchSpace, keyFromTitle, saveSpaceItem,
} from '../api/space';

/**
 * Configuración (GC-0007): todo lo que es de la persona, en una página con navegación lateral, como la de cualquier
 * app de IA. Reemplaza a «Mi cuenta» y a «Mi espacio».
 *
 *   CUENTA       usuario · contraseña · bróker
 *   MI TRADING   perfil y límites · objetivos · convenciones
 *   GALECORE-AI  memoria · skills · agentes · datos
 *   EQUIPO       compartido conmigo
 *
 * Nada se muestra como JSON: cada tipo tiene su vista legible, y lo que se edita como texto se edita en markdown.
 * El estado vive en esta pantalla (no en un store de módulo): muere con la sesión, como pide la regla de la persona.
 */
export type Section = 'mcp-local' | 'conexiones' | 'usuario' | 'contrasena' | 'broker' | 'perfil' | 'objetivos' | 'convenciones' | 'memoria' | 'skills'
  | 'agentes' | 'datos' | 'compartido' | 'avisos';

const NAV: { group: string; items: { id: Section; label: string; Icon: React.ComponentType<{ size?: number }> }[] }[] = [
  { group: 'General', items: [{ id: 'usuario', label: 'Usuario', Icon: User }, { id: 'contrasena', label: 'Contraseña', Icon: Lock }] },
  { group: 'Conexiones', items: [{ id: 'conexiones', label: 'Conexiones', Icon: Plug }] },
  { group: 'Mi trading', items: [{ id: 'perfil', label: 'Perfil y límites', Icon: Scale }, { id: 'objetivos', label: 'Objetivos', Icon: Target }, { id: 'convenciones', label: 'Convenciones', Icon: FileText }, { id: 'avisos', label: 'Avisos', Icon: Bell }] },
  { group: 'Conocimiento', items: [{ id: 'memoria', label: 'Memoria', Icon: Brain }, { id: 'skills', label: 'Métodos y skills', Icon: BookOpen }, { id: 'datos', label: 'Fuentes', Icon: Database }] },
  { group: 'Equipo', items: [{ id: 'compartido', label: 'Compartido conmigo', Icon: Users }] },
];

const SECTION_KIND: Partial<Record<Section, SpaceKind>> = {
  perfil: 'profile', objetivos: 'objective', convenciones: 'convention', memoria: 'memory', skills: 'skill',
  agentes: 'agent', datos: 'data',
};

const INTRO: Partial<Record<Section, string>> = {
  perfil: 'Lo que GaleCore-AI tiene en cuenta en cada respuesta: tu capital, horizonte y límites de riesgo.',
  objetivos: 'Qué querés lograr. GaleCore-AI los usa para priorizar y para decir si algo te acerca o no.',
  convenciones: 'Cómo trabajás y qué no se hace. Valen para todo lo que GaleCore-AI arma para vos.',
  memoria: 'Lo que GaleCore-AI tiene que recordar entre sesiones. También se agrega desde el chat («acordate de…»).',
  skills: 'Los métodos que GaleCore-AI sabe aplicar. Se leen en texto y se pueden ajustar en markdown.',
  agentes: 'Lo que corre solo con tus instrucciones. Se crean desde el chat; cómo van y el botón para prenderlos o apagarlos, en la pestaña Agentes.',
  datos: 'Fuentes que ponés a disposición de GaleCore-AI.',
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
const pill = (on: boolean): React.CSSProperties => ({
  fontSize: 11, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
  border: `1px solid ${on ? 'var(--blue-gc)' : 'var(--border-dark)'}`, backgroundColor: on ? 'var(--bg-elevated)' : 'transparent',
  color: on ? 'var(--text-primary)' : 'var(--text-muted)',
});
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

// ── edición ─────────────────────────────────────────────────────

function Editor({ kind, item, onDone }: { kind: SpaceKind; item?: SpaceItem; onDone: (saved: boolean) => void }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [content, setContent] = useState(item && item.format !== 'json' ? item.content : '');
  const [visibility, setVisibility] = useState<SpaceVisibility>(item?.visibility ?? 'private');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await saveSpaceItem(kind, item?.key ?? keyFromTitle(title), { title, content, format: 'markdown', visibility });
      onDone(true);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'No se pudo guardar');
    }
  };
  return (
    <div style={{ ...card, display: 'grid', gap: 10 }}>
      <input style={field} placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea style={{ ...field, minHeight: 160, fontFamily: 'var(--font-mono)', fontSize: 12 }}
        placeholder="Escribilo en tus palabras (markdown)" value={content} onChange={(e) => setContent(e.target.value)} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button style={pill(visibility === 'private')} onClick={() => setVisibility('private')}>Sólo vos</button>
        <button style={pill(visibility === 'shared')} onClick={() => setVisibility('shared')}>Compartida con el equipo</button>
        <span style={{ flex: 1 }} />
        <button style={btn()} onClick={() => onDone(false)}>Cancelar</button>
        <button style={btn(true)} disabled={!title.trim() || !content.trim()} onClick={save}>Guardar</button>
      </div>
      {error && <div style={{ fontSize: 12, color: 'var(--red-gc)' }}>{error}</div>}
    </div>
  );
}

function PieceList({ kind, items, onChanged, render }: {
  kind: SpaceKind; items: SpaceItem[]; onChanged: () => void; render?: (i: SpaceItem) => React.ReactNode;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const done = (saved: boolean) => { setEditing(null); if (saved) onChanged(); };
  const remove = async (i: SpaceItem) => {
    if (!window.confirm(`¿Borrar «${i.title}»?`)) return;
    await deleteSpaceItem(i.kind, i.key);
    onChanged();
  };
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div><button style={btn(true)} onClick={() => setEditing('__new__')}>+ Agregar</button></div>
      {editing === '__new__' && <Editor kind={kind} onDone={done} />}
      {items.length === 0 && editing !== '__new__' && <div style={muted}>Todavía no hay contenido. Usá Agregar para guardar {kind === 'data' ? 'una fuente' : kind === 'objective' ? 'un objetivo' : kind === 'convention' ? 'una convención' : 'una nota'}.</div>}
      {items.map((i) => editing === i.key ? <Editor key={i.key} kind={kind} item={i} onDone={done} /> : (
        <div key={i.key} style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{i.title}</span>
            <Visibility item={i} />
          </div>
          {render ? render(i) : i.format === 'json' ? <ConventionBody item={i}/> : <Markdown text={i.content} />}
          {i.isOwn && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {i.format !== 'json' && <button style={btn()} onClick={() => setEditing(i.key)}>Editar</button>}
              <button style={btn()} onClick={() => remove(i)}>Borrar</button>
            </div>
          )}
        </div>
      ))}
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

  const load = useCallback(async () => {
    setLoading(true);
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
  useEffect(() => { load(); }, [load]);

  const kind = SECTION_KIND[section];
  const own = useMemo(() => (kind ? items.filter((i) => i.kind === kind) : []), [items, kind]);
  const label = NAV.flatMap((g) => g.items).find((i) => i.id === section)?.label ?? '';

  let body: React.ReactNode;
  if (section === 'mcp-local') {
    body = <LocalMcp />;
  } else if (section === 'conexiones') {
    body = <div className="settings-connections"><Connections /><section style={card}><h2>GaleCore</h2><p>{loading ? 'Comprobando conexión…' : error ? 'No disponible' : 'Conectado'}</p>{error && <><p role="alert">{error}</p><button style={btn()} onClick={load}>Reintentar</button></>}</section>{localMcpAvailable() && <section><h2>MCP</h2><LocalMcp /></section>}<section style={card}><h2>Cuenta de bróker</h2><p>Próximamente</p></section></div>;
  } else if (section === 'usuario') {
    body = (
      <div style={{ ...card, display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 10, fontSize: 13 }}>
        <div style={muted}>Usuario</div><div style={{ color: 'var(--text-primary)' }}>{user?.username ?? '—'}</div>
        <div style={muted}>Email</div><div style={{ color: 'var(--text-primary)' }}>{user?.email ?? '—'}</div>
        <div style={muted}>Rol</div><div style={{ color: 'var(--text-primary)' }}>{user?.isAdmin ? 'Administrador' : 'Operador'}</div>
        <div style={muted}>Chat nuevo</div><label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-primary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={suggestionsEnabled(items.find(i => i.kind === 'preference' && i.key === SUGGESTIONS_KEY))}
            onChange={e => { void saveSuggestionsEnabled(e.target.checked).then(load).catch(() => setError('No se pudo guardar la preferencia.')); }} />
          Sugerir temas del momento al abrir un chat
        </label>
      </div>
    );
  } else if (section === 'contrasena') {
    body = <div style={card}><MyPasswordCard embedded /></div>;
  } else if (section === 'broker') {
    body = <p>Cuenta de bróker: próximamente.</p>;
  } else if (section === 'perfil') {
    body = <ProfileForm item={own.find(item => item.isOwn)} onChanged={load} />;
  } else if (section === 'avisos') {
    body = loading && !items.length ? <p role="status">Cargando avisos…</p>
      : <StrikeAlertForm item={items.find(i => i.kind === 'preference' && i.key === STRIKE_ALERT_KEY)} onChanged={load} />;
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
  } else if (kind) {
    body = <PieceList kind={kind} items={own} onChanged={load}
      render={kind === 'convention' ? (i) => <ConventionBody item={i} /> : undefined} />;
  }

  const group = NAV.find(group => group.items.some(item => item.id === section)) || NAV[0];
  const changeStep = (next: number) => { setStep(next); setSection((['conexiones', 'perfil', 'datos'] as Section[])[next]); };
  return <div className={'settings-page' + (wizard ? ' settings-wizard' : '')}>
    <aside className="settings-nav" aria-label="Secciones de configuración">{wizard ? <ol>{['Conectar la IA', 'Tu perfil', 'Fuentes'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}>{index + 1}. {label}</li>)}</ol> : NAV.map(group => <button key={group.group} onClick={() => setSection(group.items[0].id)} className={group.items.some(item => item.id === section) ? 'is-selected' : ''} aria-current={group.items.some(item => item.id === section) ? 'page' : undefined}>{group.group}</button>)}</aside>
    <main className="settings-main"><h1>{wizard ? ['Conectar la IA', 'Tu perfil', 'Fuentes'][step] : group.group}</h1>
      {!wizard && group.items.length > 1 && <nav className="settings-subsections" aria-label={group.group}>{group.items.map(item => <button key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}>{item.label}</button>)}</nav>}
      {INTRO[section] && <p>{INTRO[section]}</p>}
      {kind && loading ? <p role="status">Cargando {label.toLowerCase()}…</p> : error && kind ? <div role="alert"><p>{error}</p><button style={btn()} onClick={load}>Reintentar</button></div> : body}
      {wizard && <footer className="settings-wizard-actions"><button onClick={onClose}>Completar más tarde</button><div>{step > 0 && <button onClick={() => changeStep(step - 1)}>Anterior</button>}<button onClick={() => step < 2 ? changeStep(step + 1) : onClose?.()}>{step < 2 ? 'Siguiente' : 'Finalizar'}</button></div></footer>}
    </main>
  </div>;
}
