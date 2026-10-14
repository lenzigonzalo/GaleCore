import { useEffect, useRef, useState } from 'react';
import { fetchSpace, saveSpaceItem } from '../../api/space';

async function readHidden(): Promise<string[]> {
  const { items } = await fetchSpace();
  const item = items.find(item => item.kind === 'preference' && item.key === 'estrategias' && item.isOwn);
  if (!item) return [];
  const value = JSON.parse(item.content);
  if (!Array.isArray(value?.hidden) || !value.hidden.every((name: unknown) => typeof name === 'string')) throw new Error('Preferencia inválida');
  return Array.from(new Set<string>(value.hidden));
}

/** Preferencia privada, sin estado de módulo que pueda sobrevivir a un cambio de usuario. */
export function useHiddenStrategies() {
  const [hidden, setHidden] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'read' | 'save' | null>(null);
  const [revision, setRevision] = useState(0);
  const request = useRef<{ revision: number; promise: Promise<string[]> } | undefined>(undefined);
  const pending = useRef<string[] | null>(null);
  const saving = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setReady(false); setError(null);
    if (request.current?.revision !== revision) request.current = { revision, promise: readHidden() };
    request.current.promise.then(value => { if (active) { setHidden(value); setReady(true); } })
      .catch(() => { if (active) setError('read'); });
    return () => { active = false; };
  }, [revision]);
  const persist = async (next: string[]) => {
    if (!ready || saving.current) return;
    saving.current = true; pending.current = next; setBusy(true); setError(null);
    try {
      await saveSpaceItem('preference', 'estrategias', { title: 'Estrategias', content: JSON.stringify({ hidden: next }), format: 'json', visibility: 'private' });
      if (mounted.current) { setHidden(next); pending.current = null; }
    } catch { if (mounted.current) setError('save'); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  };
  return { hidden, ready, busy, error,
    toggle: (name: string) => persist(hidden.includes(name) ? hidden.filter(item => item !== name) : [...hidden, name]),
    retry: () => error === 'read' ? setRevision(value => value + 1) : pending.current && void persist(pending.current),
  };
}
