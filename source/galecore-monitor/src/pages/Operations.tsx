import React from 'react';
import { ArrowUpRight, Layers, ListChecks, Clock3, ShieldCheck } from 'lucide-react';
import type { Tab } from '../components/layout/TabNav';
import { useAccountStore } from '../store/useAccountStore';
import { fmtPrice } from '../utils/formatters';

export function Operations({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { positions, loadingPositions, errorPositions, positionsReadAt } = useAccountStore();
  return <div className="operations-workspace">
    <div className="space-intro"><div><span className="space-eyebrow">OPERATIVA</span><h2>Todo lo que tenés en juego.</h2><p>Posiciones, reglas y decisiones de gestión, en una misma mesa.</p></div><span className="space-status">Órdenes LIVE no integradas</span></div>
    <div className="operations-summary">
      <button onClick={() => onNavigate('estrategias')}><Layers size={21}/><span>Estrategias<strong>Ver estrategias</strong></span><ArrowUpRight size={17}/></button>
      <button onClick={() => onNavigate('monitor')}><ListChecks size={21}/><span>Posiciones de la cuenta<strong>{loadingPositions ? 'Leyendo…' : errorPositions || !positionsReadAt ? 'Sin lectura disponible' : positions.length + ' instrumentos'}</strong></span><ArrowUpRight size={17}/></button>
      <div><Clock3 size={21}/><span>Próximos vencimientos<strong>Agenda pendiente</strong></span></div>
      <div><ShieldCheck size={21}/><span>Reglas de gestión<strong>Vinculación pendiente</strong></span></div>
    </div>
    <div className="operations-grid">
      <section className="space-panel operations-positions"><div className="space-panel-heading"><h3>Posiciones abiertas</h3><button className="main-link" onClick={() => onNavigate('monitor')}>Abrir detalle <ArrowUpRight size={16}/></button></div>
        <p className="space-panel-note">Instrumentos de la cuenta · sin asociación automática a estrategias.</p>
        {loadingPositions ? <div className="space-empty">Leyendo posiciones…</div> : errorPositions || !positionsReadAt ? <div className="space-empty"><ListChecks size={28}/><h4>Esperando la lectura de tu cuenta</h4><p>Acá vas a seguir cada posición, su objetivo y su próxima decisión de gestión.</p></div> : positions.length === 0 ? <div className="space-empty"><h4>Sin posiciones en la última lectura</h4><p>Las posiciones de tu cuenta aparecerán en esta mesa.</p></div> :
          <div className="main-results-table"><table><thead><tr><th>Instrumento</th><th>Cantidad</th><th>Dirección</th><th>Precio informado</th></tr></thead><tbody>{positions.map((p, i) => <tr key={p.symbol + i}><td><strong>{p.underlyingSymbol || p.symbol}</strong><small>{p.symbol}</small></td><td>{p.quantity}</td><td>{p.quantityDirection}</td><td>{fmtPrice(p.closePrice)}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="space-panel"><div className="space-panel-heading"><h3>Atención y gestión</h3><span className="space-status">Pendiente</span></div><div className="management-row"><span>01</span><div><h4>Salidas y objetivos</h4><p>Take profit, stop y condiciones de salida por posición.</p></div></div><div className="management-row"><span>02</span><div><h4>Vencimientos y ajustes</h4><p>Qué vence, qué revisar y qué alternativas considerar.</p></div></div><div className="management-row"><span>03</span><div><h4>Impacto de eventos</h4><p>Eventos cruzados con posiciones y reglas vigentes.</p></div></div><p className="space-panel-note">Estas lecturas aún no están integradas para la cuenta real.</p></section>
      <section className="space-panel operations-orders"><div className="space-panel-heading"><h3>Órdenes y actividad</h3><span className="space-status">Sin conexión de ejecución</span></div><div className="order-lifecycle"><span>Propuesta</span><span>Revisión</span><span>Envío</span><span>Ejecución</span></div><div className="space-empty compact"><p>Este espacio reunirá las órdenes, su estado y el historial de acciones. Esta vista no envía órdenes.</p></div></section>
    </div>
  </div>;
}
