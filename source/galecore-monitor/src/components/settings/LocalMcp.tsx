import React, { useEffect, useState } from 'react';
import { Plug, RefreshCw, Search } from 'lucide-react';
import { fetchLocalMcp, refreshLocalMcp, toggleLocalMcp, LocalMcpInventory, LocalMcpServer } from '../../api/localMcp';
import './LocalMcp.css';

const statusLabels: Record<string, string> = {
  connected: 'Conectado', 'needs-auth': 'Requiere autenticación', failed: 'Error de conexión',
  disabled: 'Deshabilitado', 'not-configured': 'Falta configurar', unverified: 'Sin comprobar',
};
const groups = [
  { id: 'account', label: 'Conectores de tu cuenta' },
  { id: 'plugin', label: 'MCP de plugins' },
  { id: 'local', label: 'Entradas de configuración local' },
];

export function LocalMcp() {
  const [inventory, setInventory] = useState<LocalMcpInventory | null>(null);
  const [provider, setProvider] = useState<'claude' | 'codex'>('claude');
  const [context, setContext] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    setBusy(true);
    fetchLocalMcp().then(data => { if (active) setInventory(data); })
      .catch(e => { if (active) setError(e instanceof TypeError ? 'El servicio de conexiones locales no está disponible.' : e.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!inventory?.refreshing || busy) return;
    let active = true;
    const timer = window.setTimeout(() => fetchLocalMcp().then(data => { if (active) setInventory(data); })
      .catch(() => { if (active) setError('Se perdió la conexión con el servicio local.'); }), 1500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [inventory, busy]);
  const rows = inventory?.servers.filter(s => s.provider === provider) || [];
  const contexts = Array.from(new Set(rows.map(s => s.context)));
  const selectedContext = contexts.includes(context) ? context
    : contexts.includes(inventory?.workspace || '') ? inventory!.workspace : contexts[0] || '';
  const visible = rows.filter(s => s.context === selectedContext);
  const matches = visible.filter(s => (s.displayName || s.name).toLowerCase().includes(query.trim().toLowerCase()));
  async function refresh() {
    setBusy(true); setError(''); setMessage('');
    try { setInventory(await (provider === 'claude' ? refreshLocalMcp() : fetchLocalMcp())); }
    catch (e: any) { setError(e.message || 'No se pudo actualizar el inventario.'); }
    finally { setBusy(false); }
  }
  async function toggle(server: LocalMcpServer) {
    setBusy(true); setError(''); setMessage('');
    try {
      setInventory(await toggleLocalMcp(server, !server.enabled));
      setMessage((server.displayName || server.name) + ': ' + (server.enabled ? 'deshabilitado' : 'habilitado') + '. Abrí una sesión nueva de ' + (provider === 'claude' ? 'Claude' : 'Codex') + ' para aplicar el cambio.');
    } catch (e: any) { setError(e.message || 'No se pudo guardar. Actualizá y volvé a intentar.'); }
    finally { setBusy(false); }
  }
  return <div className="local-mcp">
    <p className="local-mcp-intro">Tus conexiones de Claude y Codex: cuenta, plugins y configuración local.</p>
    <div className="local-mcp-toolbar">
      <div className="local-mcp-tabs" role="group" aria-label="CLI de las conexiones">
        {(['claude', 'codex'] as const).map(id => <button key={id} aria-pressed={provider === id} disabled={busy}
          onClick={() => { setProvider(id); setContext(''); setQuery(''); setMessage(''); }}>{id === 'claude' ? 'Claude Code' : 'Codex'}</button>)}
      </div>
      <button className="settings-action" disabled={busy || (provider === 'claude' && inventory?.refreshing)} onClick={refresh}><RefreshCw size={16}/>Actualizar</button>
    </div>
    {provider === 'claude' && contexts.length > 0 && <label className="local-mcp-context">Proyecto donde se aplica el interruptor
      <select value={selectedContext} disabled={busy} onChange={e => { setContext(e.target.value); setMessage(''); }}>
        {contexts.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>}
    <label className="local-mcp-search"><Search size={18}/><input aria-label="Buscar conexión" placeholder="Buscar Alpha Vantage, Google, IBKR…" value={query} onChange={e => setQuery(e.target.value)}/></label>
    {busy && <p role="status">Leyendo o guardando configuración…</p>}
    {provider === 'claude' && inventory?.refreshing && <p role="status">Comprobando conexiones con Claude Code…</p>}
    {provider === 'claude' && inventory?.checkedAt && <p className="local-mcp-checked">Comprobado con Claude Code: {new Date(inventory.checkedAt).toLocaleTimeString('es-AR')}</p>}
    {error && <div className="settings-error" role="alert">{error}</div>}
    {provider === 'claude' && inventory?.discoveryError && <div className="settings-error" role="alert">{inventory.discoveryError}</div>}
    {message && <p className="local-mcp-notice" role="status">{message}</p>}
    {inventory && !visible.length && <div className="local-mcp-empty"><Plug size={28}/><h2>Sin MCP configurados</h2><p>No hay conexiones detectadas para este CLI y proyecto.</p></div>}
    {visible.length > 0 && !matches.length && <p>No hay conexiones que coincidan con la búsqueda.</p>}
    {groups.map(group => {
      const entries = matches.filter(s => (s.origin || 'local') === group.id);
      if (!entries.length) return null;
      return <section className="local-mcp-group" key={group.id} aria-label={group.label}>
        <h2 className="local-mcp-group-title">{group.label}<span>{entries.length}</span></h2>
        <div className="local-mcp-list">{entries.map(server => {
          const status = server.enabled ? server.runtimeStatus || 'unverified' : 'disabled';
          return <section className="local-mcp-card" key={server.id} aria-label={'MCP ' + server.name}>
            <div className="local-mcp-card-head"><div><h3>{server.displayName || server.name}</h3>
              <span className={'local-mcp-runtime is-' + status}>{statusLabels[status] || 'Sin comprobar'}</span>
              <span className="local-mcp-scope"> · {server.scope}</span></div>
              <button className="local-mcp-switch" role="switch" aria-checked={server.enabled} aria-label={'Habilitar ' + server.name}
                disabled={busy || (server.provider === 'claude' && inventory?.refreshing) || server.approvalRequired || server.editable === false} onClick={() => toggle(server)}>
                <span/>{server.approvalRequired ? 'Pendiente de aprobación en Claude' : server.editable === false ? 'Referencia sin comprobar' : server.enabled ? 'Habilitado' : 'Deshabilitado'}
              </button>
            </div>
            {server.origin !== 'account' && server.origin !== 'plugin' && <details><summary>Archivo de configuración</summary><p>{server.file}</p></details>}
          </section>;
        })}</div>
      </section>;
    })}
    <div className="local-mcp-help"><strong>El interruptor controla la próxima sesión</strong>
      <p>En Claude se aplica al proyecto elegido, incluso para conectores de cuenta y plugins. No desconecta tu cuenta de Google ni del broker.</p>
      <p>El estado de conexión proviene de la última comprobación del CLI. Una entrada local sin comprobar sólo acredita que existe una configuración.</p>
      {provider === 'codex' && <p>Codex muestra los servidores MCP declarados en su configuración de usuario; sus integraciones de la aplicación quedan fuera de este listado.</p>}
    </div>
  </div>;
}
