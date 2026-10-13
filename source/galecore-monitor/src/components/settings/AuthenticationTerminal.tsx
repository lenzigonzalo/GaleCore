import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { authSocketUrl } from '../../api/terminal';

export function AuthenticationTerminal({ provider, onEnd, onClose }: { provider: 'claude' | 'codex'; onEnd: () => void; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const finish = useRef(onEnd); finish.current = onEnd;
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    let active = true;
    const term = new Terminal({ cursorBlink: true, fontSize: 14, scrollback: 1000,
      fontFamily: 'Cascadia Mono, Consolas, monospace', theme: { background: '#090909', foreground: '#f2f2ef' } });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current); fit.fit();
    let socket: WebSocket | null = null;
    const send = (data: object) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); };
    // StrictMode remounts effects in development: do not start two real logins.
    const connect = window.setTimeout(() => {
      socket = new WebSocket(authSocketUrl(provider, term.cols, term.rows));
      socket.onmessage = event => { if (active && typeof event.data === 'string') term.write(event.data); };
      socket.onerror = () => { if (active) term.write('\r\nNo se pudo conectar con la terminal local.\r\n'); };
      socket.onclose = event => { if (active) {
        if (event.code === 4009) term.write('\r\nYa hay una autenticación en curso para este proveedor.\r\n');
        if (event.code === 4004) term.write('\r\nEl proveedor no está instalado.\r\n');
        setEnded(true); finish.current();
      } };
    }, 0);
    const input = term.onData(data => send({ type: 'input', data }));
    const resize = term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
    const observer = new ResizeObserver(() => { try { fit.fit(); } catch { /* Closing panel. */ } });
    observer.observe(host.current); term.focus();
    return () => { active = false; window.clearTimeout(connect); observer.disconnect(); input.dispose(); resize.dispose(); socket?.close(); term.dispose(); };
  }, [provider]);
  return <section className="settings-auth-terminal" aria-label={`Terminal de autenticación ${provider === 'claude' ? 'Claude Code' : 'Codex'}`}>
    <header><code>{provider === 'claude' ? 'claude auth login' : 'codex login'}</code>{ended && <span>Proceso terminado</span>}<button className="settings-action" onClick={onClose}>{ended ? 'Cerrar' : 'Cancelar'}</button></header>
    <div ref={host} className="settings-auth-terminal-host"/>
  </section>;
}
