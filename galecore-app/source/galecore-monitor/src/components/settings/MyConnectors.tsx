import React, { useEffect, useState } from 'react';
import { labRequest } from '../../api/lab';
import { Switch } from './Switch';

type Engine = 'claude' | 'codex';
type Mode = 'allow' | 'ask' | 'deny';
type Group = 'read' | 'write';
interface Tool { name: string; label: string; group: Group; fixed: boolean; value: Mode }
interface Connector { id: string; name: string; status: 'connected' | 'needs-auth' | 'failed' | 'pending'; enabled: boolean; tools?: Tool[] }
interface Connectors { galecore: { enabled: boolean }; engines?: Record<Engine, { ask: boolean }>; claude: Connector[]; codex: Connector[] }
const STATE: Record<Connector['status'], [string, string]> = {
  connected: ['Conectado', 'is-good'], 'needs-auth': ['Falta autorizar', ''], failed: ['Falla', 'is-bad'], pending: ['Conectando', ''],
};
const state = (c: Connector): [string, string] => STATE[c.status] || ['Falla', 'is-bad'];
// La cuenta del motor donde se conectan y reautorizan los conectores (como el botón «Reconectar» de claude.ai).
const RECONNECT: Record<Engine, string> = { claude: 'https://claude.ai/settings/connectors', codex: 'https://chatgpt.com/#settings/Connectors' };
const OPTIONS: [Mode, string][] = [['allow', '✓ Siempre permitir'], ['ask', '✋ Pedir aprobación'], ['deny', '⊘ Nunca']];
const GROUPS: [Group, string][] = [['read', 'Herramientas de sólo lectura'], ['write', 'Herramientas de escritura y borrado']];

function Reconnect({ engine, urgent }: { engine: Engine; urgent: boolean }) {
  return <a className={'btn conn-reconnect' + (urgent ? ' is-urgent' : '')} href={RECONNECT[engine]} target="_blank" rel="noopener noreferrer">Reconectar</a>;
}

function ModeSelect({ label, value, options, disabled, onChange }: { label: string; value: Mode | 'mixed'; options: [Mode, string][]; disabled?: boolean; onChange: (v: Mode) => void }) {
  return <select className="conn-select" aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value as Mode)}>
    {value === 'mixed' && <option value="mixed" disabled>Personalizado</option>}
    {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
  </select>;
}

/** Proveedores de IA → <motor> → Conectores (WS-0091, WS-0108, BF-0022): los MCP que ve ese motor como en claude.ai: estado,
 *  interruptor, Reconectar y, al abrir uno, el permiso de cada herramienta (Siempre permitir · Pedir aprobación · Nunca). */
export function MyConnectors({ engine }: { engine: Engine }) {
  const [data, setData] = useState<Connectors | null>(null);
  const [offline, setOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    // Sin respuesta (TypeError de fetch) = no hay Lab en esta PC; un error HTTP se muestra tal cual.
    labRequest<Connectors>('/connectors', undefined, 40000).then(d => { if (active) setData(d); })
      .catch(e => { if (active) { if (e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError')) setOffline(true); else setError(e instanceof Error ? e.message : 'No se pudo leer.'); } });
    return () => { active = false; };
  }, []);
  useEffect(() => { setOpenId(null); }, [engine]);
  const patch = (id: string, fn: (c: Connector) => Connector) => setData(d => d && { ...d, [engine]: d[engine].map(c => c.id === id ? fn(c) : c) });
  const toggle = async (id: string, enabled: boolean) => {
    setSaving(true); setError('');
    try {
      await labRequest('/connectors', { engine, id, enabled });
      patch(id, c => ({ ...c, enabled }));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    finally { setSaving(false); }
  };
  // Un permiso (o el de todo un grupo): el Lab lo guarda y recién entonces se muestra, así el selector no miente.
  const setMode = async (id: string, which: { tool: string } | { group: Group }, value: Mode) => {
    setSaving(true); setError('');
    try {
      await labRequest('/connectors/tools', { engine, id, ...which, value });
      patch(id, c => ({ ...c, tools: (c.tools || []).map(t => !t.fixed && ('tool' in which ? t.name === which.tool : t.group === which.group) ? { ...t, value } : t) }));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    finally { setSaving(false); }
  };
  if (offline) return <div className="prefs-block"><small role="status">No encuentro el Lab en esta PC: abrí GaleCore desde tu PC con el Lab encendido para ver tus conectores.</small></div>;
  const ask = data?.engines?.[engine]?.ask !== false;
  const options = OPTIONS.filter(([v]) => ask || v !== 'ask');
  const open = data && openId ? data[engine].find(c => c.id === openId) : undefined;
  if (data && open) {
    const [stateText, stateClass] = state(open);
    const tools = open.tools || [];
    return <div className="prefs-block conn-detail">
      <button type="button" className="conn-back" onClick={() => setOpenId(null)}>‹ Conectores</button>
      <div className="conn-head">
        <strong>{open.name}</strong>
        <span className={'conn-state ' + stateClass}>{stateText}</span>
        <Switch on={open.enabled} label={open.name} onChange={next => { if (!saving) void toggle(open.id, next); }}/>
        <Reconnect engine={engine} urgent={open.status !== 'connected'}/>
      </div>
      <h4 className="conn-section">Permisos de herramientas</h4>
      {!tools.length && <small role="status">Este conector todavía no muestra herramientas: autorizalo en {engine === 'claude' ? 'claude.ai' : 'ChatGPT'} con Reconectar.</small>}
      {GROUPS.map(([group, title]) => {
        const list = tools.filter(t => t.group === group);
        if (!list.length) return null;
        const free = list.filter(t => !t.fixed);
        const values = new Set(free.map(t => t.value));
        const groupValue: Mode | 'mixed' = !free.length ? 'deny' : values.size === 1 ? free[0].value : 'mixed';
        return <section key={group} className="conn-group" aria-label={title}>
          <div className="conn-group-head">
            <span>{title} <em>({list.length})</em></span>
            <ModeSelect label={'Permiso de ' + title.toLowerCase()} value={groupValue} options={options} disabled={saving || !free.length} onChange={v => void setMode(open.id, { group }, v)}/>
          </div>
          <ul className="conn-tools">
            {list.map(t => <li key={t.name}>
              <span>{t.label}</span>
              <ModeSelect label={'Permiso de ' + t.label} value={t.fixed ? 'deny' : t.value} options={options} disabled={saving || t.fixed} onChange={v => void setMode(open.id, { tool: t.name }, v)}/>
            </li>)}
          </ul>
        </section>;
      })}
      {error && <small role="alert">{error}</small>}
    </div>;
  }
  return <div className="prefs-block">
    {data && <table className="connector-table" aria-label="Conectores">
      <thead><tr><th>Conector</th><th>Estado</th><th>Activo</th><th><span className="sr-only">Acciones</span></th></tr></thead>
      <tbody>
        {data[engine].map(c => { const [text, cls] = state(c); return <tr key={c.id}>
          <td><button type="button" className="conn-open" onClick={() => setOpenId(c.id)}>{c.name}</button></td>
          <td className={'conn-state ' + cls}>{text}</td>
          <td><Switch on={c.enabled} label={c.name} onChange={next => { if (!saving) void toggle(c.id, next); }}/></td>
          <td><div className="conn-actions">
            <button type="button" className="btn" onClick={() => setOpenId(c.id)} aria-label={'Configurar ' + c.name}>Configurar</button>
            <Reconnect engine={engine} urgent={c.status !== 'connected'}/>
          </div></td></tr>; })}
      </tbody>
    </table>}
    {!data && !error && <small role="status">Cargando…</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
