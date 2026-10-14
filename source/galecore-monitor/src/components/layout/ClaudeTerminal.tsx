import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { fetchTerminalFolders, terminalSocketUrl, TerminalFolder } from '../../api/terminal';
import { useTerminalStore } from '../../store/useTerminalStore';

/**
 * Claude Code en el monitor (P1-01c, U-58/U-70): una terminal real con `claude`, en el workspace o en la carpeta de
 * una estrategia. No es un chat propio: es la misma sesión de Claude Code (skills, memoria, hooks, el plan de la PC),
 * servida por `tools/terminal/server.js` en loopback. «Analizá este aviso» abre una sesión con el pedido ya enviado.
 *
 * Ocultar el panel no corta la sesión; «Nueva sesión» o cambiar de carpeta sí (cierra `claude` y abre otro).
 */
export function ClaudeTerminal({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [width, setWidth] = useState(460);
  const [maximum, setMaximum] = useState(720);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const resize = (next: number) => setWidth(Math.max(260, Math.min(maximum, next)));

  const { open, session, start, setOpen } = useTerminalStore();
  const [folders, setFolders] = useState<TerminalFolder[] | null>(null);
  const [down, setDown] = useState(false);
  const [folder, setFolder] = useState('galecore');
  const [ended, setEnded] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!open || !panel.current?.parentElement) return;
    const container = panel.current.parentElement;
    const fit = () => {
      const nav = container.querySelector('.workspace-navigation')?.getBoundingClientRect().width || 0;
      const max = Math.max(260, Math.min(720, container.clientWidth - nav - 280));
      setMaximum(max); setWidth(previous => Math.max(260, Math.min(max, previous)));
    };
    fit(); const observer = new ResizeObserver(fit); observer.observe(container);
    return () => observer.disconnect();
  }, [open]);

  // ¿Corre el servidor local? Se pregunta cada vez que se abre el panel: pudo levantarse después.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchTerminalFolders()
      .then(f => { if (alive) { setFolders(f); setDown(false); } })
      .catch(() => { if (alive) setDown(true); });
    return () => { alive = false; };
  }, [open]);

  // Abrir el panel sin sesión arranca una en la carpeta elegida: un click y está `claude`.
  useEffect(() => {
    if (open && !session && folders && !down) start(folder);
  }, [open, session, folders, down, folder, start]);

  useEffect(() => {
    if (session) setFolder(session.folder);
  }, [session]);

  // Una terminal y un socket por sesión.
  useEffect(() => {
    if (!session || !host.current || down) return;
    setEnded(false);
    let alive = true;                           // el cierre del socket anterior llega tarde: no cuenta
    const term = new Terminal({
      cursorBlink: true, fontSize: 13, scrollback: 5000, convertEol: false,
      fontFamily: getComputedStyle(host.current).getPropertyValue('--font-mono'),
      theme: { background: '#141414', foreground: '#e6e6e6', cursor: '#e6e6e6', selectionBackground: '#3a3a3a' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fitRef.current = fit;
    try { fit.fit(); } catch { /* panel oculto: se ajusta al mostrarse */ }
    const ws = new WebSocket(terminalSocketUrl(session.folder, session.prompt, term.cols, term.rows));
    const send = (m: object) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
    ws.onmessage = e => term.write(typeof e.data === 'string' ? e.data : '');
    ws.onclose = () => { if (alive) setEnded(true); };
    ws.onerror = () => term.write('\r\nNo se pudo conectar con la terminal local.\r\n');
    const input = term.onData(data => send({ type: 'input', data }));
    const resize = term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* oculto */ } });
    ro.observe(host.current);
    term.focus();
    return () => {
      alive = false; ro.disconnect(); input.dispose(); resize.dispose(); ws.close(); term.dispose(); fitRef.current = null;
    };
  }, [session, down]);

  // Al volver a mostrarse, la terminal toma el tamaño del panel.
  useEffect(() => {
    if (open) { try { fitRef.current?.fit(); } catch { /* sin terminal */ } }
  }, [open]);

  if (!open && !session) return null;

  const btn: React.CSSProperties = { fontSize: 12, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
    border: '1px solid var(--border-dark)', color: 'var(--text-secondary)', background: 'transparent' };

  return (
    <aside ref={panel} className="workspace-terminal" style={{ position: 'relative', flexShrink: 0, display: open ? 'flex' : 'none', flexDirection: 'column', width, minWidth: 260,
      borderLeft: '1px solid var(--border-dark)', backgroundColor: '#141414' }}>
      <div className="terminal-resize" role="separator" tabIndex={0} aria-label="Ancho del chat dividido" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={maximum} aria-valuenow={width}
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (drag.current) resize(drag.current.width + drag.current.x - event.clientX); }}
        onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize(width + (event.key === 'ArrowLeft' ? 20 : -20)); } }}/>
      <div className="terminal-heading" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        borderBottom: '1px solid var(--border-dark)', backgroundColor: 'var(--bg-secondary)' }}>
        <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>Claude Code</span>
        {folders && (
          <select value={folder} onChange={e => { setFolder(e.target.value); start(e.target.value); }}
            title="Dónde se abre claude: el workspace o la carpeta de una estrategia"
            style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, background: 'var(--bg-primary)',
              color: 'var(--text-secondary)', border: '1px solid var(--border-dark)' }}>
            {folders.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        )}
        {ended && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>sesión terminada</span>}
        <span style={{ flex: 1 }} />
        {!down && <button style={btn} onClick={() => start(folder)}>Nueva sesión</button>}
        <button onClick={() => setOpen(false)} aria-label="Ocultar chat dividido" title="Ocultar (la sesión sigue)"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>
      {down ? (
        <div style={{ padding: 16, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p>La terminal local no está disponible en este equipo.</p>
          {onOpenSettings && <button style={btn} onClick={onOpenSettings}>Ver conexiones</button>}
          <button style={btn} onClick={() => { setOpen(false); setTimeout(() => setOpen(true), 0); }}>Reintentar</button>
        </div>
      ) : (
        <div ref={host} style={{ flex: 1, minHeight: 0, padding: '6px 0 0 8px' }} />
      )}
    </aside>
  );
}
