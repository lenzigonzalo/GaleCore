/** Puente local del Lab. Token efímero sólo en memoria, nunca en URL o localStorage. */
export const LAB_URL = 'http://127.0.0.1:8771';
export interface LabProject { id: string; label: string }
export interface LabProvider { id: 'codex' | 'claude'; label: string; installed: boolean }
export interface LabSession { id: string; project: string; provider: 'codex' | 'claude'; title: string; createdAt: string; state: 'running' | 'ended' | 'interrupted'; nativeId: string | null; exitCode: number | null; resumeOf: string | null }
export interface LabState { projects: LabProject[]; providers: LabProvider[]; sessions: LabSession[]; scope: string }
export interface LabContext { project: string; folder: string; files: string[]; commits: { hash: string; date: string; message: string }[]; changes: number }
let token: string | null = null;
let pendingToken: Promise<string> | null = null;
async function request(url: string, options: RequestInit = {}, timeout = 12000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try { return await fetch(LAB_URL + url, { ...options, signal: controller.signal }); }
  finally { window.clearTimeout(timer); }
}
export async function labToken(): Promise<string> {
  if (token) return token;
  if (!pendingToken) pendingToken = request('/bootstrap').then(async r => {
    if (!r.ok) throw new Error('El servicio sólo acepta el monitor local de esta PC.');
    const data = await r.json(); token = data.token; return data.token as string;
  }).finally(() => { pendingToken = null; });
  return pendingToken;
}
export async function labRequest<T>(url: string, body?: object, timeout = 12000): Promise<T> {
  const send = async () => request(url, { method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + await labToken(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) }, timeout);
  let r = await send();
  if (r.status === 401) { token = null; r = await send(); }
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || 'No se pudo completar el pedido.');
  return value;
}

export type LabProjectKind = 'personal' | 'analysis' | 'strategy';
export interface WorkspaceProject { id: string; label: string; type: LabProjectKind; relative: string; strategyName: string | null }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; at: string }
export interface WorkspaceChat { id: string; project: string; provider: 'codex' | 'claude'; model?: string; effort?: string; title: string; createdAt?: string; turnStartedAt?: number; state: 'idle' | 'running' | 'interrupted' | 'failed' | 'cancelled'; activity: string; steps?: { label: string; detail?: string; kind?: 'note'; at: string }[]; error: string | null; messages: ChatMessage[] }
export interface ChatOptions { models: string[]; efforts: string[]; defaultModel?: string; modelEfforts?: Record<string, string[]> }
export interface WorkspaceState { projects: WorkspaceProject[]; chats: Omit<WorkspaceChat, 'messages'>[]; providers: LabProvider[]; chatOptions?: Partial<Record<'codex' | 'claude', ChatOptions>> }
export interface WorkspaceFile { path: string; name: string; kind: 'folder' | 'file'; text?: false; children?: WorkspaceFile[] }

/** Sube un adjunto del chat a adjuntos/ del proyecto (WS-0036); devuelve la ruta que se nombra en el mensaje. */
export async function labUpload(projectId: string, file: File, dir?: string): Promise<{ path: string; name: string; size: number }> {
  // Con `dir` (Archivos → Subir) va a esa carpeta con su nombre; sin él, a adjuntos/.
  const send = async () => request('/workspaces/' + encodeURIComponent(projectId) + '/attachments' + (dir !== undefined ? '?dir=' + encodeURIComponent(dir) : ''), { method: 'POST',
    headers: { Authorization: 'Bearer ' + await labToken(), 'X-File-Name': encodeURIComponent(file.name) }, body: file }, 120000);
  let r = await send();
  if (r.status === 401) { token = null; r = await send(); }
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || 'No se pudo adjuntar el archivo.');
  return value;
}

/** Shell del proyecto (owner 17/10): PowerShell en la carpeta del proyecto, por WebSocket con el token del Lab. */
export const labShellUrl = () => LAB_URL.replace(/^http/, 'ws') + '/shell';
