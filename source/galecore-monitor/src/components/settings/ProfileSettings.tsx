import React, { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { deleteSpaceItem, saveSpaceItem, SpaceItem } from '../../api/space';
import { Switch } from './LanguageSetting';

/**
 * Perfil (WS-0057 I), como el Perfil de Configuración de claude.ai: filas etiqueta–valor con letra grande.
 * Arriba la cuenta (usuario, cómo te llamo, idioma, chat nuevo); abajo el perfil de trading, legible por campo y con
 * edición por campo. La edición se guarda en el espacio del monitor; el harness la trae como versión nueva
 * (`space pull-profile`). Los límites cambian sólo con un ok explícito, como dice el propio perfil.
 */

export const NAME_KEY = 'como-te-llamo';
export const nameFrom = (item?: SpaceItem) => item?.content.match(/«(.+?)»/)?.[1] ?? '';

type FieldKind = 'text' | 'list' | 'amount';
interface Field { key: string; label: string; kind: FieldKind; limit?: boolean; hint?: string }

const GROUPS: { title: string; fields: Field[] }[] = [
  { title: 'Qué buscás', fields: [
    { key: 'objectives', label: 'Objetivos', kind: 'list' },
    { key: 'horizon', label: 'Horizonte', kind: 'text' },
    { key: 'minimum_return', label: 'Retorno mínimo', kind: 'text' },
    { key: 'edge_criterion', label: 'Criterio de edge', kind: 'text' },
  ] },
  { title: 'Límites', fields: [
    { key: 'reference_capital', label: 'Capital de referencia', kind: 'amount', limit: true, hint: 'En USD. Los topes en % se calculan sobre este valor.' },
    { key: 'max_drawdown', label: 'Drawdown máximo', kind: 'text', limit: true },
    { key: 'risk_limits', label: 'Límites de riesgo', kind: 'list', limit: true },
    { key: 'exit_rule', label: 'Regla de salida', kind: 'text', limit: true },
  ] },
  { title: 'Qué hace GaleCore-AI', fields: [
    { key: 'mandate_autonomous', label: 'Qué hace solo', kind: 'list' },
    { key: 'mandate_needs_approval', label: 'Qué espera tu ok', kind: 'list', limit: true },
    { key: 'delivery_format', label: 'Forma de entrega', kind: 'list' },
    { key: 'preferred_sources', label: 'Fuentes preferidas', kind: 'list' },
  ] },
];

const money = (n: number) => `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })} USD`;

function parseProfile(item?: SpaceItem): Record<string, any> | null {
  if (!item) return {};
  try { const d = JSON.parse(item.content); return d && typeof d === 'object' && !Array.isArray(d) ? d : null; } catch { return null; }
}

function show(field: Field, value: unknown): React.ReactNode {
  if (field.kind === 'amount') {
    const amount = (value as any)?.amount;
    return typeof amount === 'number' ? money(amount) : '—';
  }
  if (Array.isArray(value)) return value.length ? <ul>{value.map((v, i) => <li key={i}>{String(v)}</li>)}</ul> : '—';
  return typeof value === 'string' && value ? value : '—';
}

function toDraft(field: Field, value: unknown): string {
  if (field.kind === 'amount') return typeof (value as any)?.amount === 'number' ? String((value as any).amount) : '';
  if (Array.isArray(value)) return value.map(String).join('\n');
  return typeof value === 'string' ? value : '';
}

function fromDraft(field: Field, draft: string, previous: unknown): unknown {
  if (field.kind === 'amount') return { ...(previous as object ?? {}), amount: Number(draft.replace(',', '.')), currency: (previous as any)?.currency ?? 'USD' };
  if (field.kind === 'list') return draft.split('\n').map((s) => s.trim()).filter(Boolean);
  return draft.trim();
}

function ProfileRow({ field, value, onSave }: { field: Field; value: unknown; onSave: (next: unknown) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = field.kind === 'amount' ? !(Number(draft.replace(',', '.')) > 0) : false;
  const start = () => { setDraft(toDraft(field, value)); setConfirmed(false); setError(null); setEditing(true); };
  const save = async () => {
    try { await onSave(fromDraft(field, draft, value)); setEditing(false); }
    catch { setError('No se pudo guardar'); }
  };
  if (!editing) {
    return (
      <div className="prefs-row profile-row">
        <span><strong>{field.label}</strong><span className="profile-value">{show(field, value)}</span></span>
        <button className="mem-icon" aria-label={`Editar ${field.label}`} onClick={start}><Pencil size={16} /></button>
      </div>
    );
  }
  return (
    <div className="prefs-block">
      <label htmlFor={`profile-${field.key}`}>{field.label}</label>
      {field.hint && <small>{field.hint}</small>}
      {field.kind === 'amount'
        ? <input id={`profile-${field.key}`} className="prefs-input" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} />
        : <textarea id={`profile-${field.key}`} className="prefs-textarea" rows={field.kind === 'list' ? 5 : 3} value={draft} onChange={(e) => setDraft(e.target.value)} />}
      {field.kind === 'list' && <small>Uno por línea.</small>}
      {field.limit && (
        <label className="profile-confirm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          Confirmo el cambio: es un límite y sólo cambia con tu ok explícito.
        </label>
      )}
      {error && <div className="settings-error" role="alert">{error}</div>}
      <div className="prefs-actions">
        <button className="settings-action" onClick={() => setEditing(false)}>Cancelar</button>
        <button className="settings-action is-primary" disabled={invalid || (!!field.limit && !confirmed)} onClick={() => void save()}>Guardar</button>
      </div>
    </div>
  );
}

export function ProfileSettings({ user, items, language, suggestions, onSuggestions, onChanged }: {
  user?: { username?: string | null; email?: string | null; isAdmin?: boolean } | null;
  items: SpaceItem[];
  language: React.ReactNode;
  suggestions: boolean;
  onSuggestions: (next: boolean) => void;
  onChanged: () => void;
}) {
  const nameItem = items.find((i) => i.kind === 'convention' && i.key === NAME_KEY && i.isOwn);
  const savedName = nameFrom(nameItem);
  const [name, setName] = useState(savedName);
  const [state, setState] = useState<string | null>(null);
  useEffect(() => { setName(savedName); }, [savedName]);
  const item = items.find((i) => i.kind === 'profile' && i.isOwn);
  const profile = parseProfile(item);

  const saveName = async () => {
    if (name.trim() === savedName) return;
    try {
      if (!name.trim()) await deleteSpaceItem('convention', NAME_KEY);
      else await saveSpaceItem('convention', NAME_KEY, { title: 'Cómo te llamo', content: `Llamame «${name.trim()}».`, format: 'markdown', visibility: 'private' });
      setState('Guardado'); onChanged();
    } catch { setState('No se pudo guardar el nombre'); }
  };

  const saveField = async (key: string, next: unknown) => {
    if (!item || !profile) return;
    const content = { ...profile, [key]: next };
    await saveSpaceItem('profile', item.key, { title: item.title, content: JSON.stringify(content, null, 1), format: 'json', visibility: item.visibility });
    setState('Perfil guardado: el chat lo toma como versión nueva'); onChanged();
  };

  return (
    <div className="prefs">
      <section className="prefs-group">
        <h2>Cuenta</h2>
        <div className="prefs-row"><span>Usuario</span><strong>{user?.username ?? '—'}</strong></div>
        <div className="prefs-row"><span>Email</span><strong>{user?.email ?? '—'}</strong></div>
        <div className="prefs-row"><span>Rol</span><strong>{user?.isAdmin ? 'Administrador' : 'Operador'}</strong></div>
        <div className="prefs-row">
          <label htmlFor="profile-name">¿Cómo querés que GaleCore-AI te llame?</label>
          <input id="profile-name" className="prefs-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => void saveName()} />
        </div>
        {language}
        <div className="prefs-row">
          <span>Chat nuevo<small>Sugerir temas del momento al abrir un chat</small></span>
          <Switch on={suggestions} label="Sugerir temas del momento al abrir un chat" onChange={onSuggestions} />
        </div>
      </section>

      <section className="prefs-group">
        <div className="prefs-heading">
          <h2>Perfil de trading</h2>
          {profile?.version != null && <span className="profile-version">Versión vigente: v{String(profile.version)}</span>}
        </div>
        {state && <span role="status" className="prefs-state">{state}</span>}
        {!item && <p className="prefs-empty">Todavía no hay perfil de trading. Se crea desde el chat con GaleCore-AI.</p>}
        {item && !profile && <p role="alert">No se pudo interpretar el perfil guardado, así que no se puede editar desde acá.</p>}
        {item && profile && GROUPS.map((g) => (
          <div key={g.title} className="profile-group">
            <h3>{g.title}</h3>
            {g.fields.map((f) => <ProfileRow key={f.key} field={f} value={profile[f.key]} onSave={(next) => saveField(f.key, next)} />)}
          </div>
        ))}
      </section>
    </div>
  );
}
