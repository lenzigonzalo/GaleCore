import React, { useCallback, useEffect, useState } from 'react';
import {
  ConnectionEntry, ConnectionsResponse, fetchConnections, resetConnectionKey, saveConnectionKey, testConnection,
} from '../../api/connections';

/** Fuentes de datos y acceso a GaleCore; las cuentas de IA se administran por separado. */
const STATUS: Record<ConnectionEntry['status'], string> = {
  connected: 'Conectada', missing: 'Falta la clave', 'not-needed': 'No necesita clave', error: 'Con error', local: 'En tu PC',
};
const fmtDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
};
const errText = (e: any) => e?.response?.data?.error ?? e?.response?.data?.message ?? 'No se pudo completar el pedido.';

function detail(c: ConnectionEntry): string {
  if (c.needsKey === 'none') return 'No necesita clave';
  if (c.status === 'error') return c.lastTest?.message || 'La última prueba falló.';
  if (c.status === 'missing') return c.needsKey === 'optional' ? 'Sin clave cargada (opcional)' : 'Sin clave cargada';
  if (c.origin === 'server') return 'Desde la configuración del servidor';
  const when = fmtDate(c.updatedAt);
  return ['cargada', c.hint ? 'termina en ••' + c.hint.replace(/^[•*]+/, '') : '', when ? 'cambiada el ' + when : ''].filter(Boolean).join(' · ');
}

function Row({ c, canEdit, onChange }: { c: ConnectionEntry; canEdit: boolean; onChange: (e: ConnectionEntry) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const keyed = c.owner === 'platform' && c.needsKey !== 'none';
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const updated = await saveConnectionKey(c.id, value.trim());
    setValue(''); setEditing(false); onChange(updated);
  });
  const reset = () => run(async () => { onChange(await resetConnectionKey(c.id)); });
  const test = () => run(async () => {
    const r = await testConnection(c.id);
    setMsg({ ok: r.ok, text: r.ok ? 'Funciona' + (r.message ? ': ' + r.message : '') : r.message });
    onChange({ ...c, lastTest: r, status: r.ok ? (c.status === 'error' ? 'connected' : c.status) : 'error' });
  });
  const good = c.status === 'connected' || c.status === 'not-needed';
  const cancel = () => { setValue(''); setEditing(false); };
  return <div className="prefs-block" aria-label={c.name}>
    <div className="prefs-heading">
      <span>{c.name}</span>
      <span className={'settings-status' + (good ? ' is-good' : '')} role="status"><i/>{STATUS[c.status]}</span>
    </div>
    <small>{c.description}</small>
    <small>{detail(c)}</small>
    {msg && <small role={msg.ok ? 'status' : 'alert'}>{msg.text}</small>}
    {editing && <div className="prefs-actions">
      <input className="prefs-input" type="password" autoComplete="new-password" aria-label={c.keyLabel || 'Clave de ' + c.name}
        placeholder={c.keyLabel || 'Clave'} value={value} onChange={e => setValue(e.target.value)} />
      <button disabled={busy || !value.trim()} onClick={save}>Guardar</button>
      <button disabled={busy} onClick={cancel}>Cancelar</button>
    </div>}
    {!editing && <div className="prefs-actions">
      {keyed && canEdit && <button disabled={busy} onClick={() => { setMsg(null); setEditing(true); }}>{c.status === 'missing' ? 'Cargar' : 'Cambiar'}</button>}
      {keyed && canEdit && c.origin === 'database' && <button disabled={busy} onClick={reset}>Volver a la del servidor</button>}
      {keyed && <button disabled={busy} onClick={test}>Probar</button>}
      {keyed && !canEdit && <small>Solo un admin puede cambiarlas</small>}
    </div>}
  </div>;
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
  return <div className="prefs">
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
        {platformGroups.map(([group, rows]) => <React.Fragment key={group || '_'}>
          {group && <h3 className="prefs-subgroup">{group}</h3>}
          {rows.map(c => <Row key={c.id} c={c} canEdit={canEdit} onChange={replace} />)}
        </React.Fragment>)}
      </section>
    </>}
  </div>;
}
