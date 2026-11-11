import React, { useEffect, useState } from 'react';
import { fetchShadowEvaluations, fetchShadowEvents } from '../../api/shadow';
import { ShadowEvaluation, ShadowEvent, ShadowInstance } from '../../types/shadow';
import { useCurrentUserStore } from '../../store/useCurrentUserStore';
import { registryEntries } from './ficha';

/** Registro legible: qué pasó en la estrategia, lo más nuevo primero. Mira las últimas instancias para que «Pausada» y «Prendida» queden juntas. */
export function RegistryLog({ instances }: { instances: ShadowInstance[] }) {
  const userId = useCurrentUserStore(s => s.user?.userId);
  const [data, setData] = useState<{ events: ShadowEvent[]; evaluations: ShadowEvaluation[] } | null>(null);
  const [error, setError] = useState('');
  const key = instances.map(i => i.instanceId).join(',');
  useEffect(() => {
    let active = true; setData(null); setError('');
    Promise.resolve().then(() => Promise.all(instances.map(i => Promise.all([fetchShadowEvents(i.instanceId, 200), fetchShadowEvaluations(i.instanceId, 100)]))))
      .then(rows => { if (active) setData({ events: rows.flatMap(r => r[0]), evaluations: rows.flatMap(r => r[1]) }); })
      .catch(() => { if (active) setError('No se pudo leer el registro.'); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Leyendo el registro…</p>;
  const entries = registryEntries(data.events, data.evaluations, userId, Object.fromEntries(instances.map(i => [i.instanceId, i.deployedBy])));
  if (!entries.length) return <p>Sin registros todavía.</p>;
  const days = Array.from(new Set(entries.map(e => e.day)));
  return <section className="performance-block registry" aria-label="Registro">
    {days.map(day => <div key={day}><h3>{day} <span className="registry-zone">· hora NY</span></h3><ul>{entries.filter(e => e.day === day).map(e => <li key={e.key} className={e.tone}>
      <time>{e.hour}</time> {e.text}{e.gates && <ul className="registry-gates">{e.gates.map((g, i) => <li key={i}>{g}</li>)}</ul>}</li>)}</ul></div>)}
  </section>;
}
