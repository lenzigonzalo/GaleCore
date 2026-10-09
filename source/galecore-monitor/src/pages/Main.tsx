import React, { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Tab } from '../components/layout/TabNav';
import { AccountSummary } from '../components/account/AccountSummary';
import { useAccountStore } from '../store/useAccountStore';
import { fetchShadowMetrics } from '../api/shadow';
import type { SpecVersionMetrics } from '../types/shadow';
import { fmtPnl, fmtPrice, fmtTime } from '../utils/formatters';
import { Today } from './Today';

/** Resumen de lecturas existentes. Cuenta real y ejecución SHADOW se muestran por separado. */
export function Main({ onNavigate, onConnectBroker }: { onNavigate: (tab: Tab) => void; onConnectBroker?: () => void }) {
  const { positions, loadingPositions, errorPositions, positionsReadAt, brokerAccountIssue } = useAccountStore();
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
  const link = (tab: Tab, label: string) => <button className="main-link" onClick={() => onNavigate(tab)}>{label}<ArrowUpRight size={16} /></button>;
  return <div className="main-dashboard">
    <div className="main-account-row">
      <section className="main-account"><h2>Tu cuenta</h2>{brokerAccountIssue ? <div className="broker-connect-state">
        <h3>{brokerAccountIssue === 'not_linked' ? 'Conectá tu cuenta de Tastytrade' : 'Revisá la conexión de Tastytrade'}</h3>
        <p>{brokerAccountIssue === 'not_linked' ? 'Vinculá la cuenta para ver tu saldo y tus posiciones.' : 'La credencial guardada fue rechazada. Actualizala para volver a leer la cuenta.'}</p>
        <button className="btn" onClick={() => onConnectBroker ? onConnectBroker() : onNavigate('config')}>{brokerAccountIssue === 'not_linked' ? 'Vincular cuenta' : 'Revisar conexión'}</button>
      </div> : <AccountSummary />}{link('monitor', 'Ver cartera')}</section>
      <section className="main-shortcuts"><h2>Ir al detalle</h2>
        {link('gex', 'Mercado y gráficos')}{link('estrategias', 'Estrategias')}
        {link('shadow', 'Ejecuciones SHADOW')}{link('agentes', 'Agentes y trabajos')}
      </section>
    </div>
    {!brokerAccountIssue && <section className="main-section" aria-labelledby="main-positions">
      <div className="main-section-heading"><h2 id="main-positions">Posiciones abiertas</h2>{link('monitor', 'Ver todas en Cartera')}</div>
      <p className="main-source">Cuenta de bróker · instrumentos recibidos de GaleCore{positionsReadAt ? ' · lectura ' + fmtTime(positionsReadAt) + ' ET' : ''}</p>
      {loadingPositions ? <p>Leyendo posiciones…</p> : errorPositions ? <p role="alert">No se pudieron leer las posiciones. Actualizá la cuenta o revisá la conexión en Configuración.</p>
        : !positionsReadAt ? <p className="main-source">Todavía no se leyeron las posiciones.</p> : positions.length === 0 ? <p className="main-source">La última lectura no contiene posiciones abiertas.</p>
        : <div className="main-positions"><table><thead><tr><th>Instrumento</th><th>Cantidad</th><th>Dirección</th><th>Precio informado</th><th><span className="sr-only">Detalle</span></th></tr></thead>
          <tbody>{positions.map((p, i) => <tr key={p.symbol + i}>
            <td><strong>{p.underlyingSymbol || p.symbol}</strong><span>{p.symbol}</span></td>
            <td className="numeric">{p.quantity}</td><td>{p.quantityDirection}</td><td className="numeric">{fmtPrice(p.closePrice)}</td>
            <td><button className="main-link" aria-label={'Ver ' + p.symbol + ' en Cartera'} onClick={() => onNavigate('monitor')}>Ver<ArrowUpRight size={16} /></button></td>
          </tr>)}</tbody></table><p className="main-source">Instrumentos del bróker, sin estrategia vinculada.</p></div>}
    </section>}
    <section className="main-section" aria-labelledby="main-results">
      <div className="main-section-heading"><h2 id="main-results">Resultados de estrategias</h2>{link('shadow', 'Abrir SHADOW')}</div>
      <p className="main-source">SHADOW · ejecución simulada con datos reales · separado del saldo de tu cuenta{readAt ? ' · lectura ' + fmtTime(readAt) + ' ET' : ''}</p>
      {metricsError ? <p role="alert">No se pudieron leer los resultados SHADOW.</p> : !metrics ? <p>Leyendo resultados…</p>
        : metrics.length === 0 ? <p className="main-source">No hay métricas de estrategias desplegadas.</p>
        : <details className="main-shadow-details"><summary>Ver resultados por versión <span>{metrics.length} {metrics.length === 1 ? 'versión' : 'versiones'}</span></summary><div className="main-results-table"><table><thead><tr><th>Estrategia / versión</th><th>Abiertas</th><th>Cerradas</th><th>P&amp;L realizado</th><th>P&amp;L abierto</th></tr></thead>
        <tbody>{metrics.map(m => <tr key={m.contentHash}><td><button className="main-link" onClick={() => onNavigate('shadow')}>{m.specName} · v{m.specVersion}<ArrowUpRight size={14} /></button><details className="main-history-pending"><summary>Identidad de versión</summary><code>{m.contentHash}</code></details></td>
          <td>{m.positionsOpen}</td><td>{m.positionsClosed}</td>
          <td style={{ color: m.realizedPnl == null ? undefined : m.realizedPnl >= 0 ? 'var(--green-gc)' : 'var(--red-gc)' }}>{m.realizedPnl == null ? 'Sin cierres' : fmtPnl(m.realizedPnl)}</td>
          <td style={{ color: m.unrealizedPnl == null ? undefined : m.unrealizedPnl >= 0 ? 'var(--green-gc)' : 'var(--red-gc)' }}>{m.unrealizedPnl == null ? 'Sin valuación' : fmtPnl(m.unrealizedPnl)}{m.openPositionsNotValued > 0 && <small>{m.openPositionsNotValued} sin valuar · resultado parcial</small>}</td>
        </tr>)}</tbody></table></div></details>}
      <details className="main-history-pending"><summary>Performance de la cuenta y calendario diario</summary><p>La lectura actual de la cuenta devuelve saldo y posiciones, sin una serie histórica de patrimonio ni resultados diarios completos. El calendario y los gráficos de performance quedan pendientes de ese contrato; no se reconstruyen desde el saldo actual o las métricas SHADOW.</p></details>
    </section>
    <section className="main-keys" aria-label="Claves del día"><Today onNavigate={onNavigate} /></section>
  </div>;
}
