/**
 * Terminal local de Claude Code (P1-01c): un servidor chico en la PC del trader (`tools/terminal/server.js` del
 * workspace), sólo en loopback. Abre `claude` en GaleCore (el harness, por defecto), en la carpeta de una estrategia o en el workspace, y lo pasa por
 * WebSocket. Si no corre (otra PC, producción), el panel lo dice y nada más.
 */
export const TERMINAL_URL = process.env.REACT_APP_TERMINAL_URL || 'http://127.0.0.1:8770';

export interface TerminalFolder { key: string; label: string }

export async function fetchTerminalFolders(): Promise<TerminalFolder[]> {
  const r = await fetch(`${TERMINAL_URL}/folders`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export function terminalSocketUrl(folder: string, prompt: string, cols: number, rows: number): string {
  const q = new URLSearchParams({ folder, cols: String(cols), rows: String(rows) });
  if (prompt) q.set('prompt', prompt);
  return `${TERMINAL_URL.replace(/^http/, 'ws')}/pty?${q}`;
}

export const TERMINAL_START_HINT = 'node tools/terminal/server.js   (desde el workspace)';

export interface ProviderAuth { id: 'claude' | 'codex'; status: 'authenticated' | 'signed-out' | 'not-installed' | 'unknown' }
export async function fetchProviderAuth(): Promise<{ providers: ProviderAuth[] }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${TERMINAL_URL}/auth/status`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo comprobar la conexión.');
    return response.json();
  } finally { window.clearTimeout(timer); }
}
export function authSocketUrl(provider: ProviderAuth['id'], cols: number, rows: number): string {
  const params = new URLSearchParams({ auth: provider, cols: String(cols), rows: String(rows) });
  return `${TERMINAL_URL.replace(/^http/, 'ws')}/pty?${params}`;
}
