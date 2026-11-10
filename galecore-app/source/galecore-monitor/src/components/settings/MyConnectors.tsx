import React, { useEffect, useState } from 'react';
import { labRequest } from '../../api/lab';
import { Switch } from './Switch';

type Engine = 'claude' | 'codex';
interface Connector { id: string; name: string; status: 'connected' | 'needs-auth' | 'failed' | 'pending'; enabled: boolean }
interface Connectors { galecore: { enabled: boolean }; claude: Connector[]; codex: Connector[] }
const ENGINES: [Engine, string][] = [['claude', 'Claude Code'], ['codex', 'Codex']];
const STATE: Record<Connector['status'], [string, string]> = {
  connected: ['Conectado', 'is-good'], 'needs-auth': ['Falta autorizar', ''], failed: ['Falla', 'is-bad'], pending: ['Conectando', ''],
};

/** Configuración → Mis conectores (WS-0091): una pestaña por motor con los conectores que ese motor ve, cada uno con su interruptor. */
export function MyConnectors() {
  const [data, setData] = useState<Connectors | null>(null);
  const [engine, setEngine] = useState<Engine>('claude');
  const [offline, setOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    // Sin respuesta (TypeError de fetch) = no hay Lab en esta PC; un error HTTP se muestra tal cual.
    labRequest<Connectors>('/connectors', undefined, 40000).then(d => { if (active) setData(d); })
      .catch(e => { if (active) { if (e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError')) setOffline(true); else setError(e instanceof Error ? e.message : 'No se pudo leer.'); } });
    return () => { active = false; };
  }, []);
  const toggle = async (id: string, enabled: boolean) => {
    setSaving(true); setError('');
    try {
      await labRequest('/connectors', { engine, id, enabled });
      setData(d => d && { ...d, [engine]: d[engine].map(c => c.id === id ? { ...c, enabled } : c) });
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    finally { setSaving(false); }
  };
  if (offline) return <div className="prefs-block"><small role="status">No encuentro el Lab en esta PC: abrí GaleCore desde tu PC con el Lab encendido para ver tus conectores.</small></div>;
  return <div className="prefs-block">
    <div className="settings-agent-providers" role="tablist" aria-label="Motor">{ENGINES.map(([id, label]) =>
      <button key={id} role="tab" aria-selected={engine === id} onClick={() => setEngine(id)}><img src={'/providers/' + id + '.png'} alt=""/>{label}</button>)}</div>
    {data && <table className="connector-table" aria-label="Conectores">
      <thead><tr><th>Conector</th><th>Estado</th><th>Activo</th></tr></thead>
      <tbody>
        <tr><td>GaleCore</td><td className="is-yes">Conectado</td><td>Siempre</td></tr>
        {data[engine].map(c => <tr key={c.id}><td>{c.name}</td>
          <td className={'conn-state ' + STATE[c.status][1]}>{STATE[c.status][0]}</td>
          <td><Switch on={c.enabled} label={c.name} onChange={next => { if (!saving) void toggle(c.id, next); }}/></td></tr>)}
      </tbody>
    </table>}
    {!data && !error && <small role="status">Cargando…</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
