import React, { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { fetchShadowMetrics } from '../api/shadow';
import type { SpecVersionMetrics } from '../types/shadow';
import { fmtPnl, fmtTime } from '../utils/formatters';

/** Resultados del runtime simulado por versión; no representan patrimonio del bróker. */
export function ShadowOverview({ onMonitor }: { onMonitor: () => void }) {
  const [metrics, setMetrics] = useState<SpecVersionMetrics[] | null>(null);
  const [metricsError, setMetricsError] = useState(false);
  const [readAt, setReadAt] = useState<Date | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const result = await fetchShadowMetrics();
        if (alive) { setMetrics(result); setMetricsError(false); setReadAt(new Date()); }
      } catch { if (alive) { setMetrics(null); setMetricsError(true); } }
    };
    load(); const timer = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return (    <section className="main-section" aria-labelledby="main-results">
      <div className="main-section-heading"><h2 id="main-results">Resultados de estrategias</h2>{<button className="main-link" onClick={onMonitor}>Ver ejecuciones<ArrowUpRight size={16} /></button>}</div>
      <p className="main-source">SHADOW · ejecución simulada con datos reales · separado del saldo de tu cuenta{readAt ? ' · lectura ' + fmtTime(readAt) + ' ET' : ''}</p>
      {metricsError ? <p role="alert">No se pudieron leer los resultados SHADOW.</p> : !metrics ? <p>Leyendo resultados…</p>
        : metrics.length === 0 ? <p className="main-source">No hay métricas de estrategias desplegadas.</p>
        : <details className="main-shadow-details" open><summary>Ver resultados por versión <span>{metrics.length} {metrics.length === 1 ? 'versión' : 'versiones'}</span></summary><div className="main-results-table"><table><thead><tr><th>Estrategia / versión</th><th>Abiertas</th><th>Cerradas</th><th>P&amp;L realizado</th><th>P&amp;L abierto</th></tr></thead>
        <tbody>{metrics.map(m => <tr key={m.contentHash}><td><button className="main-link" onClick={onMonitor}>{m.specName} · v{m.specVersion}<ArrowUpRight size={14} /></button><details className="main-history-pending"><summary>Identidad de versión</summary><code>{m.contentHash}</code></details></td>
          <td>{m.positionsOpen}</td><td>{m.positionsClosed}</td>
          <td style={{ color: m.realizedPnl == null ? undefined : m.realizedPnl >= 0 ? 'var(--green-gc)' : 'var(--red-gc)' }}>{m.realizedPnl == null ? 'Sin cierres' : fmtPnl(m.realizedPnl)}</td>
          <td style={{ color: m.unrealizedPnl == null ? undefined : m.unrealizedPnl >= 0 ? 'var(--green-gc)' : 'var(--red-gc)' }}>{m.unrealizedPnl == null ? 'Sin valuación' : fmtPnl(m.unrealizedPnl)}{m.openPositionsNotValued > 0 && <small>{m.openPositionsNotValued} sin valuar · resultado parcial</small>}</td>
        </tr>)}</tbody></table></div></details>}
    </section>);
}
