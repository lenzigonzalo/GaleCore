import React, { useEffect, useState } from 'react';
import { labRequest } from '../../api/lab';
import { PERMISSION_MODES } from '../lab/chatPermissions';
import { PermissionModeSelect } from '../lab/PermissionModeSelect';
import { readChatPrefs, saveChatPrefs } from '../lab/labChatPrefs';

type Engine = 'claude' | 'codex';
type Kind = 'allow' | 'ask' | 'deny';
type Rules = Record<Kind, string[]>;
interface RuleSet { product: Rules; user: Rules }
const KINDS: [Kind, string][] = [['allow', 'Permitir'], ['ask', 'Preguntar'], ['deny', 'Denegar']];
const RULE = /^[A-Za-z_][\w.-]*(\(.+\))?$/;

// Como /permissions de Claude Code: Permitir / Preguntar / Denegar. Las reglas del producto son fijas; las tuyas se agregan y se quitan.
function ClaudeRules() {
  const [rules, setRules] = useState<RuleSet | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<Kind>('allow');
  const [draft, setDraft] = useState('');
  useEffect(() => {
    let active = true;
    labRequest<RuleSet>('/permissions/claude').then(r => { if (active) setRules(r); })
      .catch(e => { if (active) { if (e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError')) setOffline(true); else setError(e instanceof Error ? e.message : 'No se pudo leer.'); } });
    return () => { active = false; };
  }, []);
  const save = async (user: Rules) => {
    setError('');
    try { setRules(await labRequest<RuleSet>('/permissions/claude', user)); setDraft(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); }
  };
  if (offline) return <small role="status">No encuentro el Lab en esta PC: abrí GaleCore desde tu PC con el Lab encendido para ver las reglas.</small>;
  const user = rules?.user ?? { allow: [], ask: [], deny: [] };
  const add = () => {
    const rule = draft.trim();
    if (!RULE.test(rule)) { setError('Escribí una regla como Herramienta o Herramienta(patrón), por ejemplo Bash(git status:*).'); return; }
    if (user[kind].includes(rule)) { setError('Esa regla ya está.'); return; }
    void save({ ...user, [kind]: [...user[kind], rule] });
  };
  return <div className="perm-rules">
    <nav className="perm-tabs" role="tablist" aria-label="Reglas">{KINDS.map(([id, label]) =>
      <button key={id} role="tab" aria-selected={kind === id} onClick={() => { setKind(id); setError(''); }}>{label}<span> {(rules?.product[id].length ?? 0) + user[id].length}</span></button>)}</nav>
    <ul className="perm-list" aria-label={'Reglas para ' + KINDS.find(k => k[0] === kind)![1]}>
      {(rules?.product[kind] ?? []).map(r => <li key={'p' + r}><code>{r}</code><em>del producto</em></li>)}
      {user[kind].map(r => <li key={'u' + r}><code>{r}</code><button aria-label={'Quitar ' + r} onClick={() => void save({ ...user, [kind]: user[kind].filter(x => x !== r) })}>Quitar</button></li>)}
      {rules && !rules.product[kind].length && !user[kind].length && <li><em>Sin reglas</em></li>}
    </ul>
    <form className="perm-add" onSubmit={e => { e.preventDefault(); add(); }}>
      <input aria-label="Nueva regla" placeholder="Bash(git status:*)" value={draft} onChange={e => setDraft(e.target.value)} disabled={!rules}/>
      <button type="submit" disabled={!rules || !draft.trim()}>Agregar regla</button>
    </form>
    {!rules && !error && <small role="status">Cargando…</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}

// Como el menú de permisos de Codex: una lista vertical con los modos y el elegido marcado.
function CodexModes({ value, onChange }: { value: string; onChange: (mode: string) => void }) {
  return <div className="perm-menu" role="radiogroup" aria-label="Permisos iniciales de Codex">
    {PERMISSION_MODES.codex.map(m => <button key={m.id} role="radio" aria-checked={m.id === value} onClick={() => onChange(m.id)}>
      <b>{m.id === value ? '›' : ' '}</b><strong>{m.label}</strong><span>{m.hint}</span>
    </button>)}
  </div>;
}

/** Configuración → Proveedores de IA → Permisos (WS-0083): modo con el que arranca cada chat nuevo y, en Claude Code, sus reglas. */
export function Permissions({ engine }: { engine: Engine }) {
  const name = engine === 'claude' ? 'Claude Code' : 'Codex';
  const [prefs, setPrefs] = useState(readChatPrefs);
  const choose = (mode: string) => { const next = { ...prefs, modes: { ...prefs.modes, [engine]: mode } }; setPrefs(next); saveChatPrefs(next); };
  return <section className="settings-agent-account perm" aria-label={'Permisos de ' + name}>
    <header><h2>Permisos de {name}</h2></header>
    {engine === 'claude' ? <>
      <label className="perm-mode">Modo con el que arranca cada chat <PermissionModeSelect engine="claude" value={prefs.modes.claude} onChange={choose}/></label>
      <ClaudeRules/>
    </> : <>
      <p>Modo con el que arranca cada chat</p>
      <CodexModes value={prefs.modes.codex} onChange={choose}/>
    </>}
  </section>;
}
