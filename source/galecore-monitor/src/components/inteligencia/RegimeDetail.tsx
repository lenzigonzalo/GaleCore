import React from 'react';
import { RegimeEntry, RegimeRecordFailed } from '../../types/regime';
import { Badge, Bullets, Card, H3, KV, Mono, Table, fmtDelta, fmtVal, OK, WARN, BAD, NOTE, SANS } from './ui';

/**
 * Detalle de una entrada: qué se interpretó, con qué datos y cuándo, qué pasó después y qué dijo el
 * humano. Todo viene del registro vía el adapter; acá solo se ordena para leerlo.
 *
 * La comparación con el outcome muestra los dos valores y la diferencia numérica. NO es una
 * calificación de acierto: evaluar si la lectura fue buena con la información que había es el
 * trabajo del review humano (guía HUMAN-REVIEW-GUIDE.md), y una diferencia a favor o en contra no
 * lo decide.
 */
export function RegimeDetail({ date, symbol, entry }: { date: string; symbol: string; entry: RegimeEntry }) {
  const p = entry.accepted_payload;
  const sources = entry.facts.sources ?? {};
  const lastReview = entry.human_reviews[entry.human_reviews.length - 1];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ ...SANS, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>{date} · {symbol}</span>
        <Badge color={OK}>Integridad OK</Badge>
        {entry.states.outcome_pending ? <Badge color={WARN}>Outcome pendiente</Badge> : <Badge color={OK}>{entry.outcomes.length} outcome{entry.outcomes.length === 1 ? '' : 's'}</Badge>}
        {entry.states.review_pending ? <Badge color={WARN}>Review pendiente</Badge> : <Badge color={OK}>Review: {lastReview.verdict}</Badge>}
        {entry.annotation && <Badge color={NOTE}>{entry.annotation.kind.replace('_', ' ')}</Badge>}
      </div>

      {entry.annotation && (
        <Card title="Anotación del owner (no forma parte del registro)" color={NOTE}>
          <div style={{ ...SANS, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{entry.annotation.label}</div>
          <div style={{ ...SANS, fontSize: 13.5, color: 'var(--text-primary)', margin: '4px 0' }}>{entry.annotation.note}</div>
          <div style={{ ...SANS, fontSize: 12.5, color: 'var(--text-muted)' }}>
            Fuente: {entry.annotation.source} · decidido {entry.annotation.decided_on} · ligada a <Mono muted wrap>{entry.annotation.entry_hash}</Mono>
          </div>
        </Card>
      )}

      <Card title="Cuándo y con qué datos">
        <KV rows={[
          { k: 'Prompt', v: entry.prompt },
          { k: 'run_id', v: <Mono>{entry.run_id}</Mono> },
          { k: 'Snapshot preparado', v: <Mono>{entry.snapshot.prepared_at}</Mono> },
          { k: 'Dato de mercado más antiguo', v: <><Mono>{entry.snapshot.market_data_as_of ?? '—'}</Mono> · frescura <b>{entry.snapshot.freshness_status}</b></> },
          { k: 'Interpretación aceptada', v: <Mono>{entry.accepted_at}</Mono> },
          { k: 'Registro escrito', v: <Mono>{entry.recorded_at}</Mono> },
        ]} />
        <div style={{ marginTop: 8 }}>
          <Table
            head={['Fuente', 'Capability', 'Frescura', 'Dato al', 'Recibido']}
            rows={Object.entries(sources).map(([k, s]) => [
              <b key="k">{k}</b>,
              <><Mono>{s.capability_id}</Mono><br /><Mono muted>{s.endpoint}</Mono></>,
              <><Badge color={s.freshness_status === 'VALID' ? OK : WARN}>{s.freshness_status}</Badge><br /><span style={{ ...SANS, fontSize: 12, color: 'var(--text-muted)' }}>{s.freshness_basis}</span></>,
              <Mono>{s.market_data_as_of ?? '—'}</Mono>,
              <Mono>{s.response_received_at ?? '—'}</Mono>,
            ])}
          />
          <div style={{ ...SANS, fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
            Timestamps tal como quedaron en el registro (UTC). Procedencia de los facts: <b>{entry.trace.facts_provenance}</b>. Datos históricos, no actuales.
          </div>
        </div>
      </Card>

      <Card title="Interpretación aceptada">
        <div style={{ ...SANS, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          Régimen gamma: {p.gamma_regime} · Tail pricing: {p.tail_pricing}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <div><H3>Observaciones</H3><Bullets items={p.observations} /></div>
          <div><H3>Implicancias</H3><Bullets items={p.implications} /></div>
        </div>
        <H3>Limitaciones declaradas</H3>
        <Bullets items={p.limitations} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginTop: 8 }}>
          <div>
            <H3>Claims cuantitativos (validados contra facts al aceptar)</H3>
            <Table
              head={['Métrica', { label: 'Claim', num: true }, 'Unidad', { label: 'Fact', num: true }, '']}
              rows={entry.claims.map((c) => [c.metric, fmtVal(c.value), c.unit, fmtVal(c.fact_value),
                c.matches ? <span style={{ color: OK }}>igual</span> : <span style={{ color: BAD, fontWeight: 700 }}>difiere</span>])}
            />
          </div>
          <div>
            <H3>Evidencia (claim → fact)</H3>
            <Table head={['Claim', 'Path', { label: 'Valor', num: true }]}
              rows={entry.evidence.map((ev) => [ev.claim, <Mono key="p">{ev.fact_path}</Mono>, fmtVal(ev.fact_value)])} />
          </div>
        </div>
      </Card>

      {entry.states.outcome_pending ? (
        <Card title="Qué pasó después">
          <Badge color={WARN}>Outcome pendiente</Badge>
          <span style={{ ...SANS, fontSize: 13, color: 'var(--text-secondary)', marginLeft: 8 }}>
            Todavía no se registró un outcome para esta entrada (<Mono muted>record outcome</Mono> desde el host). No hay nada que comparar.
          </span>
        </Card>
      ) : (
        <Card title="Qué pasó después — interpretación vs. outcome">
          <div style={{ ...SANS, fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6 }}>
            Valores al aceptar y valores observados después, con su diferencia. Es una comparación de datos, no una calificación de acierto: eso lo decide el review humano.
          </div>
          {entry.comparisons.map((c, k) => (
            <div key={k}>
              <H3>Outcome {k + 1} · observado <Mono>{c.observed_at}</Mono> · procedencia {entry.outcomes[k]?.facts_provenance}</H3>
              <Table
                head={['Métrica', { label: 'Al aceptar', num: true }, { label: 'Observado', num: true }, { label: 'Δ', num: true }]}
                rows={c.rows.map((r) => [r.metric, fmtVal(r.before), fmtVal(r.after), fmtDelta(r.delta)])}
              />
              <div style={{ ...SANS, fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>facts_hash del outcome: <Mono muted wrap>{entry.outcomes[k]?.facts_hash}</Mono></div>
            </div>
          ))}
        </Card>
      )}

      <Card title="Review humano">
        {entry.human_reviews.length === 0
          ? <><Badge color={WARN}>Review pendiente</Badge><span style={{ ...SANS, fontSize: 13, color: 'var(--text-secondary)', marginLeft: 8 }}>Todavía no dejaste un veredicto para este run_id.</span></>
          : entry.human_reviews.map((r, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <Badge color={r.verdict === 'agree' ? OK : r.verdict === 'disagree' ? BAD : WARN}>{r.verdict}</Badge>
              <Mono muted> {r.reviewed_at}</Mono>
              <div style={{ ...SANS, fontSize: 13.5, color: 'var(--text-primary)', marginTop: 3 }}>{r.comment}</div>
            </div>
          ))}
      </Card>

      <Card title="Facts y assurance">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          <div>
            <H3>Facts (GaleCore)</H3>
            <Table head={['Campo', { label: 'Valor', num: true }]}
              rows={Object.entries(entry.facts).filter(([k]) => k !== 'sources').map(([k, v]) => [k, fmtVal(v)])} />
          </div>
          <div>
            <H3>Guardrails en la aceptación</H3>
            <Table head={['Guardrail', '', 'Detalle']}
              rows={entry.trace.guardrails.map((g) => [g.guardrail_id,
                g.passed ? <span style={{ color: OK }}>pass</span> : <span style={{ color: BAD, fontWeight: 700 }}>FAIL</span>,
                <span key="m" style={{ color: 'var(--text-muted)' }}>{g.message}</span>])} />
            <H3>Host (declarado, no verificado)</H3>
            <KV rows={[{ k: 'Proveedor / modelo', v: <>{entry.host.provider} / {entry.host.model} <span style={{ color: 'var(--text-muted)' }}>({entry.host.provenance})</span></> }]} />
            <H3>Activos cognitivos efectivos</H3>
            <Table head={['Activo', 'Versión', 'Hash']}
              rows={[['agent', entry.effective_assets.agent] as const,
                ...(['skills', 'protocols', 'conventions'] as const).flatMap((g) => Object.entries(entry.effective_assets[g]).map(([k, v]) => [`${g}/${k}`, v] as const))]
                .map(([k, v]) => [k, v.version, <Mono key="h" muted wrap>{v.content_hash}</Mono>])} />
            <H3>Hashes del registro</H3>
            <KV rows={[
              { k: 'facts_hash', v: <Mono muted wrap>{entry.facts_hash}</Mono> },
              { k: 'entry_hash', v: <Mono muted wrap>{entry.entry_hash}</Mono> },
              { k: 'conventions_hash', v: <Mono muted wrap>{entry.snapshot.conventions_hash}</Mono> },
            ]} />
          </div>
        </div>
      </Card>
    </div>
  );
}

/** Un día que `query` rechazó: se muestran los problemas y nada del contenido. */
export function RegimeFailedDetail({ symbol, record }: { symbol: string; record: RegimeRecordFailed }) {
  const inconsistent = record.status === 'READ_INCONSISTENT';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ ...SANS, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>{record.date} · {symbol}</span>
        <Badge color={BAD}>{inconsistent ? 'Lectura inconsistente' : 'Integridad fallida'}</Badge>
      </div>
      <Card title={inconsistent ? 'El registro cambió mientras se leía' : 'query rechazó este archivo'} color={BAD}>
        <div style={{ ...SANS, fontSize: 13.5, color: 'var(--text-primary)', marginBottom: 6 }}>
          {inconsistent
            ? 'Lo que query devolvió y la lectura de detalle no coinciden tras varios reintentos; no se muestra ninguna versión. Volvé a consultar.'
            : 'Las verificaciones de integridad de query fallaron. Nada de lo que hay en el archivo puede tomarse como registro válido, y no se puede dejar un review sobre él.'}
        </div>
        <KV rows={[
          { k: 'Archivo', v: <Mono muted wrap>{record.path ?? '—'}</Mono> },
          { k: 'Problemas', v: <Bullets items={record.problems} /> },
        ]} />
      </Card>
    </div>
  );
}
