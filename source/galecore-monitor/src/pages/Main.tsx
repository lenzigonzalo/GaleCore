import React from 'react';
import { MainDemo } from './MainDemo';
import { ArrowUpRight } from 'lucide-react';
import type { Tab } from '../components/layout/TabNav';
import { AccountSummary } from '../components/account/AccountSummary';
import { useAccountStore } from '../store/useAccountStore';
import { fmtPrice, fmtTime } from '../utils/formatters';

/** Inicio de gestión: sólo lecturas de la cuenta real. */
export function Main({ onNavigate, onConnectBroker, demo = false, onDemoChange }: { onNavigate: (tab: Tab) => void; onConnectBroker?: () => void; demo?: boolean; onDemoChange?: (demo: boolean) => void }) {
  const { positions, loadingPositions, errorPositions, positionsReadAt, brokerAccountIssue } = useAccountStore();
  if (demo) return <MainDemo onExit={() => onDemoChange?.(false)} />;
  const link = (tab: Tab, label: string) => <button className="main-link" onClick={() => onNavigate(tab)}>{label}<ArrowUpRight size={16} /></button>;
  return <div className="main-dashboard">
    <div className="workspace-scope"><span>Monitor · cuenta real</span>{onDemoChange && <button className="main-link" onClick={() => onDemoChange(true)}>Ver ejemplo visual · demo</button>}<button className="main-link" onClick={() => onNavigate('lab')}>Abrir Lab<ArrowUpRight size={16} /></button></div>
    <div className="space-intro"><div><span className="space-eyebrow">MONITOR</span><h2>Tu cartera, en perspectiva.</h2><p>Resultados, exposición y contexto para enfocar tu atención.</p></div></div>
    <div className="main-account-row main-account-only">
      <section className="main-account"><h2>Tu cuenta</h2>{brokerAccountIssue ? <div className="broker-connect-state">
        <h3>{brokerAccountIssue === 'not_linked' ? 'Conectá tu cuenta de Tastytrade' : 'Revisá la conexión de Tastytrade'}</h3>
        <p>{brokerAccountIssue === 'not_linked' ? 'Vinculá la cuenta para ver tu saldo y tus posiciones.' : 'La credencial guardada fue rechazada. Actualizala para volver a leer la cuenta.'}</p>
        <button className="btn" onClick={() => onConnectBroker ? onConnectBroker() : onNavigate('config')}>{brokerAccountIssue === 'not_linked' ? 'Vincular cuenta' : 'Revisar conexión'}</button>
      </div> : <AccountSummary layout="strip" />}{link('monitor', 'Ver cartera')}</section>

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
    <div className="monitor-planning-grid"><section className="space-panel"><h3>Exposición y concentración</h3><span className="space-status">Lectura agregada pendiente</span><p>Distribución por subyacente, estrategia y riesgo. La cuenta real todavía no tiene esta lectura integrada.</p></section><section className="space-panel"><h3>Agenda de tu cartera</h3><span className="space-status">Cruce con posiciones pendiente</span><p>Eventos y vencimientos relevantes para lo que tenés abierto.</p></section><section className="space-panel"><h3>Contexto de mercado</h3><span className="space-status">Resumen macro pendiente</span><p>Qué historia domina, qué cambió y qué podría afectar tu exposición.</p><button className="main-link" onClick={() => onNavigate('gex')}>Explorar mercado<ArrowUpRight size={16}/></button></section></div>
    <div className="main-context-grid">
      <section className="main-section" aria-labelledby="main-performance">
        <div className="main-section-heading"><h2 id="main-performance">Performance de tu cuenta</h2>{link('monitor', 'Ver cartera')}</div>
        <p className="main-unavailable">Historia no disponible</p><p className="main-source">Todavía no hay una serie de patrimonio ni resultados diarios completos para esta cuenta.</p>
      </section>
      <section className="main-section" aria-labelledby="main-news">
        <div className="main-section-heading"><h2 id="main-news">Actualidad de tu cartera</h2>{link('gex', 'Abrir Mercado')}</div>
        <p className="main-unavailable">Sin fuente integrada</p><p className="main-source">Noticias y avisos de la cuenta real no disponibles. Podés consultar el contexto de mercado por instrumento.</p>
      </section>
    </div>
  </div>;
}
