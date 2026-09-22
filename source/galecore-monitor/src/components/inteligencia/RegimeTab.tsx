import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Brain } from 'lucide-react';
import {
  classifyRegimeError, describeRegimeError, fetchRegimeMeta, fetchRegimeRecords, fetchRegimeToday, postRegimeReview,
  REGIME_ADAPTER_URL, storeReviewToken,
} from '../../api/regime';
import { RegimeMeta, RegimeRecord, RegimeRecordsResponse, RegimeReviewRequest, RegimeTodayResponse } from '../../types/regime';
import { NoticePanel } from '../common/NoticePanel';
import { RegimeToday } from './RegimeToday';
import { RegimeHistory } from './RegimeHistory';
import { RegimeDetail, RegimeFailedDetail } from './RegimeDetail';
import { ReviewForm } from './ReviewForm';
import { Mono, SANS, BAD } from './ui';

const RANGES = [30, 60, 90, 180];

/** `days` días antes de una fecha YYYY-MM-DD. Es un parámetro de filtro, no un dato que se muestre. */
function daysBefore(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/**
 * Pestaña Régimen: hoy, historial, detalle y review. Todo sale del adapter local de GaleCore-AI;
 * el análisis y los outcomes siguen llegando desde el host (Claude Code), no desde acá.
 */
export function RegimeTab() {
  const [meta, setMeta] = useState<RegimeMeta | null>(null);
  const [symbol, setSymbol] = useState('');
  const [days, setDays] = useState(60);
  const [today, setToday] = useState<RegimeTodayResponse | null>(null);
  const [records, setRecords] = useState<RegimeRecordsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [selected, setSelected] = useState<{ date: string; runId: string } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewOk, setReviewOk] = useState<string | null>(null);

  const load = useCallback(async (sym: string, range: number) => {
    setLoading(true); setError(null);
    try {
      const m = await fetchRegimeMeta();
      setMeta(m);
      const active = sym || m.symbols[0] || '';
      if (!m.today) {
        // Adapter anterior a GC-AI-0004: sin fecha de hoy no hay estado de hoy ni rango por defecto.
        setError({ title: 'Adapter de registros desactualizado',
          detail: `El adapter en ${REGIME_ADAPTER_URL} no expone /api/today (falta "today" en /api/meta). Actualizá GaleCore-AI y reinicialo.` });
        setSymbol(active); setToday(null); setRecords(null); return;
      }
      if (!active) { setSymbol(active); setToday(null); setRecords(null); return; }
      setSymbol(active);
      const [t, r] = await Promise.all([
        fetchRegimeToday(active),
        fetchRegimeRecords(active, daysBefore(m.today, range)),
      ]);
      setToday(t); setRecords(r);
      // Selección por defecto: el run más reciente. Si ya había una selección vigente, se conserva.
      setSelected((prev) => {
        if (prev && r.records.some((rec) => rec.date === prev.date)) return prev;
        const last = [...r.records].reverse()[0];
        if (!last) return null;
        return last.status === 'OK' ? { date: last.date, runId: last.entries[last.entries.length - 1].run_id } : { date: last.date, runId: '' };
      });
    } catch (e) {
      setError({
        title: classifyRegimeError(e) === 'responded' ? 'El adapter de registros respondió con error' : 'Adapter de registros no disponible',
        detail: describeRegimeError(e),
      });
      setToday(null); setRecords(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load('', 60); }, [load]);

  const selectedRecord: RegimeRecord | null = useMemo(
    () => records?.records.find((r) => r.date === selected?.date) ?? null, [records, selected],
  );
  const selectedEntry = selectedRecord?.status === 'OK'
    ? selectedRecord.entries.find((e) => e.run_id === selected?.runId) ?? null
    : null;

  const submitReview = async (body: RegimeReviewRequest, token: string) => {
    setReviewBusy(true); setReviewError(null); setReviewOk(null);
    try {
      const res = await postRegimeReview(body, token);
      storeReviewToken(token); // aceptado por el adapter: recién ahora se recuerda en esta pestaña
      // La respuesta es el día RELEÍDO por query: se reemplaza el registro en pantalla con eso, no
      // con lo que el formulario mandó.
      if (res.record) {
        setRecords((prev) => prev ? { ...prev, records: prev.records.map((r) => (r.date === res.record!.date ? res.record! : r)) } : prev);
        setToday((prev) => (prev && prev.date === res.record!.date ? { ...prev, record: res.record, status: res.record!.status } : prev));
      }
      // "Guardado" solo si la relectura lo muestra: si el día volvió rechazado o sin el review, se dice eso.
      const reread = res.record?.status === 'OK' ? res.record.entries.find((e) => e.run_id === body.run_id) : undefined;
      const landed = reread?.human_reviews.some((r) => r.verdict === body.verdict && r.comment === body.comment) ?? false;
      if (landed) setReviewOk(`Review ${res.recorded.verdict} guardado en ${res.recorded.path}`);
      else setReviewError(`El adapter contestó 201 pero la relectura del día (${res.record?.status ?? 'sin registro'}) no muestra el review. Actualizá y verificá.`);
    } catch (e) {
      if ((e as { response?: { status?: number } })?.response?.status === 401) storeReviewToken('');
      setReviewError(describeRegimeError(e));
    } finally {
      setReviewBusy(false);
    }
  };

  const symbols = meta?.symbols ?? [];

  return (
    <div style={{ padding: '12px 18px 32px' }}>
      {/* Barra de consulta */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ ...SANS, fontSize: 10.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          Símbolo
          <select value={symbol} onChange={(e) => { setSelected(null); load(e.target.value, days); }} disabled={!symbols.length}
            style={{ ...SANS, fontSize: 11.5, padding: '4px 8px', borderRadius: 6, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
            {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ ...SANS, fontSize: 10.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          Últimos
          <select value={days} onChange={(e) => { const d = Number(e.target.value); setDays(d); load(symbol, d); }}
            style={{ ...SANS, fontSize: 11.5, padding: '4px 8px', borderRadius: 6, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
            {RANGES.map((r) => <option key={r} value={r}>{r} días</option>)}
          </select>
        </label>
        <button className="btn" onClick={() => load(symbol, days)} disabled={loading}>
          <RefreshCw size={11} /> Actualizar
        </button>
        <span style={{ ...SANS, fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {records ? <>Consulta <Mono muted>{records.queried_at}</Mono> · registros en <Mono muted>{records.records_dir}</Mono></> : null}
        </span>
      </div>

      {error && (
        <NoticePanel
          title={error.title}
          detail={error.detail}
          hint={`Los registros viven en GaleCore/research/regime y los sirve un proceso local de GaleCore-AI (${REGIME_ADAPTER_URL}). Sin él esta pestaña no tiene qué mostrar.`}
          icon={<Brain size={18} />}
          color={BAD}
        />
      )}

      {!error && meta && symbols.length === 0 && (
        <NoticePanel title="Sin registros" detail={`El directorio ${meta.records_dir} no tiene carpetas de símbolo.`}
          hint="El primer análisis registrado desde el host crea la carpeta del símbolo." icon={<Brain size={18} />} color="var(--yellow-gc)" />
      )}

      {!error && symbol && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) minmax(0, 1fr)', gap: 16 }}>
          <div>
            <RegimeToday today={today} loading={loading} onSelectRun={(date, runId) => setSelected({ date, runId })} />
            <div style={{ ...SANS, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '4px 0 6px' }}>
              Historial
            </div>
            {loading && !records ? <span className="spinner" /> : (
              <RegimeHistory data={records} selected={selected}
                onSelect={(date, runId) => { setReviewOk(null); setReviewError(null); setSelected({ date, runId }); }}
                onSelectFailed={(date) => setSelected({ date, runId: '' })} />
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            {selectedRecord && selectedRecord.status !== 'OK' && <RegimeFailedDetail symbol={symbol} record={selectedRecord} />}
            {selectedRecord && selectedRecord.status === 'OK' && selectedEntry && (
              <>
                <RegimeDetail date={selectedRecord.date} symbol={symbol} entry={selectedEntry} />
                <ReviewForm key={selectedEntry.run_id + selectedEntry.human_reviews.length}
                  date={selectedRecord.date} symbol={symbol} entry={selectedEntry}
                  enabled={meta?.reviews_enabled ?? false} submitting={reviewBusy} error={reviewError} onSubmit={submitReview} />
                {reviewOk && <div role="status" style={{ ...SANS, fontSize: 11, color: 'var(--green)' }}>{reviewOk}</div>}
              </>
            )}
            {!selectedRecord && records && records.records.length > 0 && (
              <div style={{ ...SANS, fontSize: 11.5, color: 'var(--text-muted)' }}>Elegí un día del historial.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
