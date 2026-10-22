import React, { useEffect, useState } from 'react';
import { RefreshCw, Shield } from 'lucide-react';
import { fetchProviderAuth, ProviderAuth } from '../../api/terminal';
import { AuthenticationTerminal } from './AuthenticationTerminal';
import { LocalMcp } from './LocalMcp';
import { localMcpAvailable } from '../../api/localMcp';

const labels: Record<ProviderAuth['status'], string> = {
  authenticated: 'Cuenta conectada', 'signed-out': 'Sin autenticar',
  'not-installed': 'No instalado', unknown: 'Estado sin comprobar',
};
export function Connections({ skills }: { skills?: React.ReactNode }) {
  const [selected, setSelected] = useState<'claude' | 'codex'>('claude');
  const [tab, setTab] = useState('cuenta');
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
    <div className="settings-agent-providers" role="tablist" aria-label="Proveedor de IA">{(['claude', 'codex'] as const).map(id => <button key={id} role="tab" aria-selected={selected === id} disabled={running} onClick={() => setSelected(id)}><img src={'/providers/' + id + '.png'} alt=""/>{id === 'claude' ? 'Claude Code' : 'Codex'}</button>)}</div>
    <nav className="settings-agent-tabs" aria-label="Opciones del proveedor">{[['cuenta', 'Cuenta'], ['permisos', 'Permisos'], ['mcp', 'Servidores MCP'], ['skills', 'Skills']].map(([id, label]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'cuenta' && (() => {
      const provider = providers.find(p => p.id === selected);
      const name = selected === 'claude' ? 'Claude Code' : 'Codex';
      return <section className="settings-agent-account" aria-label={name}>
        <header><div><h2>{name}</h2><p>{selected === 'claude' ? 'Tu cuenta de Anthropic' : 'Tu cuenta de OpenAI'}</p></div><button className="settings-action" aria-label="Actualizar conexiones" title="Actualizar conexiones" disabled={checking || running} onClick={() => setRevision(v => v + 1)}><RefreshCw size={16}/></button></header>
        <div className="settings-agent-card"><div><h3>Estado de la conexión</h3><span className={'settings-status' + (provider?.status === 'authenticated' ? ' is-good' : '')} role="status"><i/>{checking ? 'Comprobando…' : provider ? labels[provider.status] : 'Estado sin comprobar'}</span></div>
        <div className="settings-agent-login"><div><h3>Volver a iniciar sesión</h3><p>Conectá otra cuenta o renová tus credenciales.</p></div><button className="settings-action" aria-label={`Reautenticar ${name}`} disabled={checking || error || running || !provider || provider.status === 'not-installed'} onClick={() => reauthenticate(selected)}>Reautenticar</button></div></div>
      </section>;
    })()}
    {tab === 'permisos' && <section className="settings-agent-account"><header><Shield size={21}/><h2>Permisos de {selected === 'claude' ? 'Claude Code' : 'Codex'}</h2></header><div className="settings-agent-card"><h3>Elegís los permisos en cada chat</h3><p><strong>Manual:</strong> las acciones que necesitan permiso se frenan y te avisan.</p><p><strong>Auto:</strong> permite editar archivos y ejecutar comandos dentro de la carpeta del proyecto.</p><p>Usá el selector Manual / Auto junto al botón de enviar.</p></div></section>}
    {tab === 'mcp' && (localMcpAvailable() ? <LocalMcp key={selected} selectedProvider={selected}/> : <p>Los servidores MCP se administran desde GaleCore en tu PC.</p>)}
    {tab === 'skills' && <div><p className="settings-agent-note">Tus skills son compartidas por Claude Code y Codex.</p>{skills}</div>}
    {error && <p className="settings-error" role="alert">No se pudo conectar con la terminal local.</p>}
    {login && <AuthenticationTerminal key={login.id} provider={login.provider} onEnd={() => { setRunning(false); setRevision(v => v + 1); }} onClose={() => { setLogin(null); setRunning(false); setRevision(v => v + 1); }}/>}
  </div>;
}
