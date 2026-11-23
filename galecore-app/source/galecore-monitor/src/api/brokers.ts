import apiClient from './client';

/** Brokers del usuario (WS-0108): estado de cada uno, credenciales de IOL e IBKR e interruptor de cartera. */
export type BrokerId = 'tastytrade' | 'ibkr' | 'iol';
export interface BrokerTest { ok: boolean; message: string; at: string }
export interface BrokerEntry {
  id: BrokerId;
  name: string;
  status: 'connected' | 'missing' | 'invalid' | 'soon';
  include: boolean;
  hint?: string;
  lastCheck?: BrokerTest;
  description: string;
}

const base = '/App/GaleCore/Brokers';

export async function fetchBrokers(): Promise<BrokerEntry[]> {
  const { data } = await apiClient.get<BrokerEntry[]>(base);
  return data;
}
export async function saveIolCredentials(username: string, password: string): Promise<BrokerEntry> {
  const { data } = await apiClient.put<BrokerEntry>(`${base}/iol/Credentials`, { username, password });
  return data;
}
export async function removeIolCredentials(): Promise<BrokerEntry> {
  const { data } = await apiClient.delete<BrokerEntry>(`${base}/iol/Credentials`);
  return data;
}
export async function saveIbkrCredentials(token: string, queryId: string): Promise<BrokerEntry> {
  const { data } = await apiClient.put<BrokerEntry>(`${base}/ibkr/Credentials`, { token, queryId });
  return data;
}
export async function removeIbkrCredentials(): Promise<BrokerEntry> {
  const { data } = await apiClient.delete<BrokerEntry>(`${base}/ibkr/Credentials`);
  return data;
}
export async function setBrokerInclude(id: BrokerId, include: boolean): Promise<BrokerEntry> {
  const { data } = await apiClient.put<BrokerEntry>(`${base}/${encodeURIComponent(id)}/Include`, { include });
  return data;
}
export async function testBroker(id: BrokerId): Promise<BrokerTest> {
  const { data } = await apiClient.post<BrokerTest>(`${base}/${encodeURIComponent(id)}/Test`);
  return data;
}
