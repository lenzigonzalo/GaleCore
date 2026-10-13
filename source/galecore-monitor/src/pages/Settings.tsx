import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Bot, Brain, Database, FileText, KeyRound, Lock, Plug, Scale, Target, User, Users } from 'lucide-react';
import { Connections } from '../components/settings/Connections';
import './Settings.css';
import { LocalMcp } from '../components/settings/LocalMcp';
import { localMcpAvailable } from '../api/localMcp';
import { BrokerAccountCard } from '../components/account/BrokerAccountCard';
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
type Section = 'mcp-local' | 'conexiones' | 'usuario' | 'contrasena' | 'broker' | 'perfil' | 'objetivos' | 'convenciones' | 'memoria' | 'skills'
  | 'agentes' | 'datos' | 'compartido';

const NAV: { group: string; items: { id: Section; label: string; Icon: React.ComponentType<{ size?: number }> }[] }[] = [
  { group: 'Empezar', items: [
    { id: 'conexiones', label: 'Conexiones', Icon: Plug },
    { id: 'mcp-local', label: 'MCP locales', Icon: Plug },
    { id: 'broker', label: 'Cuenta de bróker', Icon: KeyRound },
  ] },
  { group: 'Mi trading', items: [
    { id: 'perfil', label: 'Perfil y límites', Icon: Scale },
    { id: 'objetivos', label: 'Objetivos', Icon: Target },
    { id: 'convenciones', label: 'Convenciones', Icon: FileText },
  ] },
  { group: 'Conocimiento', items: [
    { id: 'memoria', label: 'Memoria', Icon: Brain },
    { id: 'skills', label: 'Métodos y skills', Icon: BookOpen },
    { id: 'agentes', label: 'Agentes', Icon: Bot },
    { id: 'datos', label: 'Mis fuentes', Icon: Database },
  ] },
  { group: 'Cuenta y equipo', items: [
    { id: 'usuario', label: 'Usuario', Icon: User },
    { id: 'contrasena', label: 'Contraseña', Icon: Lock },
    { id: 'compartido', label: 'Compartido conmigo', Icon: Users },
  ] },
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

function ProfileView({ item }: { item: SpaceItem }) {
  const p = parse(item.content) ?? {};
  const provisional: string[] = p.provisional ?? [];
  const cap = p.reference_capital;
  const rows: [string, string, React.ReactNode][] = [
    ['reference_capital', 'Capital de referencia', cap ? `${Number(cap.amount).toLocaleString('es-AR')} ${cap.currency}` : '—'],
    ['horizon', 'Horizonte', p.horizon ?? '—'],
    ['max_drawdown', 'Pérdida máxima tolerada', p.max_drawdown ?? '—'],
    ['risk_limits', 'Límites de riesgo', (p.risk_limits ?? []).length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{p.risk_limits.map((r: string) => <li key={r}>{r}</li>)}</ul> : '—'],
    ['delivery_format', 'Cómo querés las respuestas', (p.delivery_format ?? []).join(' · ') || '—'],
    ['preferred_sources', 'Fuentes preferidas', (p.preferred_sources ?? []).join(', ') || '—'],
    ['language', 'Idioma', p.language ?? '—'],
  ];
  return (
    <div style={card}>
      <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', rowGap: 12, columnGap: 16, fontSize: 13 }}>
        {rows.map(([key, label, value]) => (
          <React.Fragment key={key}>
            <div style={{ color: 'var(--text-muted)' }}>{label}</div>
            <div style={{ color: 'var(--text-primary)' }}>
              {value}
              {provisional.includes(key) && <span style={{ ...muted, marginLeft: 8, color: 'var(--yellow-gc)' }}>provisorio</span>}
            </div>
          </React.Fragment>
        ))}
      </div>
      <div style={{ ...muted, marginTop: 14 }}>
        Versión {p.version ?? item.version}. El perfil se cambia desde el chat con GaleCore-AI («subí el límite por operación a…»)
        y queda versionado.
      </div>
    </div>
  );
}

// Un agente cancelado queda publicado como historia (GC-AI-0023): no se lista como si estuviera pausado.
const liveAgents = (items: SpaceItem[]) => items.filter((i) => parse(i.content)?.status !== 'cancelled');

function AgentView({ item }: { item: SpaceItem }) {
  const a = parse(item.content) ?? {};
  const what: Record<string, string> = { market_watch: 'Vigila el mercado', daily_attention: 'Briefing diario',
    strategy_followup: 'Seguimiento de estrategia' };
  const on = a.status === 'active';
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{item.key}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{what[a.capability] ?? a.capability}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, color: on ? 'var(--green)' : 'var(--yellow-gc)',
          border: `1px solid ${on ? 'var(--green-border)' : 'var(--yellow-border)'}` }}>{on ? 'Prendido' : 'Pausado'}</span>
      </div>
      <div style={{ ...muted, marginBottom: 8 }}>{a.schedule}{a.strategy ? ` · estrategia ${a.strategy}` : ''}</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{a.objective}</div>
    </div>
  );
}

