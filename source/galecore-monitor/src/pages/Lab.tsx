import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Folder, Plus, RefreshCw, TerminalSquare, Square, GitCommitHorizontal, FlaskConical, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { Tab } from '../components/layout/TabNav';
import { LAB_URL, labRequest, labToken, LabState, LabSession, LabContext } from '../api/lab';
import './Lab.css';

const SAVE_PROMPT = 'Guardá el avance de esta sesión mediante las herramientas canónicas de GaleCore-AI: decisiones, evidencia y próximos pasos. Revisá el diff y hacé un commit local en knowledge únicamente de los archivos de tu trabajo, sin cambios ajenos, sin secretos y sin push. Informá las rutas y el hash comprobado; si no hay cambios, decilo.';
const STATUS = { running: 'Abierta', ended: 'Terminada', interrupted: 'Servicio reiniciado' };
export function Lab({ onMonitor, onNavigate = () => {} }: { onMonitor: () => void; onNavigate?: (tab: Tab) => void }) {
  const [state, setState] = useState<LabState | null>(null);
  const [project, setProject] = useState('portfolio');
  const [provider, setProvider] = useState<'codex' | 'claude'>('codex');
  const [sessionId, setSessionId] = useState<string | null>(() => sessionStorage.getItem('galecore:lab:session'));
  const [context, setContext] = useState<LabContext | null>(null);
  const [contextError, setContextError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState('Sin sesión');
  const [retry, setRetry] = useState(0);
  const [contextOpen, setContextOpen] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const terminal = useRef<Terminal | null>(null);
  const session = state?.sessions.find(s => s.id === sessionId);
  const currentProject = state?.projects.find(p => p.id === project);
  const refresh = useCallback(async () => {
    try { setState(await labRequest<LabState>('/state')); setError(''); }
    catch (e) { setError(e instanceof Error && e.message !== 'Failed to fetch' ? e.message : 'No se pudo conectar con el servicio local del Lab.'); }
  }, []);
  const refreshContext = useCallback(async () => {
    try { setContext(await labRequest<LabContext>('/projects/' + encodeURIComponent(project))); setContextError(''); }
    catch { setContext(null); setContextError('No se pudo leer el historial de memoria.'); }
  }, [project]);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => { if (state) refreshContext(); }, [!!state, refreshContext]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (session) { setProject(session.project); setProvider(session.provider); }
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (sessionId) sessionStorage.setItem('galecore:lab:session', sessionId);
    else sessionStorage.removeItem('galecore:lab:session');
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId || !host.current || !state?.sessions.some(s => s.id === sessionId)) return;
    let disposed = false;
    const term = new Terminal({ cursorBlink: true, fontSize: 14, scrollback: 10000,
      fontFamily: 'Cascadia Mono, Consolas, monospace',
      theme: { background: '#090909', foreground: '#e6e6e6', cursor: '#e6e6e6' } });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current); terminal.current = term;
    const fitVisible = () => { if (host.current && host.current.clientWidth > 0 && host.current.clientHeight > 0) { try { fit.fit(); } catch {} } };
    fitVisible();
    const resize = new ResizeObserver(fitVisible); resize.observe(host.current);
    let ws: WebSocket | null = null;
    const send = (m: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
    const input = term.onData(data => send({ type: 'input', data }));
    const dimensions = term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
    setConnection('Conectando…');
    labToken().then(token => {
      if (disposed) return;
      ws = new WebSocket(LAB_URL.replace('http:', 'ws:') + '/attach'); socket.current = ws;
      ws.onopen = () => send({ type: 'attach', id: sessionId, token, cols: term.cols, rows: term.rows });
      ws.onmessage = e => {
        if (disposed) return;
        try {
          const m = JSON.parse(e.data);
          if (m.type === 'replay') { term.reset(); term.write(m.data || ''); setConnection(m.state === 'running' ? 'Conectada' : 'Sesión terminada'); term.focus(); }
          if (m.type === 'output') term.write(m.data);
          if (m.type === 'ended') { setConnection('Sesión terminada · código ' + m.exitCode); refresh(); refreshContext(); }
        } catch { setConnection('Respuesta inválida del servicio local'); }
      };
      ws.onclose = e => { if (!disposed) setConnection(e.code === 4009 ? 'Abierta en otra pestaña' : 'Desconectada · podés reconectar'); };
      ws.onerror = () => { if (!disposed) setConnection('No se pudo conectar la terminal'); };
    }).catch(() => { if (!disposed) setConnection('Servicio local no disponible'); });
    return () => { disposed = true; resize.disconnect(); input.dispose(); dimensions.dispose(); ws?.close(); if (socket.current === ws) socket.current = null; term.dispose(); terminal.current = null; };
  }, [sessionId, !!state, retry, refresh, refreshContext]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSession = async (history = false, previous?: LabSession) => {
    setBusy(true); setNotice('');
    try {
      const s = await labRequest<LabSession>('/sessions', { project, provider, history, ...(previous ? { resumeOf: previous.id } : {}) });
      await refresh(); setSessionId(s.id); setError('');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'No se pudo abrir la sesión.'); }
    finally { setBusy(false); }
  };
  const stopSession = async () => {
    if (!session) return;
    setBusy(true);
    try { await labRequest('/sessions/' + session.id + '/stop', {}); await refresh(); setNotice('Se solicitó terminar el proceso. La memoria ya guardada permanece en Git.'); }
    catch (e) { setNotice(e instanceof Error ? e.message : 'No se pudo terminar la sesión.'); }
    finally { setBusy(false); }
  };
  const prepareSave = () => {
    if (socket.current?.readyState !== WebSocket.OPEN || session?.state !== 'running') return;
    socket.current.send(JSON.stringify({ type: 'input', data: '\x1b[200~' + SAVE_PROMPT + '\x1b[201~' }));
    terminal.current?.focus();
    setNotice('Pedido de guardado pegado en la terminal. Revisalo y presioná Enter; el commit aparecerá en Memoria cuando el agente lo complete.');
  };
  const selectProject = (id: string) => {
    setProject(id); setContext(null); setNotice('');
    setSessionId(state?.sessions.find(s => s.project === id && s.state === 'running')?.id || null);
  };
  return <div className={'real-lab' + (contextOpen ? '' : ' context-hidden')}>
    <aside className="real-lab-projects">
      <div className="real-lab-local"><span className={state && !error ? 'online' : ''}/>{state && !error ? 'Conectado a esta PC' : 'Servicio local desconectado'}</div>
      <div className="real-lab-label">PROYECTOS REALES</div>
      {state?.projects.map(p => <button className="real-project" aria-pressed={project === p.id} key={p.id} onClick={() => selectProject(p.id)}><Folder size={17}/><span>{p.label}</span></button>)}
      <div className="real-lab-label">SESIONES DEL PROYECTO</div>
      {state?.sessions.filter(s => s.project === project).slice().reverse().map(s => <button className="real-session" aria-pressed={sessionId === s.id} key={s.id} onClick={() => { setSessionId(s.id); setNotice(''); }}>
        <TerminalSquare size={15}/><span>{s.provider === 'codex' ? 'Codex' : 'Claude Code'}<small>{new Date(s.createdAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {STATUS[s.state]}</small></span>
      </button>)}
      {state && !state.sessions.some(s => s.project === project) && <p className="real-lab-muted">Todavía no abriste sesiones en este proyecto.</p>}
      <div className="real-lab-bottom"><button className="main-link" onClick={onMonitor}><FlaskConical size={16}/>Seguimiento SHADOW</button><p>Sesiones del usuario de esta PC. No es un servicio compartido entre cuentas.</p></div>
    </aside>
    <section className="real-lab-center">
      <header className="real-lab-toolbar"><div><strong>{currentProject?.label || 'Lab local'}</strong><span>{session ? connection : 'Elegí un motor para empezar'}</span></div>
        <select aria-label="Motor de la nueva sesión" value={provider} onChange={e => setProvider(e.target.value as 'codex' | 'claude')}>
          {(state?.providers || [{ id: 'codex', label: 'Codex', installed: true }, { id: 'claude', label: 'Claude Code', installed: true }]).map(p => <option key={p.id} value={p.id} disabled={!p.installed}>{p.label}{!p.installed ? ' · no instalado' : ''}</option>)}
        </select>
        <button className="btn" disabled={busy || !state || !!error} onClick={() => openSession()}><Plus size={15}/>Nueva sesión</button>
        <button className="real-lab-icon" aria-label={contextOpen ? 'Ocultar memoria' : 'Mostrar memoria'} onClick={() => setContextOpen(v => !v)}>{contextOpen ? <PanelRightClose size={18}/> : <PanelRightOpen size={18}/>}</button>
      </header>
      {notice && <div className="real-lab-notice" role="status">{notice}<button onClick={() => setNotice('')}>×</button></div>}
      {error && <div className="real-lab-connection" role="alert"><h3>Conectá el servicio del Lab</h3><p>{error}</p><code>node tools/terminal/lab-server.js</code><p>Ejecutalo desde el workspace de GaleCore en esta PC.</p><button className="btn" onClick={refresh}>Reintentar conexión</button></div>}
      <div ref={host} className="real-lab-terminal" style={{ display: session ? 'block' : 'none' }}/>
      {!session && !error && <div className="real-lab-ready"><TerminalSquare size={32}/><h2>{currentProject?.label || 'Cargando proyectos…'}</h2><p>Una terminal real en el workspace del proyecto, con su contexto y herramientas de GaleCore-AI.</p><button className="btn" disabled={!state || busy} onClick={() => openSession()}>Abrir {provider === 'codex' ? 'Codex' : 'Claude Code'}</button><button className="main-link" disabled={!state || busy} onClick={() => openSession(true)}>Retomar desde el historial del CLI</button><small>Usa la autenticación del CLI en esta PC. Si hace falta iniciar sesión, el proveedor lo pedirá en la terminal.</small></div>}
      {session && <footer className="real-lab-footer"><span>{session.provider === 'codex' ? 'Codex' : 'Claude Code'} · {STATUS[session.state]}</span>
        <button className="main-link" onClick={() => { refresh(); setRetry(v => v + 1); }}><RefreshCw size={14}/>Reconectar</button>
        {session.state === 'running' ? <><button className="main-link" onClick={prepareSave} disabled={connection !== 'Conectada'}><GitCommitHorizontal size={15}/>Preparar guardado</button><button className="main-link" disabled={busy} onClick={stopSession}><Square size={12}/>Terminar proceso</button></> : <button className="btn" disabled={busy} onClick={() => openSession(false, session)}>Retomar {session.nativeId ? 'sesión' : 'con selector del CLI'}</button>}
      </footer>}
    </section>
    {contextOpen && <aside className="real-lab-memory"><header><h3>Memoria del proyecto</h3><button className="real-lab-icon" aria-label="Actualizar memoria" onClick={refreshContext}><RefreshCw size={16}/></button></header><p className="real-lab-muted">knowledge/{context?.folder === '.' ? '' : context?.folder || ''}</p>
      {contextError && <p role="alert" className="real-lab-muted">{contextError}</p>}
      <div className="real-lab-label">ARCHIVOS</div>{context?.files.length ? context.files.map(f => <div className="real-lab-file" key={f}>{f}</div>) : <p className="real-lab-muted">Seleccioná una estrategia para ver sus documentos.</p>}
      <div className="real-lab-label">COMMITS LOCALES</div>{context?.commits.map(c => <div className="real-lab-commit" key={c.hash}><span><GitCommitHorizontal size={14}/>{c.hash}</span><p>{c.message}</p><small>{new Date(c.date).toLocaleDateString('es-AR')}</small></div>)}
      {context && <p className="real-lab-muted">{context.changes ? context.changes + ' archivos con cambios sin commit en este alcance.' : 'Sin cambios pendientes en este alcance.'}</p>}
      <p className="real-lab-muted">El agente guarda mediante GaleCore-AI y commitea sus propios cambios. Guardar no aprueba ni despliega una estrategia.</p>
      <button className="main-link" onClick={() => onNavigate('inteligencia')}>Biblioteca real</button>
    </aside>}
  </div>;
}
