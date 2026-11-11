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
  approved: boolean; approved_at: string | null; critique: string | null; critique_why_not?: string[];
  factibilidad: { veredicto: string; texto: string; limites_usd?: { capital: number | null; por_operacion: number | null; riesgo_abierto: number | null; por_apuesta: number | null } | null };
  change: { reason: string; from_version: string | null } | null;
  diff_from_previous: VersionDiff | null;
  problem?: string;
}

const base = (name: string) => `/strategies/${name}/versions`;
export async function fetchStrategyVersions(name: string): Promise<StrategyVersion[]> {
  const r = await labRequest<{ strategy: string; versions: StrategyVersion[] }>(base(name));
  return r.versions ?? [];
}
export interface EditableField { path: string; label: string; unit: string; kind: 'number' | 'integer' | 'time'; value: string | number | null }
export const fetchEditableFields = async (name: string, version: string): Promise<EditableField[]> =>
  (await labRequest<{ fields: EditableField[] }>(`${base(name)}/${version}/editable`)).fields ?? [];
/** «Editar»: guarda una versión nueva (borrador) con esos parámetros; devuelve la referencia `strategy:<n>/<v>`. */
export const reviseStrategyVersion = (name: string, version: string, user: string, changes: Record<string, number | string>, reason?: string) =>
  labRequest<{ ref: string }>(`${base(name)}/${version}/revise`, { user, changes, ...(reason ? { reason } : {}) });
/** «Activar esta versión»: la aprueba (el clic confirmado es la aprobación) y la deja corriendo en SHADOW. */
export const activateStrategyVersion = (name: string, version: string, user: string) =>
  labRequest<{ instance_id?: string; existing?: boolean; replaced_hash?: string | null }>(`${base(name)}/${version}/activate`, { user }, 90000);
export const duplicateStrategy = (name: string, version: string, newName: string, user: string) =>
  labRequest<{ projectId?: string }>(`/strategies/${name}/duplicate`, { version, newName, user });
