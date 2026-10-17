import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { labShellUrl, labToken } from '../../api/lab';

/**
 * Shell del proyecto (owner 17/10): una terminal común y corriente (PowerShell) abierta en la carpeta del proyecto, al
 * lado de Archivos. La sirve el Lab local por WebSocket; cambiar de proyecto o «Nueva terminal» abre otra.
 */
export function LabShell({ projectId, folder, visible }: { projectId: string; folder?: string; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [run, setRun] = useState(0);
  const [ended, setEnded] = useState('');
  useEffect(() => {
    if (!host.current) return;
    let alive = true; setEnded('');
    const term = new Terminal({
      cursorBlink: true, fontSize: 13, scrollback: 5000,
      fontFamily: getComputedStyle(host.current).getPropertyValue('--font-code'),
      theme: { background: '#0f0f0f', foreground: '#e6e6e6', cursor: '#e6e6e6', selectionBackground: '#3a3a3a' },
    });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current); fitRef.current = fit; termRef.current = term; term.focus();
    try { fit.fit(); } catch { /* oculto: se ajusta al mostrarse */ }
    let ws: WebSocket | null = null;
    const send = (m: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
    labToken().then(token => {
      if (!alive) return;
      ws = new WebSocket(labShellUrl());
      ws.onopen = () => send({ type: 'open', token, project: projectId, cols: term.cols, rows: term.rows });
      ws.onmessage = e => { try { const m = JSON.parse(String(e.data)); if (m.type === 'output') term.write(m.data); } catch { /* sólo mensajes del Lab */ } };
      ws.onclose = e => { if (alive) setEnded(e.code === 4029 ? 'Hay cuatro terminales abiertas.' : e.code === 1000 ? 'La terminal se cerró.' : 'Sin conexión con el Lab local.'); };
    }).catch(() => { if (alive) setEnded('Sin conexión con el Lab local.'); });
    const input = term.onData(data => send({ type: 'input', data }));
    const resize = term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
    const observer = new ResizeObserver(() => { try { fit.fit(); } catch { /* oculto */ } });
    observer.observe(host.current);
    return () => { alive = false; observer.disconnect(); input.dispose(); resize.dispose(); ws?.close(); term.dispose(); fitRef.current = null; termRef.current = null; };
  }, [projectId, run]);
  useEffect(() => { if (visible) { try { fitRef.current?.fit(); } catch { /* sin terminal */ } termRef.current?.focus(); } }, [visible]);
  return <div className="lab-shell" hidden={!visible}>
    <header><span>PowerShell{folder ? ' · ' + folder : ''}</span>{ended && <em>{ended}</em>}<button type="button" onClick={() => setRun(v => v + 1)}>Nueva terminal</button></header>
    <div ref={host} className="lab-shell-screen"/>
  </div>;
}
