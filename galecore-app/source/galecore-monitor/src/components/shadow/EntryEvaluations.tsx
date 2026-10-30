import React, { useEffect, useState } from 'react';
import { fetchShadowDiscards, fetchShadowEvaluations } from '../../api/shadow';
import { ShadowEvaluation, ShadowEvent, ShadowInstance } from '../../types/shadow';
import { MARKET_TZ } from '../../utils/formatters';
import { date } from './panelPresentation';
import { discardLabel, discardReason } from './discardPresentation';

const marketDay = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { timeZone: MARKET_TZ });

/** Lecturas de la instancia actual; las fechas pertenecen a la evidencia, nunca al reloj del navegador. */
export function EntryEvaluations({ instance }: { instance: ShadowInstance | null }) {
  const [data, setData] = useState<{ evaluations: ShadowEvaluation[]; discards: ShadowEvent[] } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const id = instance?.instanceId;
  useEffect(() => {
    let active = true;
    setData(null); setError('');
    if (id) Promise.all([fetchShadowEvaluations(id), fetchShadowDiscards(id)])
      .then(([evaluations, discards]) => { if (active) setData({ evaluations, discards }); })
      .catch(() => { if (active) setError('No se pudieron leer las evaluaciones y sus motivos. Reintentá con Actualizar evaluaciones.'); });
    return () => { active = false; };
  }, [id, retry]);
  const latest = data?.evaluations.slice().sort((a, b) => Date.parse(b.evaluatedAt) - Date.parse(a.evaluatedAt))[0];
  const discards = latest ? data?.discards.filter(event => marketDay(event.timestamp) === marketDay(latest.evaluatedAt))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)) ?? [] : [];
  return <section className="performance-block" aria-label="Evaluación de entradas">
    <div className="trade-log-heading"><h3>Evaluación de entradas</h3>{id && <button className="trade-export" onClick={() => setRetry(n => n + 1)}>Actualizar evaluaciones</button>}</div>
    {!id ? <p>No se pudo identificar una instancia para consultar sus evaluaciones.</p> : <>
      <p>Instancia actual · {instance?.versionHash.slice(0, 19)}</p>
      {error ? <p role="alert">{error}</p> : !data ? <p role="status">Leyendo evaluaciones…</p> : !latest ? <p>Sin evaluaciones registradas para esta instancia.</p> : <>
        <p>Última evaluación registrada: <strong>{date(latest.evaluatedAt)}</strong> · {latest.overallPass ? 'Condiciones de entrada cumplidas; esto no acredita una operación.' : 'Condiciones de entrada no cumplidas.'}</p>
        {latest.gateResults.filter(gate => gate.status !== 'PASS').map(gate => <p key={gate.gateId}>{gate.label || gate.gateId}: {gate.status === 'NO_DATA' ? 'sin dato' : gate.status}</p>)}
        <p>Motivos registrados del {marketDay(latest.evaluatedAt)} (ET), entre los últimos 20 descartes de la instancia:</p>
        {discards.length ? <ul>{discards.map(event => <li key={event.eventId}><time dateTime={event.timestamp}>{date(event.timestamp)}</time> · <strong>{discardLabel(event)}</strong>: {discardReason(event)}</li>)}</ul>
          : <p>Sin descarte registrado para ese día entre las lecturas consultadas. No permite atribuir un motivo de no entrada.</p>}
      </>}
    </>}
  </section>;
}
