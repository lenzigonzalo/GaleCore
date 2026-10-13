import apiClient from './client';
import type { MacroSnapshot } from '../types/macroTypes';

export async function fetchMacro(horizon: string, region: string, signal: AbortSignal, snapshotId?: string): Promise<MacroSnapshot> {
  const { data } = await apiClient.get<MacroSnapshot>(snapshotId ? `/App/Macro/Snapshots/${snapshotId}` : '/App/Macro/Snapshot',
    { params: snapshotId ? undefined : { horizon, region, currency: 'Local' }, signal, timeout: 20000 });
  return data;
}
