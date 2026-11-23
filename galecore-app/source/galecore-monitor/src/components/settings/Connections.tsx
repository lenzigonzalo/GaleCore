import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cancelCodexLogin, fetchLabProviderAuth, LabProviderAuth, startCodexLogin } from '../../api/lab';
import { Permissions } from './Permissions';

const labels: Record<LabProviderAuth['status'], string> = {
  authenticated: 'Cuenta conectada', 'signed-out': 'Sin autenticar',
  'not-installed': 'No instalado en el Lab', unknown: 'Estado sin comprobar',
};
export function Connections() {
  const [selected, setSelected] = useState<'claude' | 'codex'>('claude');
  const [tab, setTab] = useState('cuenta');
  const [providers, setProviders] = useState<LabProviderAuth[]>([]);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [login, setLogin] = useState<{ url: string; code: string } | null>(null);
  const [loginError, setLoginError] = useState('');
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    setChecking(true); setError(false);
    fetchLabProviderAuth().then(data => { if (active) setProviders(data.providers); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [revision]);
  // Mientras hay un login en curso, consulta el estado cada ~3 s hasta que Codex quede conectado.
  useEffect(() => {
    if (!login) return;
    let active = true;
    const timer = window.setInterval(() => {
      fetchLabProviderAuth().then(data => {
        if (!active) return;
        setProviders(data.providers);
        const codex = data.providers.find(p => p.id === 'codex');
        if (codex?.status === 'authenticated' || !data.codexLoginPending) { setLogin(null); setRevision(v => v + 1); }
      }).catch(() => { /* reintenta en el próximo ciclo */ });
    }, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [login]);
  const connect = () => {
    setStarting(true); setLoginError(''); setCopied(false);
    startCodexLogin().then(setLogin).catch(e => setLoginError(e instanceof Error ? e.message : 'No se pudo iniciar la conexión.')).finally(() => setStarting(false));
  };
  const cancel = () => { setLogin(null); cancelCodexLogin().catch(() => undefined).finally(() => setRevision(v => v + 1)); };
  const copy = async () => {
    if (!login) return;
    try { await navigator.clipboard.writeText(login.code); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* sin portapapeles */ }
  };
  return <div className="settings-connections">
    <div className="settings-agent-providers" role="tablist" aria-label="Proveedor de IA">{(['claude', 'codex'] as const).map(id => <button key={id} role="tab" aria-selected={selected === id} disabled={!!login} onClick={() => setSelected(id)}><img src={'/providers/' + id + '.png'} alt=""/>{id === 'claude' ? 'Claude Code' : 'Codex'}</button>)}</div>
    <nav className="settings-agent-tabs" aria-label="Opciones del proveedor">{[['cuenta', 'Cuenta'], ['permisos', 'Permisos']].map(([id, label]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'cuenta' && (() => {
      const provider = providers.find(p => p.id === selected);
      const name = selected === 'claude' ? 'Claude Code' : 'Codex';
      return <section className="settings-agent-account" aria-label={name}>
        <header><div><h2>{name}</h2><p>{selected === 'claude' ? 'Tu cuenta de Anthropic' : 'Tu cuenta de OpenAI'}</p></div><button className="settings-action" aria-label="Actualizar conexiones" title="Actualizar conexiones" disabled={checking || !!login} onClick={() => setRevision(v => v + 1)}><RefreshCw size={16}/></button></header>
        <div className="settings-agent-card"><div><h3>Estado de la conexión</h3><span className={'settings-status' + (provider?.status === 'authenticated' ? ' is-good' : '')} role="status"><i/>{checking ? 'Comprobando…' : provider ? labels[provider.status] : 'Estado sin comprobar'}</span></div>
        {selected === 'codex' && provider && provider.status !== 'not-installed' && <div className="settings-agent-login">{login
          ? <div className="settings-device-login"><a href={login.url} target="_blank" rel="noopener noreferrer">{login.url}</a><strong className="settings-device-code" aria-label="Código de conexión">{login.code}</strong><div><button className="settings-action" onClick={copy}>{copied ? 'Copiado' : 'Copiar código'}</button><button className="settings-action" onClick={cancel}>Cancelar</button></div></div>
          : <><div><h3>{provider.status === 'authenticated' ? 'Volver a iniciar sesión' : 'Conectar Codex'}</h3></div><button className="settings-action" aria-label={provider.status === 'authenticated' ? 'Reautenticar Codex' : 'Conectar Codex'} disabled={checking || error || starting} onClick={connect}>{provider.status === 'authenticated' ? 'Reautenticar' : 'Conectar'}</button></>}</div>}
        {selected === 'claude' && provider?.status === 'signed-out' && <p>Claude Code no tiene sesión en el Lab.</p>}
        {loginError && <p className="settings-error" role="alert">{loginError}</p>}</div>
      </section>;
    })()}
    {tab === 'permisos' && <Permissions engine={selected}/>}
    {error && <p className="settings-error" role="alert">No se pudo consultar el Lab.</p>}
  </div>;
}
