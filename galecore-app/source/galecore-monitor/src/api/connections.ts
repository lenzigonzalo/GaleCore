import apiClient from './client';

/**
 * Claves de conexión (WS-0080). La API nunca devuelve el valor de una clave: sólo el estado, el final
 * enmascarado (`hint`) y quién/cuándo la cambió. El valor sale de acá una sola vez, en el PUT.
 */
export interface ConnectionTest { at: string; ok: boolean; message: string }
export interface ConnectionEntry {
  id: string;
  name: string;
  kind: 'source' | 'broker' | 'mcp';
  owner: 'platform' | 'personal';
  needsKey: 'required' | 'optional' | 'none';
  keyLabel?: string;
  status: 'connected' | 'missing' | 'not-needed' | 'error' | 'local';
  origin: 'database' | 'server' | null;
  hint?: string;
  updatedAt?: string;
  updatedBy?: string;
  lastTest?: ConnectionTest;
  description: string;
  /** Agrupa las fuentes de la plataforma (p. ej. «Estados Unidos», «Argentina»); null si no hay grupo. */
  group?: string | null;
}
export interface ConnectionsResponse {
  canEdit: boolean;
  storageReady: boolean;
  storageMessage?: string;
  connections: ConnectionEntry[];
}

const base = '/App/GaleCore/Connections';

export async function fetchConnections(): Promise<ConnectionsResponse> {
  const { data } = await apiClient.get<ConnectionsResponse>(base);
  return data;
}
export async function saveConnectionKey(id: string, value: string): Promise<ConnectionEntry> {
  const { data } = await apiClient.put<ConnectionEntry>(`${base}/${encodeURIComponent(id)}/Key`, { value });
  return data;
}
export async function resetConnectionKey(id: string): Promise<ConnectionEntry> {
  const { data } = await apiClient.delete<ConnectionEntry>(`${base}/${encodeURIComponent(id)}/Key`);
  return data;
}
export async function testConnection(id: string): Promise<ConnectionTest> {
  const { data } = await apiClient.post<ConnectionTest>(`${base}/${encodeURIComponent(id)}/Test`);
  return data;
}
