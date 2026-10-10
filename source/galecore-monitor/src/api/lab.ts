/** Puente local del Lab. Token efímero sólo en memoria, nunca en URL o localStorage. */
export const LAB_URL = 'http://127.0.0.1:8771';
export interface LabProject { id: string; label: string }
export interface LabProvider { id: 'codex' | 'claude'; label: string; installed: boolean }
export interface LabSession { id: string; project: string; provider: 'codex' | 'claude'; title: string; createdAt: string; state: 'running' | 'ended' | 'interrupted'; nativeId: string | null; exitCode: number | null; resumeOf: string | null }
export interface LabState { projects: LabProject[]; providers: LabProvider[]; sessions: LabSession[]; scope: string }
export interface LabContext { project: string; folder: string; files: string[]; commits: { hash: string; date: string; message: string }[]; changes: number }
let token: string | null = null;
let pendingToken: Promise<string> | null = null;
async function request(url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12000);
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
export async function labRequest<T>(url: string, body?: object): Promise<T> {
  const send = async () => request(url, { method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + await labToken(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  let r = await send();
  if (r.status === 401) { token = null; r = await send(); }
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || 'No se pudo completar el pedido.');
  return value;
}
