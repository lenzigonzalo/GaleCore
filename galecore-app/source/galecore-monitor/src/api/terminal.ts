/**
 * Terminal local de Claude Code (P1-01c): un servidor chico en la PC del trader (`galecore-lab/server.js` del
 * producto), sólo en loopback. Abre `claude` en GaleCore (el harness, por defecto), o en la carpeta de una estrategia, y lo pasa por
 * WebSocket. Si no corre (otra PC, producción), el panel lo dice y nada más.
 */
import { LOCAL_FETCH, LAB_IS_LOOPBACK } from './lab';

export const TERMINAL_URL = process.env.REACT_APP_TERMINAL_URL || 'http://127.0.0.1:8770';
// WS-0088: cuando el Lab corre en un servidor (no loopback), el server.js local no esta deployado
// y tampoco lo puede alcanzar el browser desde https. Se omite la consulta al terminal.
const TERMINAL_IS_LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(TERMINAL_URL);
const TERMINAL_AVAILABLE = !TERMINAL_IS_LOOPBACK || LAB_IS_LOOPBACK;

export interface TerminalFolder { key: string; label: string }

export async function fetchTerminalFolders(): Promise<TerminalFolder[]> {
  const r = await fetch(`${TERMINAL_URL}/folders`, LOCAL_FETCH);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export function terminalSocketUrl(folder: string, prompt: string, cols: number, rows: number): string {
  const q = new URLSearchParams({ folder, cols: String(cols), rows: String(rows) });
  if (prompt) q.set('prompt', prompt);
  return `${TERMINAL_URL.replace(/^http/, 'ws')}/pty?${q}`;
}

export const TERMINAL_START_HINT = 'node galecore-lab/server.js   (desde la raíz del producto)';

export interface ProviderAuth { id: 'claude' | 'codex'; status: 'authenticated' | 'signed-out' | 'not-installed' | 'unknown' }
export async function fetchProviderAuth(): Promise<{ providers: ProviderAuth[] }> {
  // Lab remoto sin terminal deployado: no hacer la llamada para no ensuciar la consola con CORS.
  if (!TERMINAL_AVAILABLE) return { providers: [{ id: 'claude', status: 'unknown' }, { id: 'codex', status: 'unknown' }] };
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${TERMINAL_URL}/auth/status`, { ...LOCAL_FETCH, signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo comprobar la conexión.');
    return response.json();
  } finally { window.clearTimeout(timer); }
}
export function authSocketUrl(provider: ProviderAuth['id'], cols: number, rows: number): string {
  const params = new URLSearchParams({ auth: provider, cols: String(cols), rows: String(rows) });
  return `${TERMINAL_URL.replace(/^http/, 'ws')}/pty?${params}`;
}
