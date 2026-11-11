import { labRequest } from './lab';

export interface VersionDiff {
  from: string;
  spec: { path: string; from: unknown; to: unknown }[];
  rules: { rule: string; change: string; text: string; fields?: string[] }[];
  parameters: { name: string; from: unknown; to: unknown }[];
  management?: unknown[];
}
export interface StrategyVersion {
  version: string; ref: string; recorded_at: string; spec_hash: string; check: string;
  approved: boolean; approved_at: string | null; critique: string | null;
  factibilidad: { veredicto: string; texto: string };
  change: { reason: string; from_version: string | null } | null;
  diff_from_previous: VersionDiff | null;
  problem?: string;
}

const base = (name: string) => `/strategies/${name}/versions`;
export async function fetchStrategyVersions(name: string): Promise<StrategyVersion[]> {
  const r = await labRequest<{ strategy: string; versions: StrategyVersion[] }>(base(name));
  return r.versions ?? [];
}
export const approveStrategyVersion = (name: string, version: string, user: string) =>
  labRequest<unknown>(`${base(name)}/${version}/approve`, { user });
export const duplicateStrategy = (name: string, version: string, newName: string, user: string) =>
  labRequest<{ projectId?: string }>(`/strategies/${name}/duplicate`, { version, newName, user });
