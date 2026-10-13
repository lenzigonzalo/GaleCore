import React, { useEffect, useState } from 'react';
import { Plug, RefreshCw } from 'lucide-react';
import { fetchLocalMcp, toggleLocalMcp, LocalMcpInventory, LocalMcpServer } from '../../api/localMcp';
import './LocalMcp.css';

export function LocalMcp() {
  const [inventory, setInventory] = useState<LocalMcpInventory | null>(null);
  const [provider, setProvider] = useState<'claude' | 'codex'>('claude');
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    fetchLocalMcp().then(data => { if (active) setInventory(data); })
      .catch(e => { if (active) { setInventory(null); setError(e instanceof TypeError ? 'El servicio de conexiones locales no está disponible.' : e.message); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [revision]);
  const rows = inventory?.servers.filter(s => s.provider === provider) || [];
  const contexts = Array.from(new Set(rows.map(s => s.context)));
  const selectedContext = contexts.includes(context) ? context : contexts[0] || '';
  const visible = rows.filter(s => s.context === selectedContext);
  async function toggle(server: LocalMcpServer) {
    setBusy(true); setError(''); setMessage('');
    try {
      setInventory(await toggleLocalMcp(server, !server.enabled));
      setMessage(`${server.name}: ${server.enabled ? 'deshabilitado' : 'habilitado'}. Abrí una sesión nueva de ${provider === 'claude' ? 'Claude' : 'Codex'} para aplicar el cambio.`);
    } catch (e: any) { setError(e.message || 'No se pudo guardar. Actualizá y volvé a intentar.'); }
    finally { setBusy(false); }
  }
  return <div className="local-mcp">
    <p className="local-mcp-intro">Las conexiones configuradas en esta computadora, separadas por CLI.</p>
    <div className="local-mcp-toolbar">
      <div className="local-mcp-tabs" role="group" aria-label="CLI de las conexiones">
        {(['claude', 'codex'] as const).map(id => <button key={id} aria-pressed={provider === id} disabled={busy}
          onClick={() => { setProvider(id); setContext(''); setMessage(''); }}>{id === 'claude' ? 'Claude Code' : 'Codex'}</button>)}
      </div>
      <button className="settings-action" disabled={busy} onClick={() => { setMessage(''); setRevision(v => v + 1); }}><RefreshCw size={16}/>Actualizar</button>
    </div>
    {provider === 'claude' && contexts.length > 0 && <label className="local-mcp-context">Contexto de proyecto
      <select value={selectedContext} disabled={busy} onChange={e => { setContext(e.target.value); setMessage(''); }}>
        {contexts.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>}
    {busy && <p role="status">Leyendo o guardando configuraciónâ€¦</p>}
    {error && <div className="settings-error" role="alert">{error}<p>Actualizá para volver a leer los archivos. El servicio local se inicia con <code>python dev/local_mcp.py --workspace &lt;carpeta&gt;</code>.</p></div>}
    {message && <p className="local-mcp-notice" role="status">{message}</p>}
    {inventory && !visible.length && <div className="local-mcp-empty"><Plug size={28}/><h2>Sin MCP configurados</h2><p>No hay servidores declarados en los archivos locales de {provider === 'claude' ? 'Claude' : 'Codex'} para este contexto.</p></div>}
    <div className="local-mcp-list">{visible.map(server => <section className="local-mcp-card" key={server.id} aria-label={`MCP ${server.name}`}>
      <div className="local-mcp-card-head"><div><h2>{server.name}</h2><span>{server.transport === 'stdio' ? 'Proceso local' : 'Servidor remoto'} · {server.scope}</span></div>
        <button className="local-mcp-switch" role="switch" aria-checked={server.enabled} aria-label={`Habilitar ${server.name}`} disabled={busy} onClick={() => toggle(server)}><span/>{server.enabled ? 'Habilitado' : 'Deshabilitado'}</button>
      </div>
      <details><summary>Archivo de configuración</summary><p>{server.file}</p></details>
    </section>)}</div>
    <div className="local-mcp-help"><strong>Configuración local · conexión sin comprobar</strong><p>Habilitar permite al CLI cargar el MCP en una sesión nueva. No indica qué está usando una conversación abierta.</p><p>Claude aplica el interruptor al proyecto elegido; Codex, a su configuración de usuario. No se listan conectores remotos ni MCP agregados por plugins o por argumentos de una sesión.</p></div>
  </div>;
}
