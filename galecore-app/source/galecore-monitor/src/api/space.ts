import apiClient from './client';

/**
 * Espacio del trader (GC-0007): lo que GaleCore-AI sabe de cada uno — perfil, objetivos, convenciones, memoria,
 * skills, agentes y datos —, propio o compartido con el equipo. Lo propio se edita; lo compartido por otro, no.
 */
export type SpaceKind = 'profile' | 'objective' | 'convention' | 'memory' | 'skill' | 'agent' | 'data' | 'preference' | 'idea';
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

// WS-0057 D: varias pantallas piden el espacio a la vez (Inicio, avisos, Chat, watchlist); se comparte el pedido en curso
// y la respuesta vale unos segundos. Guardar o borrar la invalida.
const SPACE_TTL_MS = 10_000;
type SpaceResponse = { items: SpaceItem[]; shared: SpaceItem[] };
// BF-0017: una clave por `kind` ('' = todo el espacio); pedir un solo tipo baja una fracción de lo que se descarga.
const spaceCache = new Map<string, { at: number; promise: Promise<SpaceResponse> }>();

/** Para tests: cada caso arranca sin la respuesta del anterior. */
export function clearSpaceCache(): void { spaceCache.clear(); }

export function fetchSpace(kind?: string): Promise<SpaceResponse> {
  const key = kind ?? '';
  const hit = spaceCache.get(key);
  if (hit && Date.now() - hit.at < SPACE_TTL_MS) return hit.promise;
  const promise = apiClient.get<SpaceResponse>('/App/GaleCore/Space', kind ? { params: { kind } } : undefined)
    .then(({ data }) => ({ items: data.items ?? [], shared: data.shared ?? [] }));
  spaceCache.set(key, { at: Date.now(), promise });
  promise.catch(() => { if (spaceCache.get(key)?.promise === promise) spaceCache.delete(key); });
  return promise;
}

export async function saveSpaceItem(kind: SpaceKind, key: string, body: {
  title: string; content: string; format: SpaceFormat; visibility: SpaceVisibility;
}): Promise<void> {
  spaceCache.clear();
  await apiClient.put(`/App/GaleCore/Space/${kind}/${encodeURIComponent(key)}`, body);
}

export async function deleteSpaceItem(kind: SpaceKind, key: string): Promise<void> {
  spaceCache.clear();
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
    const space = await fetchSpace('profile');
    const profile = space.items.find(i => i.kind === 'profile' && i.isOwn);
    if (!profile) return undefined;
    const capital = JSON.parse(profile.content)?.reference_capital;
    return capital?.currency === 'USD' && typeof capital.amount === 'number' && Number.isFinite(capital.amount)
      ? capital.amount : undefined;
  } catch { return undefined; }
}
