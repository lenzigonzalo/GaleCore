/** Puente local del Lab. Token efímero sólo en memoria, nunca en URL o localStorage. */
// Producción: el Lab de :8771. En desarrollo (.env.development / galecore_dev.py monitor) el Lab de Dev, :8781.
export const LAB_URL = process.env.REACT_APP_LAB_URL || 'http://127.0.0.1:8771';
/** Desde la plataforma (https) Chrome sólo deja hablarle a esta PC si el pedido lo declara: así pide el permiso de red local. */
export const LOCAL_FETCH = { targetAddressSpace: 'loopback' } as RequestInit;
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
  try { return await fetch(LAB_URL + url, { ...LOCAL_FETCH, ...options, signal: controller.signal }); }
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

export type SyncState = 'ok' | 'syncing' | 'conflict' | 'error' | 'pending';   // pending = hay cambios locales sin subir
export type SyncAction = 'retry' | 'reshare' | 'remove' | 'sync';
/** Aviso de una sincronización de proyecto compartido: archivos que se editaron en las dos PCs (quedaron las dos versiones). */
export interface SyncNotice { at: string; error?: string; skipped?: { path: string; reason: string }[]; conflicts: { path: string; with: string; copy: string | null; kind: 'editado-en-ambos' | 'borrado-aquí' | 'borrado-allá' }[] }
export interface WorkspaceProject { id: string; label: string; relative: string; strategies?: string[]; externalStrategy?: boolean; shared?: boolean; following?: boolean; mine?: boolean; syncNotice?: SyncNotice | null; lastSync?: string | null; syncState?: SyncState; notice?: string | null; action?: SyncAction }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; at: string; attachments?: string[] }
export interface WorkspaceChat { id: string; project: string; provider: 'codex' | 'claude'; model?: string; effort?: string; title: string; createdAt?: string; turnStartedAt?: number; state: 'idle' | 'running' | 'interrupted' | 'failed' | 'cancelled'; activity: string; steps?: { label: string; detail?: string; kind?: 'note'; at: string }[]; error: string | null; notice?: string | null; mode?: string; usage?: ChatUsage; tasks?: ChatTask[]; limitResetsAt?: number | true; permission?: { id: string; tool: string; label: string; detail?: string; always?: boolean } | null; messages: ChatMessage[] }
export interface ChatTask { id: string; kind: 'agent' | 'command'; label: string; agentType?: string; status: string; last?: string; tools?: number; tokens?: number; summary?: string }
export interface ChatUsage { turns: { at: string; input: number; output: number; cached: number; costUsd?: number }[]; context?: { used: number; window: number }; limit?: { status?: string; resetsAt?: number; windows?: Record<string, { utilization?: number; resetsAt?: number }> } }
export interface ChatOptions { models: string[]; efforts: string[]; defaultModel?: string; modelEfforts?: Record<string, string[]> }
export interface WorkspaceState { update?: { commit: string | null; updatable: boolean; notice: string | null }; defaultProvider?: 'codex' | 'claude'; projects: WorkspaceProject[]; chats: Omit<WorkspaceChat, 'messages'>[]; providers: LabProvider[]; chatOptions?: Partial<Record<'codex' | 'claude', ChatOptions>> }
export interface WorkspaceFile { path: string; name: string; kind: 'folder' | 'file'; text?: false; image?: boolean; children?: WorkspaceFile[] }

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

/** Lee el adjunto con la misma autenticación local del chat, sin tokens en URLs. */
export async function labAttachment(projectId: string, path: string): Promise<Blob> {
  const send = async () => request('/workspaces/' + encodeURIComponent(projectId) + '/attachments?path=' + encodeURIComponent(path), {
    headers: { Authorization: 'Bearer ' + await labToken() },
  }, 120000);
  let r = await send();
  if (r.status === 401) { token = null; r = await send(); }
  if (!r.ok) throw new Error('No se pudo abrir el adjunto.');
  return r.blob();
}

/** Shell del proyecto (owner 17/10): PowerShell en la carpeta del proyecto, por WebSocket con el token del Lab. */
export const labShellUrl = () => LAB_URL.replace(/^http/, 'ws') + '/shell';

/** Imagen de cualquier carpeta del proyecto, para la vista previa (misma autenticación que el adjunto). */
export async function labRaw(projectId: string, path: string): Promise<Blob> {
  const send = async () => request('/workspaces/' + encodeURIComponent(projectId) + '/raw?path=' + encodeURIComponent(path), {
    headers: { Authorization: 'Bearer ' + await labToken() },
  }, 120000);
  let r = await send();
  if (r.status === 401) { token = null; r = await send(); }
  if (!r.ok) throw new Error('No se pudo abrir la imagen.');
  return r.blob();
}
