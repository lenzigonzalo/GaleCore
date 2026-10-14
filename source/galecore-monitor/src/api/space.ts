import apiClient from './client';

/**
 * Espacio del trader (GC-0007): lo que GaleCore-AI sabe de cada uno — perfil, objetivos, convenciones, memoria,
 * skills, agentes y datos —, propio o compartido con el equipo. Lo propio se edita; lo compartido por otro, no.
 */
export type SpaceKind = 'profile' | 'objective' | 'convention' | 'memory' | 'skill' | 'agent' | 'data' | 'preference';
export type SpaceVisibility = 'private' | 'shared';
export type SpaceFormat = 'markdown' | 'json';

export interface SpaceItem {
  kind: SpaceKind;
  key: string;
  title: string;
  content: string;
  format: SpaceFormat;
  visibility: SpaceVisibility;
  version: number;
  updatedAt: string;
  owner: string;
  isOwn: boolean;
}

export const SPACE_KINDS: { id: SpaceKind; label: string; hint: string }[] = [
  { id: 'profile',    label: 'Perfil',       hint: 'capital, horizonte, límites, formato' },
  { id: 'objective',  label: 'Objetivos',    hint: 'qué querés lograr' },
  { id: 'convention', label: 'Convenciones', hint: 'cómo trabajás y qué no se hace' },
  { id: 'memory',     label: 'Memoria',      hint: 'lo que GaleCore-AI tiene que recordar' },
  { id: 'skill',      label: 'Skills',       hint: 'métodos que sabe aplicar' },
  { id: 'agent',      label: 'Agentes',      hint: 'lo que corre solo con tus instrucciones' },
  { id: 'data',       label: 'Datos',        hint: 'fuentes que ponés a disposición' },
];

export async function fetchSpace(): Promise<{ items: SpaceItem[]; shared: SpaceItem[] }> {
  const { data } = await apiClient.get<{ items: SpaceItem[]; shared: SpaceItem[] }>('/App/GaleCore/Space');
  return { items: data.items ?? [], shared: data.shared ?? [] };
}

export async function saveSpaceItem(kind: SpaceKind, key: string, body: {
  title: string; content: string; format: SpaceFormat; visibility: SpaceVisibility;
}): Promise<void> {
  await apiClient.put(`/App/GaleCore/Space/${kind}/${encodeURIComponent(key)}`, body);
}

export async function deleteSpaceItem(kind: SpaceKind, key: string): Promise<void> {
  await apiClient.delete(`/App/GaleCore/Space/${kind}/${encodeURIComponent(key)}`);
}

/** Clave estable a partir del título: minúsculas, sin acentos, guiones (la misma forma que valida la API). */
export function keyFromTitle(title: string): string {
  return title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'pieza';
}

/** Only numeric USD capital is available to the SHADOW panel; no risk-text parsing or defaults. */
export async function fetchReferenceCapital(): Promise<number | undefined> {
  try {
    const space = await fetchSpace();
    const profile = space.items.find(i => i.kind === 'profile' && i.isOwn);
    if (!profile) return undefined;
    const capital = JSON.parse(profile.content)?.reference_capital;
    return capital?.currency === 'USD' && typeof capital.amount === 'number' && Number.isFinite(capital.amount)
      ? capital.amount : undefined;
  } catch { return undefined; }
}
