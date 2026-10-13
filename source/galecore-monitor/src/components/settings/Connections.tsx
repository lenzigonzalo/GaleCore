import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchProviderAuth, ProviderAuth } from '../../api/terminal';
import { AuthenticationTerminal } from './AuthenticationTerminal';

const labels: Record<ProviderAuth['status'], string> = {
  authenticated: 'Cuenta conectada', 'signed-out': 'Sin autenticar',
  'not-installed': 'No instalado', unknown: 'Estado sin comprobar',
};
export function Connections() {
  const [providers, setProviders] = useState<ProviderAuth[]>([]);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [login, setLogin] = useState<{ provider: 'claude' | 'codex'; id: number } | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    let active = true;
    setChecking(true); setError(false); setProviders([]);
    fetchProviderAuth().then(data => { if (active) setProviders(data.providers); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [revision]);
  const reauthenticate = (provider: 'claude' | 'codex') => {
    setRunning(true); setLogin({ provider, id: Date.now() });
  };
  return <div className="settings-connections">
    <div className="settings-connections-tools"><button className="settings-action" aria-label="Actualizar conexiones" title="Actualizar conexiones" disabled={checking || running} onClick={() => setRevision(v => v + 1)}><RefreshCw size={16}/></button></div>
    <div className="settings-provider-list">{(['claude', 'codex'] as const).map(id => {
      const provider = providers.find(p => p.id === id);
      const name = id === 'claude' ? 'Claude Code' : 'Codex';
      return <section className="settings-provider-row" key={id} aria-label={name}>
        <h2>{name}</h2><span className={'settings-status' + (provider?.status === 'authenticated' ? ' is-good' : '')} role="status"><i/>{checking ? 'Comprobando…' : provider ? labels[provider.status] : 'Estado sin comprobar'}</span>
        <button className="settings-action" aria-label={`Reautenticar ${name}`} disabled={checking || error || running || !provider || provider.status === 'not-installed'} onClick={() => reauthenticate(id)}>Reautenticar</button>
      </section>;
    })}</div>
    {error && <p className="settings-error" role="alert">No se pudo conectar con la terminal local.</p>}
    {login && <AuthenticationTerminal key={login.id} provider={login.provider} onEnd={() => { setRunning(false); setRevision(v => v + 1); }} onClose={() => { setLogin(null); setRunning(false); setRevision(v => v + 1); }}/>}
  </div>;
}
