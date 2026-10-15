import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import apiClient from '../../api/client';
import { fmtPrice, fmtTime, MARKET_TZ } from '../../utils/formatters';
import type { AlgorithmSpec } from './CompactStrategyDesign';

export interface StrategyDataResponse {
  asOf: string; spec: string; version: string; lastEvaluationAt: string | null; storage: string;
  items: Array<{ need: string; capability: string; usedFor: string; source: string; kind: string; history: string; note: string | null; gateId: string | null; lastValue: number | null; lastStatus: string | null; lastAt: string | null }>;
}
export async function fetchStrategyData(spec: string): Promise<StrategyDataResponse> {
  const { data } = await apiClient.get<StrategyDataResponse>('/App/Runtime/Performance/Data', { params: { spec } });
  return data;
}
const at = (iso: string | null) => iso ? `${new Date(iso).toLocaleDateString('es-AR', { timeZone: MARKET_TZ })} · ${fmtTime(new Date(iso))} ET` : '—';
export function StrategyData({ spec, quality }: { spec: string; quality?: AlgorithmSpec['data_quality'] }) {
  const [data, setData] = useState<StrategyDataResponse | null>(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const request = useRef<{ key: string; promise: Promise<StrategyDataResponse> } | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setMissing(false);
    const key = JSON.stringify([spec, retry]);
    if (request.current?.key !== key) request.current = { key, promise: fetchStrategyData(spec) };
    request.current.promise.then(result => { if (active) setData(result); }).catch(e => {
      if (!active) return;
      if (e?.response?.status === 404) setMissing(true);
      else setError('No se pudieron leer los datos de la estrategia.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [spec, retry]);
  return <section className="strategy-data">
    {loading && <p role="status">Leyendo datos de la estrategia…</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>Reintentar</button></div>}
    {missing && <p>Esta estrategia todavía no corre en SHADOW</p>}
    {!loading && !error && !missing && data && <><p className="strategy-data-storage" title={data.storage}>Última evaluación {at(data.lastEvaluationAt)}</p><div className="performance-table strategy-data-table"><table><thead><tr>{['Dato', 'Para qué', 'Fuente', 'Tipo', 'Historia', 'Último visto'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.items.map((item, index) => <tr key={`${item.capability}-${item.gateId}-${index}`}><td>{item.need}{item.note && <span className="data-note" title={item.note} role="img" aria-label="Advertencia"><AlertTriangle size={15}/></span>}</td><td>{item.usedFor}</td><td>{item.source}</td><td>{item.kind}</td><td>{item.history}</td><td>{item.gateId ? <span title={item.lastStatus || undefined}>{item.lastValue === null ? '—' : fmtPrice(item.lastValue)} · {item.lastStatus === 'PASS' ? '✓' : item.lastStatus === 'FAIL' ? '✗' : 'sin dato'}{item.lastAt && <span className="data-last-at">{at(item.lastAt)}</span>}</span> : '—'}</td></tr>)}{!data.items.length && <tr><td colSpan={6}>Sin datos declarados</td></tr>}</tbody></table></div></>}
    {quality && <div className="performance-table strategy-data-table data-quality"><table><thead><tr><th>Calidad de datos</th><th>Configuración</th></tr></thead><tbody>
      {quality.max_quote_age_seconds !== undefined && <tr title="Valor del JSON; no calcula la tolerancia efectiva del runtime SHADOW."><td>Edad de cotización configurada</td><td>{quality.max_quote_age_seconds} segundos</td></tr>}
      {quality.block_on_crossed_market !== undefined && <tr><td>Bloquear mercado cruzado</td><td>{quality.block_on_crossed_market ? 'Sí' : 'No'}</td></tr>}
      {quality.block_on_missing_critical_data !== undefined && <tr><td>Bloquear dato crítico ausente</td><td>{quality.block_on_missing_critical_data ? 'Sí' : 'No'}</td></tr>}
    </tbody></table></div>}
  </section>;
}
