import React, { useEffect, useState } from 'react';
import { labRequest } from '../../api/lab';
import { Switch } from './Switch';

interface Connectors { galecore: { enabled: boolean }; brokers: { enabled: boolean; engines: string[] } }

/** Configuración → Mis conectores (WS-0083): sólo lo que el chat del producto puede usar, y en cuál de los dos motores. */
export function MyConnectors() {
  const [data, setData] = useState<Connectors | null>(null);
  const [offline, setOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    // Sin respuesta (TypeError de fetch) = no hay Lab en esta PC; un error HTTP se muestra tal cual.
    labRequest<Connectors>('/connectors').then(d => { if (active) setData(d); })
      .catch(e => { if (active) { if (e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError')) setOffline(true); else setError(e instanceof Error ? e.message : 'No se pudo leer.'); } });
    return () => { active = false; };
  }, []);
  const toggle = async (enabled: boolean) => {
    setSaving(true); setError('');
    try {
      const r = await labRequest<Pick<Connectors, 'brokers'>>('/connectors/brokers', { enabled });
      setData(d => d && { ...d, brokers: r.brokers });
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    finally { setSaving(false); }
  };
  if (offline) return <div className="prefs-block"><small role="status">No encuentro el Lab en esta PC: abrí GaleCore desde tu PC con el Lab encendido para ver tus conectores.</small></div>;
  const brokers = !!data?.brokers.enabled;
  return <div className="prefs-block">
    {data && <table className="connector-table" aria-label="Conectores">
      <thead><tr><th>Conector</th><th>Para qué</th><th>Claude Code</th><th>Codex</th><th>Activo</th></tr></thead>
      <tbody>
        <tr><td>GaleCore</td><td>Datos, riesgo y estrategias</td><td className="is-yes" aria-label="Sí">✓</td><td className="is-yes" aria-label="Sí">✓</td><td>Siempre</td></tr>
        <tr><td>IBKR e IOL</td><td>Consultas a tus cuentas, sólo lectura</td>
          <td className={brokers ? 'is-yes' : ''} aria-label={brokers ? 'Sí' : 'No'}>{brokers ? '✓' : '—'}</td>
          <td className={brokers ? 'is-yes' : ''} aria-label={brokers ? 'Sí' : 'No'}>{brokers ? '✓' : '—'}</td>
          <td><Switch on={brokers} label="Consultas a IBKR e IOL" onChange={next => { if (!saving) void toggle(next); }}/></td></tr>
      </tbody>
    </table>}
    {!data && !error && <small role="status">Cargando…</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