function ConventionBody({ item }: { item: SpaceItem }) {
  const d = item.format === 'json' ? parse(item.content) : null;
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', rowGap: 6, fontSize: 13 }}>
        {Object.entries(d).map(([k, v]) => (
          <React.Fragment key={k}>
            <div style={{ color: 'var(--text-muted)' }}>{human(k)}</div>
            <div style={{ color: 'var(--text-primary)' }}>{String(v)}</div>
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
      <textarea style={{ ...field, minHeight: 160, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
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
      {items.length === 0 && editing !== '__new__' && <div style={muted}>Todavía no hay nada acá.</div>}
      {items.map((i) => editing === i.key ? <Editor key={i.key} kind={kind} item={i} onDone={done} /> : (
        <div key={i.key} style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{i.title}</span>
            <Visibility item={i} />
          </div>
          {render ? render(i) : <Markdown text={i.content} />}
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
  if (!skill) return <div style={muted}>Todavía no hay skills en tu espacio.</div>;
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
            <textarea style={{ ...field, minHeight: 280, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
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

export function Settings({ initial = 'conexiones', onBrokerLinked }: { initial?: Section; onBrokerLinked?: () => void }) {
  const [section, setSection] = useState<Section>(initial);
  const [items, setItems] = useState<SpaceItem[]>([]);
  const [shared, setShared] = useState<SpaceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const user = useCurrentUserStore((s) => s.user);

  const load = useCallback(async () => {
    try {
      const data = await fetchSpace();
      setItems(data.items);
      setShared(data.shared);
      setError(null);
    } catch (e: any) {
      setItems([]);
      setShared([]);
      setError(e?.response?.data?.error ?? 'No se pudo leer tu espacio de GaleCore');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const kind = SECTION_KIND[section];
  const own = useMemo(() => (kind ? items.filter((i) => i.kind === kind) : []), [items, kind]);
  const label = NAV.flatMap((g) => g.items).find((i) => i.id === section)?.label ?? '';

  let body: React.ReactNode;
  if (section === 'mcp-local') {
    body = <LocalMcp />;
  } else if (section === 'conexiones') {
    body = <Connections />;
  } else if (section === 'usuario') {
    body = (
      <div style={{ ...card, display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 10, fontSize: 13 }}>
        <div style={muted}>Usuario</div><div style={{ color: 'var(--text-primary)' }}>{user?.username ?? '—'}</div>
        <div style={muted}>Email</div><div style={{ color: 'var(--text-primary)' }}>{user?.email ?? '—'}</div>
        <div style={muted}>Rol</div><div style={{ color: 'var(--text-primary)' }}>{user?.isAdmin ? 'Administrador' : 'Operador'}</div>
      </div>
    );
  } else if (section === 'contrasena') {
    body = <div style={card}><MyPasswordCard embedded /></div>;
  } else if (section === 'broker') {
    body = <BrokerAccountCard onLinked={onBrokerLinked} />;
  } else if (section === 'perfil') {
    body = own.length ? <ProfileView item={own[0]} /> : <div style={muted}>Todavía no hay un perfil en tu espacio.</div>;
  } else if (section === 'skills') {
    body = <SkillsView items={own} onChanged={load} />;
  } else if (section === 'agentes') {
    body = liveAgents(own).length ? <div style={{ display: 'grid', gap: 10 }}>{liveAgents(own).map((i) => <AgentView key={i.key} item={i} />)}</div>
      : <div style={muted}>Todavía no tenés agentes. Pedíselo a GaleCore-AI: «armame un agente que…».</div>;
  } else if (section === 'compartido') {
    body = shared.length ? (
      <div style={{ display: 'grid', gap: 10 }}>
        {shared.map((i) => (
          <div key={`${i.owner}/${i.kind}/${i.key}`} style={card}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{i.title}</span>
              <Visibility item={i} />
            </div>
            {i.kind === 'convention' ? <ConventionBody item={i} /> : <Markdown text={i.format === 'json' ? '' : i.content} />}
          </div>
        ))}
      </div>
    ) : <div style={muted}>Nadie del equipo compartió nada todavía.</div>;
  } else if (kind) {
    body = <PieceList kind={kind} items={own} onChanged={load}
      render={kind === 'convention' ? (i) => <ConventionBody item={i} /> : undefined} />;
  }

  return (
    <div className="settings-page">
      <aside className="settings-nav" aria-label="Secciones de configuración">
        <div className="settings-nav-title">Configuración</div>
        {NAV.map((g) => (
          <div key={g.group} style={{ marginBottom: 14 }}>
            <div className="settings-nav-group">{g.group}</div>
            {g.items.filter(i => i.id !== 'mcp-local' || localMcpAvailable()).map(({ id, label: l, Icon }) => (
              <button key={id} onClick={() => setSection(id)} className={section === id ? 'is-selected' : ''} aria-current={section === id ? 'page' : undefined}>
                <Icon size={17} />{l}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <main className="settings-main">
        <h1>{label}</h1>
        {INTRO[section] && <div style={{ ...muted, fontSize: 13, marginBottom: 18 }}>{INTRO[section]}</div>}
        {error && kind && <div style={{ ...card, color: 'var(--red-gc)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        {!(error && kind) && body}
      </main>
    </div>
  );
}
