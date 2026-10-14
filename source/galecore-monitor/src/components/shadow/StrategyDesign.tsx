import React, { useEffect, useRef, useState } from 'react';
import { labRequest, WorkspaceState } from '../../api/lab';
import type { StrategyView } from '../../pages/LabStrategySheet';
import { CompactStrategyDesign } from './CompactStrategyDesign';

export function useStrategyDesign(spec: string) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<StrategyView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [absent, setAbsent] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef<{ key: string; promise: Promise<{ strategy: StrategyView; projectId: string } | null> } | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const key = JSON.stringify([spec, retry]);
    if (request.current?.key !== key) request.current = { key, promise: labRequest<WorkspaceState>('/workspaces').then(async workspace => {
      const project = workspace.projects.find(item => item.strategyName === spec);
      if (!project) return null;
      const data = await labRequest<StrategyView>(`/workspaces/${encodeURIComponent(project.id)}/strategy?view=design`, undefined, 65000);
      if (data.integrity_failed?.length) throw new Error('El harness detectó un problema de integridad en este proyecto.');
      return { strategy: data, projectId: project.id };
    }) };
    void request.current.promise.then(data => { if (active) { setAbsent(data === null); setStrategy(data?.strategy ?? null); setProjectId(data?.projectId ?? null); } })
      .catch(e => { if (active) setError(e.message || 'No se pudo leer el diseño.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [spec, retry]);
  return { strategy, projectId, loading, error, absent, retry: () => setRetry(n => n + 1) };
}
export function StrategyDesign({ design }: { design: ReturnType<typeof useStrategyDesign> }) {
  if (design.loading) return <div className="performance-skeleton design-skeleton" role="status" aria-label="Cargando diseño" />;
  if (design.error) return <div role="alert"><p>{design.error}</p><button onClick={design.retry}>Reintentar</button></div>;
  if (design.absent) return <p>Esta estrategia no tiene proyecto en el Lab</p>;
  return <CompactStrategyDesign strategy={design.strategy} />;
}
