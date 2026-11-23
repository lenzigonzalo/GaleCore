import React, { useCallback, useEffect, useState } from 'react';
import {
  BrokerEntry, fetchBrokers, removeIbkrCredentials, removeIolCredentials, saveIbkrCredentials, saveIolCredentials, setBrokerInclude, testBroker,
} from '../../api/brokers';
import { BrokerAccountCard } from '../account/BrokerAccountCard';
import { useAccountStore } from '../../store/useAccountStore';
import { Switch } from './Switch';

/** Brokers del usuario: cuáles están conectados y cuáles entran en su cartera consolidada. */
const errText = (e: any) => e?.response?.data?.error ?? e?.response?.data?.message ?? 'No se pudo completar el pedido.';
const STATE: Record<BrokerEntry['status'], { ok: boolean | null; label: string }> = {
  connected: { ok: true, label: 'Conectado' },
  missing: { ok: false, label: 'Falta conectar' },
  invalid: { ok: false, label: 'Clave inválida' },
  soon: { ok: null, label: 'Próximamente' },
};

function IolForm({ linked, onSaved, onRemoved, onCancel }: {
  linked: boolean; onSaved: (e: BrokerEntry) => void; onRemoved: (e: BrokerEntry) => void; onCancel: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const save = () => run(async () => { onSaved(await saveIolCredentials(username.trim(), password)); });
  const remove = () => run(async () => { onRemoved(await removeIolCredentials()); });
  return <div className="conn-edit">
    <input className="prefs-input" aria-label="Usuario de IOL" placeholder="Usuario" autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} />
    <input className="prefs-input" type="password" aria-label="Contraseña de IOL" placeholder="Contraseña" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
    <button disabled={busy || !username.trim() || !password} onClick={save}>Guardar</button>
    <button disabled={busy} onClick={onCancel}>Cancelar</button>
    {linked && <button disabled={busy} onClick={remove}>Desconectar</button>}
    {error && <span className="conn-error" role="alert">{error}</span>}
  </div>;
}

// IBKR: el guardado trae el reporte Flex para probar el token, y IBKR puede tardar ~20 s en generarlo.
function IbkrForm({ linked, onSaved, onRemoved, onCancel }: {
  linked: boolean; onSaved: (e: BrokerEntry) => void; onRemoved: (e: BrokerEntry) => void; onCancel: () => void;
}) {
  const [token, setToken] = useState('');
  const [queryId, setQueryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const save = () => run(async () => { onSaved(await saveIbkrCredentials(token.trim(), queryId.trim())); });
  const remove = () => run(async () => { onRemoved(await removeIbkrCredentials()); });
  return <div className="conn-edit">
    <input className="prefs-input" type="password" aria-label="Token de Flex" placeholder="Token de Flex" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} />
    <input className="prefs-input" inputMode="numeric" aria-label="Query ID" placeholder="Query ID" autoComplete="off" value={queryId} onChange={e => setQueryId(e.target.value)} />
    <button disabled={busy || !token.trim() || !queryId.trim()} onClick={save}>{busy ? 'Probando…' : 'Guardar'}</button>
    <button disabled={busy} onClick={onCancel}>Cancelar</button>
    {linked && <button disabled={busy} onClick={remove}>Desconectar</button>}
    {error && <span className="conn-error" role="alert">{error}</span>}
  </div>;
}

function Row({ b, onChange, onLinked }: { b: BrokerEntry; onChange: (e: BrokerEntry) => void; onLinked: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connected = b.status === 'connected';
  const linked = connected || b.status === 'invalid';
  const connectable = b.status !== 'soon';
  const st = STATE[b.status];
  const why = b.lastCheck ? b.lastCheck.message : b.status === 'soon' ? 'Todavía no está disponible.' : undefined;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const test = () => run(async () => {
    const r = await testBroker(b.id);
    onChange({ ...b, lastCheck: r, status: r.ok ? 'connected' : 'invalid' });
  });
  const toggle = (next: boolean) => run(async () => { onChange(await setBrokerInclude(b.id, next)); });
  return <>
    <tr aria-label={b.name}>
      <td className="conn-name">{b.name}</td>
      <td><span className={'conn-state ' + (st.ok ? 'is-good' : st.ok === false ? 'is-bad' : '')} role="status" title={why}>
        {st.ok === null ? '' : st.ok ? '✓ ' : '✗ '}{st.label}</span></td>
      <td>{connectable
        ? <span className="conn-edit">
          <button disabled={busy} onClick={() => setOpen(o => !o)}>{linked ? 'Cambiar' : 'Conectar'}</button>
          {linked && <button disabled={busy} onClick={test}>Probar</button>}
        </span>
        : '—'}
        {error && <span className="conn-error" role="alert">{error}</span>}</td>
      <td>{connected
        ? <Switch on={b.include} label={'Incluir ' + b.name + ' en mi cartera'} onChange={next => { if (!busy) void toggle(next); }} />
        : <button type="button" role="switch" aria-checked={false} aria-label={'Incluir ' + b.name + ' en mi cartera'} className="pref-switch" disabled><i /></button>}</td>
    </tr>
    {open && connectable && <tr><td colSpan={4}>
      {b.id === 'iol'
        ? <IolForm linked={linked} onSaved={e => { onChange(e); setOpen(false); }} onRemoved={e => { onChange(e); setOpen(false); }} onCancel={() => setOpen(false)} />
        : b.id === 'ibkr'
          ? <IbkrForm linked={linked} onSaved={e => { onChange(e); setOpen(false); }} onRemoved={e => { onChange(e); setOpen(false); }} onCancel={() => setOpen(false)} />
          : <BrokerAccountCard onLinked={onLinked} />}
    </td></tr>}
  </>;
}

export function Brokers() {
  const [rows, setRows] = useState<BrokerEntry[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    fetchBrokers().then(setRows).catch(e => setError(errText(e)));
  }, []);
  useEffect(() => { load(); }, [load]);
  const replace = (e: BrokerEntry) => setRows(r => r && r.map(b => b.id === e.id ? e : b));
  const linked = () => { useAccountStore.getState().reset(); load(); };
  return <div className="prefs prefs-compact">
    {error && <div role="alert"><p>{error}</p><button onClick={load}>Reintentar</button></div>}
    {!rows && !error && <p role="status">Cargando brokers…</p>}
    {rows && <table className="connector-table conn-table" aria-label="Brokers">
      <thead><tr><th>Broker</th><th>Estado</th><th>Conectar</th><th>Incluir en mi cartera</th></tr></thead>
      <tbody>{rows.map(b => <Row key={b.id} b={b} onChange={replace} onLinked={linked} />)}</tbody>
    </table>}
  </div>;
}
