import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, BookOpen, MessageSquare, KeyRound, Plug, Wallet, Power, User, UserCog, Users } from 'lucide-react';
import { Connections } from '../components/settings/Connections';
import { PlatformServices } from '../components/settings/PlatformServices';
import './Settings.css';
import { SkillsView } from '../components/settings/SkillsView';
import { MyConnectors } from '../components/settings/MyConnectors';
import { ProfileSettings } from '../components/settings/ProfileSettings';
import { StrikeAlertForm } from '../components/settings/StrikeAlertForm';
import { SUGGESTIONS_KEY, suggestionsEnabled, saveSuggestionsEnabled } from '../components/lab/LabSuggestions';
import { STRIKE_ALERT_KEY } from '../api/account';
import { BrokerAccountCard } from '../components/account/BrokerAccountCard';
import { ApiConnections } from '../components/settings/ApiConnections';
import { useAccountStore } from '../store/useAccountStore';
import { AccountSettings } from '../components/settings/AccountSettings';
import { TextSizeSettings } from '../components/settings/TextSizeSettings';
import { ChatBehaviorSettings } from '../components/settings/ChatBehaviorSettings';
import { Markdown } from '../components/settings/Markdown';
import { useCurrentUserStore } from '../store/useCurrentUserStore';
import {
  SpaceItem, SpaceKind, fetchSpace,
} from '../api/space';

/**
 * Configuración (GC-0007): todo lo que es de la persona, con navegación lateral, como la de cualquier app de IA.
 *
 *   GENERAL          perfil (nombre, intereses y memoria) · cuenta (usuario, idioma, contraseña) · avisos
 *   CONEXIONES       IA, GaleCore, bróker
 *   SKILLS           las de la plataforma y las tuyas
 *   EQUIPO           compartido conmigo (sólo si alguien compartió algo)
 *   PLATAFORMA       estado de los servicios (admin)
 *
 * Nada se muestra como JSON ni como caja libre cuando se puede elegir: las opciones son interruptores y listas, y se
 * guardan solas. El estado vive en esta pantalla (no en un store de módulo): muere con la sesión.
 */
export type Section = 'mcp-local' | 'conexiones' | 'usuario' | 'cuenta' | 'broker' | 'skills'
  | 'apis' | 'compartido' | 'avisos' | 'servicios' | 'chat';

const NAV: { group: string; items: { id: Section; label: string; Icon: React.ComponentType<{ size?: number }> }[] }[] = [
  { group: 'General', items: [{ id: 'usuario', label: 'Perfil', Icon: User }, { id: 'cuenta', label: 'Cuenta', Icon: UserCog }, { id: 'chat', label: 'Chat', Icon: MessageSquare }, { id: 'avisos', label: 'Avisos', Icon: Bell }] },
  { group: 'Proveedores de IA', items: [{ id: 'conexiones', label: 'Proveedores de IA', Icon: Plug }] },
  { group: 'Conexiones', items: [{ id: 'apis', label: 'Fuentes de GaleCore', Icon: KeyRound }, { id: 'mcp-local', label: 'Mis conectores', Icon: Plug }, { id: 'broker', label: 'Bróker', Icon: Wallet }] },
  { group: 'Skills', items: [{ id: 'skills', label: 'Skills', Icon: BookOpen }] },
  { group: 'Equipo', items: [{ id: 'compartido', label: 'Compartido conmigo', Icon: Users }] },
  { group: 'Plataforma', items: [{ id: 'servicios', label: 'Servicios', Icon: Power }] },
];

const SECTION_KIND: Partial<Record<Section, SpaceKind>> = { skills: 'skill' };

const INTRO: Partial<Record<Section, string>> = {
  servicios: 'Lo que GaleCore corre solo, para todos: no lo crea el usuario. Tus tareas están en Agentes y las estrategias en Estrategias.',
  usuario: 'Lo que GaleCore-AI sabe de vos en cada chat: cómo llamarte, qué te interesa y lo que quieras que recuerde.',
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
    body = <MyConnectors />;
  } else if (section === 'conexiones') {
    body = <Connections />;
  } else if (section === 'usuario') {
    body = (
      <ProfileSettings items={items} onChanged={reload} />
    );
  } else if (section === 'cuenta') {
    body = (
      <AccountSettings user={user}
        textSize={<TextSizeSettings items={items} onChanged={reload} />}
        suggestions={suggestionsEnabled(items.find(i => i.kind === 'preference' && i.key === SUGGESTIONS_KEY))}
        onSuggestions={next => { void saveSuggestionsEnabled(next).then(reload).catch(() => setError('No se pudo guardar la preferencia.')); }} />
    );
  } else if (section === 'chat') {
    body = <ChatBehaviorSettings />;
  } else if (section === 'servicios') {
    body = <PlatformServices />;
  } else if (section === 'broker') {
    body = <BrokerAccountCard onLinked={() => { useAccountStore.getState().reset(); }} />;
  } else if (section === 'apis') {
    body = <ApiConnections />;
  } else if (section === 'avisos') {
    body = loading && !items.length ? <p role="status">Cargando avisos…</p>
      : <StrikeAlertForm item={items.find(i => i.kind === 'preference' && i.key === STRIKE_ALERT_KEY)} onChanged={load} />;
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
