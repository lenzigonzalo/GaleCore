import React from 'react';
import { RegimeRecordsResponse } from '../../types/regime';
import { Badge, Mono, OK, WARN, BAD, NOTE, SANS } from './ui';

interface Props {
  data: RegimeRecordsResponse | null;
  selected: { symbol: string; date: string; runId: string } | null;
  onSelect: (date: string, runId: string) => void;
  onSelectFailed: (date: string) => void;
}

/**
 * Historial por fecha, del más reciente al más viejo, con una fila por run_id (un día puede tener
 * más de una entrada). Cada fila muestra sus estados tal como vienen del registro.
 */
export function RegimeHistory({ data, selected, onSelect, onSelectFailed }: Props) {
  if (!data) return null;
  if (data.records.length === 0) {
    return (
      <div style={{ ...SANS, fontSize: 11.5, color: 'var(--text-muted)', padding: '8px 2px' }}>
        Sin registros de <b>{data.symbol}</b> entre <Mono>{data.since}</Mono> y <Mono>{data.until ?? 'hoy'}</Mono>.
      </div>
    );
  }

  const rows = [...data.records].reverse();
  return (
    <div>
      {data.integrity_failed.length > 0 && (
        <div style={{ ...SANS, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
          <Badge color={BAD}>Integridad fallida</Badge> {data.integrity_failed.length} día(s) rechazado(s) por <Mono muted>query</Mono>.
        </div>
      )}
      {data.read_inconsistent.length > 0 && (
        <div style={{ ...SANS, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
          <Badge color={BAD}>Lectura inconsistente</Badge> {data.read_inconsistent.length} día(s) cambiaron mientras se leían; reintentá.
        </div>
      )}
      {rows.map((rec) => {
        if (rec.status !== 'OK') {
          const active = selected?.symbol === data.symbol && selected?.date === rec.date && selected?.runId === '';
          return (
            <button key={rec.date} className="card-interactive" onClick={() => onSelectFailed(rec.date)} style={rowStyle(active)}>
              <Mono>{rec.date}</Mono>
              <div style={{ marginTop: 4 }}>
                <Badge color={BAD}>{rec.status === 'INTEGRITY_FAILED' ? 'Integridad fallida' : 'Lectura inconsistente'}</Badge>
              </div>
            </button>
          );
        }
        return rec.entries.map((e, i) => {
          const active = selected?.symbol === data.symbol && selected?.date === rec.date && selected?.runId === e.run_id;
          return (
            <button key={e.run_id} className="card-interactive" onClick={() => onSelect(rec.date, e.run_id)} style={rowStyle(active)}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <Mono>{rec.date}</Mono>
                {rec.entries.length > 1 && <span style={{ ...SANS, fontSize: 10, color: 'var(--text-muted)' }}>entrada {i + 1}/{rec.entries.length}</span>}
                <span style={{ ...SANS, fontSize: 10.5, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                  {e.accepted_payload.gamma_regime} · {e.accepted_payload.tail_pricing}
                </span>
              </div>
              <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {e.states.outcome_pending ? <Badge color={WARN}>outcome pendiente</Badge> : <Badge color={OK}>{e.outcomes.length} outcome</Badge>}
                {e.states.review_pending ? <Badge color={WARN}>review pendiente</Badge> : <Badge color={OK}>review {e.human_reviews[e.human_reviews.length - 1].verdict}</Badge>}
                {e.annotation && <Badge color={NOTE} title={e.annotation.label}>histórico observado</Badge>}
              </div>
              <div style={{ marginTop: 3 }}><Mono muted>{e.run_id}</Mono></div>
            </button>
          );
        });
      })}
    </div>
  );
}

function rowStyle(active: boolean): React.CSSProperties {
  return {
    display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 6, borderRadius: 8,
    backgroundColor: active ? 'var(--bg-elevated)' : 'var(--bg-secondary)',
    border: `1px solid ${active ? 'var(--blue-gc)' : 'var(--border-dark)'}`,
    color: 'var(--text-primary)', cursor: 'pointer',
  };
}
