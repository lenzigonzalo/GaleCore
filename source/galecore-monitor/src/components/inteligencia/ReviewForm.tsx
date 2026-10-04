import React, { useState } from 'react';
import { RegimeEntry, ReviewVerdict } from '../../types/regime';
import { getStoredReviewToken } from '../../api/regime';
import { Badge, Card, Mono, OK, WARN, BAD, SANS } from './ui';

interface Props {
  date: string;
  symbol: string;
  entry: RegimeEntry;
  /** false cuando el adapter corre con --no-reviews: el formulario se muestra deshabilitado. */
  enabled: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (body: { symbol: string; date: string; run_id: string; verdict: ReviewVerdict; comment: string }, token: string) => void;
}

const VERDICTS: { id: ReviewVerdict; label: string; color: string; help: string }[] = [
  { id: 'agree',    label: 'Agree',    color: OK,   help: 'La lectura era razonable con la información que había' },
  { id: 'partial',  label: 'Partial',  color: WARN, help: 'Parte de la lectura se sostiene; parte no' },
  { id: 'disagree', label: 'Disagree', color: BAD,  help: 'La lectura no era razonable con esa información' },
];

/**
 * El review humano sobre UN run_id. Es el único punto donde el monitor escribe algo en
 * GaleCore-AI, y lo hace a través de `record_review` (mismas garantías que el CLI): el veredicto y
 * el comentario se agregan al registro sin tocar la parte hasheada.
 *
 * El token es el secreto compartido que imprime el adapter al arrancar (o REGIME_REVIEW_TOKEN).
 * Se pide una vez por pestaña del navegador y se guarda en sessionStorage; sin él el adapter
 * contesta 401 y no escribe.
 */
export function ReviewForm({ date, symbol, entry, enabled, submitting, error, onSubmit }: Props) {
  const [verdict, setVerdict] = useState<ReviewVerdict | null>(null);
  const [comment, setComment] = useState('');
  const [token, setToken] = useState(getStoredReviewToken);

  const canSubmit = enabled && !submitting && verdict !== null && comment.trim().length > 0 && token.trim().length > 0;

  // El token se guarda en sessionStorage recién cuando el adapter lo aceptó (lo hace RegimeTab
  // al recibir el 201): un token equivocado no queda recordado después de un 401.
  const submit = () => {
    if (!canSubmit || !verdict) return;
    onSubmit({ symbol, date, run_id: entry.run_id, verdict, comment: comment.trim() }, token.trim());
  };

  return (
    <Card title={entry.human_reviews.length ? 'Agregar otro review' : 'Dejar mi review'}>
      <div style={{ ...SANS, fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
        Sobre <Mono>{entry.run_id}</Mono> ({date}). Evaluá la calidad de la lectura con la información disponible; el
        resultado posterior se mira aparte.
      </div>
      {!enabled && (
        <div style={{ ...SANS, fontSize: 13, color: WARN, marginBottom: 8 }}>
          El adapter corre sin reviews (<Mono muted>--no-reviews</Mono>); reinicialo sin ese flag para escribir.
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {VERDICTS.map((v) => (
          <button key={v.id} type="button" className="btn" disabled={!enabled} title={v.help}
            onClick={() => setVerdict(v.id)}
            style={verdict === v.id ? { borderColor: v.color, color: v.color, background: 'var(--bg-elevated)' } : undefined}
            aria-pressed={verdict === v.id}>
            {v.label}
          </button>
        ))}
        {verdict && <Badge color={VERDICTS.find((v) => v.id === verdict)!.color}>{verdict}</Badge>}
      </div>
      <textarea
        value={comment} onChange={(e) => setComment(e.target.value)} disabled={!enabled}
        placeholder="Comentario (obligatorio): qué se sostuvo, qué no, qué faltó ver…"
        rows={3} aria-label="Comentario del review"
        style={{ ...SANS, width: '100%', fontSize: 13.5, padding: 8, borderRadius: 6, resize: 'vertical',
          background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <input
          type="password" value={token} onChange={(e) => setToken(e.target.value)} disabled={!enabled}
          placeholder="Token de review (lo imprime el adapter al arrancar)" aria-label="Token de review"
          autoComplete="off"
          style={{ ...SANS, flex: '1 1 260px', fontSize: 13, padding: '6px 8px', borderRadius: 6,
            background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />
        <button type="button" className="btn" disabled={!canSubmit} onClick={submit}
          style={canSubmit ? { borderColor: 'var(--blue-gc)', color: 'var(--text-primary)' } : undefined}>
          {submitting ? <span className="spinner" /> : 'Guardar review'}
        </button>
      </div>
      {error && <div role="alert" style={{ ...SANS, fontSize: 13, color: BAD, marginTop: 6 }}>{error}</div>}
    </Card>
  );
}
