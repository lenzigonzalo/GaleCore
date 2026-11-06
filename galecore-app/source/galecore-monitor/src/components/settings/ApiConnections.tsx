import React, { useCallback, useEffect, useState } from 'react';
import {
  ConnectionEntry, ConnectionsResponse, fetchConnections, resetConnectionKey, saveConnectionKey, testConnection,
} from '../../api/connections';

/** Fuentes de datos y acceso a GaleCore; las cuentas de IA se administran por separado. */
const errText = (e: any) => e?.response?.data?.error ?? e?.response?.data?.message ?? 'No se pudo completar el pedido.';
const REQUIRES: Record<ConnectionEntry['needsKey'], string> = { required: 'Sí', optional: 'Opcional', none: 'No' };

// ✓ / ✗ con el motivo en el tooltip (la API ya trae el de la última prueba).
function stateOf(c: ConnectionEntry): { ok: boolean; label: string; why: string } {
  if (c.status === 'error') return { ok: false, label: 'Con error', why: c.lastTest?.message || 'La última prueba falló.' };
  if (c.status === 'missing') return { ok: false, label: 'Sin clave', why: c.needsKey === 'optional' ? 'Sin clave cargada: anda con límites bajos.' : 'Falta cargar la API key.' };
  return { ok: true, label: 'Conectado', why: c.lastTest?.ok ? 'Última prueba: ' + (c.lastTest.message || 'funciona') : c.needsKey === 'none' ? 'No necesita clave.' : c.origin === 'server' ? 'Clave de la configuración del servidor.' : 'Clave cargada.' };
}

function Row({ c, canEdit, onChange }: { c: ConnectionEntry; canEdit: boolean; onChange: (e: ConnectionEntry) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keyed = c.owner === 'platform' && c.needsKey !== 'none';
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const updated = await saveConnectionKey(c.id, value.trim());
    setValue(''); setEditing(false); onChange(updated);
  });
  const reset = () => run(async () => { onChange(await resetConnectionKey(c.id)); });
  const test = () => run(async () => {
    const r = await testConnection(c.id);
    onChange({ ...c, lastTest: r, status: r.ok ? (c.status === 'error' ? 'connected' : c.status) : 'error' });
  });
  const cancel = () => { setValue(''); setEditing(false); setError(''); };
  const st = stateOf(c);
  const hint = c.hint ? '••••' + c.hint.replace(/^[•*]+/, '') : '••••••••';
  const keyCell = !keyed ? '—' : editing
    ? <span className="conn-edit">
      <input className="prefs-input" type="password" autoComplete="new-password" aria-label={c.keyLabel || 'Clave de ' + c.name}
        placeholder={c.keyLabel || 'Clave'} value={value} onChange={e => setValue(e.target.value)} />
      <button disabled={busy || !value.trim()} onClick={save}>Guardar</button>
      <button disabled={busy} onClick={cancel}>Cancelar</button>
    </span>
    : c.status === 'missing'
      ? (canEdit ? <button disabled={busy} onClick={() => setEditing(true)}>Agregar</button> : '—')
      : <span className="conn-edit"><code>{hint}</code>
        {canEdit && <button disabled={busy} onClick={() => setEditing(true)}>Cambiar</button>}
        {canEdit && c.origin === 'database' && <button disabled={busy} title="Descarta la clave cargada y usa la del servidor" onClick={reset}>Usar la del servidor</button>}</span>;
  return <tr aria-label={c.name}>
    <td className="conn-name">{c.name}</td>
    <td>{c.description}</td>
    <td>{REQUIRES[c.needsKey]}</td>
    <td>{keyCell}{error && <span className="conn-error" role="alert">{error}</span>}</td>
    <td><span className={'conn-state ' + (st.ok ? 'is-good' : 'is-bad')} role="status" title={st.why}>{st.ok ? '✓' : '✗'} {st.label}</span></td>
    <td><button disabled={busy || !keyed} title={keyed ? undefined : 'No necesita clave: no hay nada que probar'} onClick={test}>Probar</button></td>
  </tr>;
}

export function ApiConnections() {
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    fetchConnections().then(setData).catch(e => setError(errText(e)));
  }, []);
  useEffect(() => { load(); }, [load]);
  const replace = (e: ConnectionEntry) =>
    setData(d => d && { ...d, connections: d.connections.map(c => c.id === e.id ? e : c) });
  const platform = data?.connections.filter(c => c.owner === 'platform' && c.kind === 'source') ?? [];
  const platformGroups: [string, ConnectionEntry[]][] = [];
  platform.forEach(c => {
    const g = c.group || '';
    const found = platformGroups.find(x => x[0] === g);
    if (found) found[1].push(c); else platformGroups.push([g, [c]]);
  });
  const canEdit = !!data?.canEdit && !!data?.storageReady;
  return <div className="prefs prefs-compact">
    <section className="prefs-group">
      <h2>GaleCore</h2>
      <div className="prefs-block"><span>Acceso con tu cuenta</span><small>El monitor usa tu sesión de GaleCore. No necesitás ingresar una API key compartida.</small></div>
    </section>
    {error && <div role="alert"><p>{error}</p><button onClick={load}>Reintentar</button></div>}
    {!data && !error && <p role="status">Cargando conexiones…</p>}
    {data && !data.storageReady && <p role="alert">{data.storageMessage || 'El almacenamiento de claves no está listo.'}</p>}
    {data && <>
      <section className="prefs-group">
        <h2>De la plataforma</h2>
        {!canEdit && <p>Solo un admin puede cambiar las claves.</p>}
        <table className="connector-table conn-table" aria-label="Fuentes de datos">
          <thead><tr><th>Fuente</th><th>Descripción</th><th>Requiere API key</th><th>API key</th><th>Estado</th><th>Probar</th></tr></thead>
          {platformGroups.map(([group, rows]) => <tbody key={group || '_'}>
            {group && <tr className="conn-group"><th colSpan={6}>{group}</th></tr>}
            {rows.map(c => <Row key={c.id} c={c} canEdit={canEdit} onChange={replace} />)}
          </tbody>)}
        </table>
      </section>
    </>}
  </div>;
}
