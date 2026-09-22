import React from 'react';
import { RegimeTodayResponse } from '../../types/regime';
import { Badge, Card, Mono, OK, WARN, BAD, SANS } from './ui';

interface Props {
  today: RegimeTodayResponse | null;
  loading: boolean;
  onSelectRun?: (date: string, runId: string) => void;
}

/**
 * Estado de hoy: ¿hay análisis? ¿falta el outcome? ¿falta mi review? Tres respuestas y nada más.
 *
 * "Hoy" es la fecha en la zona de la convención (America/New_York), que la decide el adapter: un
 * registro se fecha por el día de mercado, no por el reloj del navegador. Los estados vienen del
 * registro (`states`), no se infieren acá.
 */
export function RegimeToday({ today, loading, onSelectRun }: Props) {
  if (loading && !today) {
    return <Card title="Hoy"><span className="spinner" /></Card>;
  }
  if (!today) return null;

  const dateLine = (
    <span style={{ ...SANS, fontSize: 11, color: 'var(--text-muted)' }}>
      {today.symbol} · <Mono>{today.date}</Mono> ({today.timezone})
    </span>
  );

  if (today.status === 'NO_RECORD') {
    return (
      <Card title="Hoy">
        {dateLine}
        <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge color={WARN}>Sin análisis de hoy</Badge>
          <span style={{ ...SANS, fontSize: 11, color: 'var(--text-secondary)' }}>
            Todavía no se registró un análisis para esta fecha. El análisis se pide desde el host (Claude Code) con
            <Mono muted> accept --record</Mono>; después de la sesión de contado.
          </span>
        </div>
      </Card>
    );
  }

  if (today.record && today.record.status !== 'OK') {
    return (
      <Card title="Hoy" color={BAD}>
        {dateLine}
        <div style={{ marginTop: 8 }}>
          <Badge color={BAD}>{today.record.status === 'INTEGRITY_FAILED' ? 'Integridad fallida' : 'Lectura inconsistente'}</Badge>
          <ul style={{ ...SANS, fontSize: 11, color: 'var(--text-secondary)', margin: '6px 0 0', paddingLeft: 18 }}>
            {today.record.problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      </Card>
    );
  }

  const entries = today.record?.status === 'OK' ? today.record.entries : [];
  return (
    <Card title="Hoy">
      {dateLine}
      {entries.map((e) => (
        <div key={e.run_id} style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge color={OK}>Análisis disponible</Badge>
          {e.states.outcome_pending
            ? <Badge color={WARN}>Outcome pendiente</Badge>
            : <Badge color={OK}>{e.outcomes.length} outcome{e.outcomes.length === 1 ? '' : 's'}</Badge>}
          {e.states.review_pending
            ? <Badge color={WARN}>Review pendiente</Badge>
            : <Badge color={OK}>Review: {e.human_reviews[e.human_reviews.length - 1].verdict}</Badge>}
          <span style={{ ...SANS, fontSize: 11, color: 'var(--text-muted)' }}>
            {e.accepted_payload.gamma_regime} · tail {e.accepted_payload.tail_pricing}
          </span>
          {onSelectRun && (
            <button className="btn" onClick={() => onSelectRun(today.date, e.run_id)} style={{ marginLeft: 'auto' }}>
              Ver detalle
            </button>
          )}
        </div>
      ))}
    </Card>
  );
}
