export interface LocalMcpServer {
  id: string; name: string; provider: 'claude' | 'codex'; context: string; scope: string;
  enabled: boolean; transport: string; file: string; revision: string;
}
export interface LocalMcpInventory { servers: LocalMcpServer[]; workspace: string; status: string }
export const localMcpAvailable = () => ['localhost', '127.0.0.1'].includes(window.location.hostname);
const URL = 'http://127.0.0.1:8772';
let token: string | null = null;
async function request<T>(path: string, body?: object): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    if (!token) {
      const r = await fetch(URL + '/bootstrap', { signal: controller.signal });
      if (!r.ok) throw new Error('El servicio sólo acepta localhost:3039.');
      token = (await r.json()).token;
    }
    const r = await fetch(URL + path, { method: body ? 'POST' : 'GET', signal: controller.signal,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (r.status === 401) token = null;
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'No se pudo completar el pedido.');
    return data;
  } finally { window.clearTimeout(timer); }
}
export const fetchLocalMcp = () => request<LocalMcpInventory>('/inventory');
export const toggleLocalMcp = (server: LocalMcpServer, enabled: boolean) =>
  request<LocalMcpInventory>('/toggle', { id: server.id, enabled, revision: server.revision });
