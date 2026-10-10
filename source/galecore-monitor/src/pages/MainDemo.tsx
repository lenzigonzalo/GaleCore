import React, { useState, useEffect } from 'react';
import { ArrowUpRight, ArrowLeft, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import { demoAccount, demoPositions } from './MainDemo.fixture';
import { fmtPnl, fmtPrice } from '../utils/formatters';
import './MainDemo.css';
import { MonitorOverview } from './MonitorOverview';

type View = 'main' | 'strategies' | 'strategy' | 'market' | 'account';
type Conversation = { draft: string; messages: string[] };
const money = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const Pnl = ({ value }: { value: number }) => <span className={value >= 0 ? 'demo-positive' : 'demo-negative'}>{fmtPnl(value)}</span>;
const objectives = ['Cobrar prima con riesgo definido sobre SPY.', 'Operar un rango con riesgo definido sobre QQQ.', 'Cobrar prima por encima del rango de IWM.'];
/** TEMPORAL: recorrido aislado de diseño; retirar fixtures y navegación según GC-0011. */
export function MainDemo({ onExit, initialView = 'main', marketContent, onMarketSelect }: { onExit: () => void; initialView?: View; marketContent?: React.ReactNode; onMarketSelect?: (symbol:string)=>void }) {
  const [view, setView] = useState<View>(initialView);
  useEffect(() => { setView(initialView); }, [initialView]);
  const [strategy, setStrategy] = useState('SPY Income');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<'positions' | 'conversation' | 'activity'>('positions');
  const [conversations, setConversations] = useState<Record<string, Conversation>>({});
  const [finding, setFinding] = useState(false);
  const p = demoPositions.find(item => item.strategy === strategy)!;
  const index = demoPositions.indexOf(p);
  const session = conversations[strategy] || { draft: '', messages: [] };
  const openStrategy = (name: string, investigate = false) => {
    setStrategy(name); setView('strategy');
    setFinding(investigate); setTab(investigate ? 'conversation' : 'positions');
  };
  const patchSession = (next: Conversation) => setConversations(previous => ({ ...previous, [strategy]: next }));
  const positionDetail = (position: typeof p) => <div className="demo-position-detail">
    <div><strong>{position.symbol} · {position.structure}</strong><span>{position.legs}</span></div>
    <div><span>Contratos</span><strong>{position.quantity}</strong></div>
    <div><span>Vencimiento</span><strong className={position.dte <= 2 ? 'demo-warning' : ''}>{position.dte} días</strong></div>
    <div><span>Valor / spread</span><strong>{fmtPrice(position.value)} USD</strong></div>
    <div><span>P&L abierto</span><strong><Pnl value={position.pnl} /></strong></div>
  </div>;
  const strategyList = <section className="demo-strategies">
    <header><button className="demo-heading-link" onClick={() => setView('strategies')}>Estrategias activas <span>3</span><ArrowUpRight size={16} /></button><span className="demo-secondary">3 posiciones abiertas</span></header>
    <div className="demo-table-wrap"><table><thead><tr><th><span className="sr-only">Desplegar</span></th><th>Estrategia / activo</th><th>Estado</th><th>Posiciones</th><th>Contratos</th><th>P&L abierto</th><th>Próximo venc.</th><th><span className="sr-only">Workspace</span></th></tr></thead><tbody>
      {demoPositions.map((position) => <React.Fragment key={position.strategy}>
        <tr><td><button className="demo-icon" aria-label={'Ver posiciones de ' + position.strategy} aria-expanded={expanded === position.strategy} onClick={() => setExpanded(expanded === position.strategy ? null : position.strategy)}>{expanded === position.strategy ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></td>
          <td><button className="demo-strategy-name" onClick={() => openStrategy(position.strategy)}>{position.strategy}</button><small>{position.symbol} · {position.structure}</small></td>
          <td><span className="demo-status">Activa</span></td><td>1</td><td>{position.quantity}</td><td><Pnl value={position.pnl} /></td><td className={position.dte <= 2 ? 'demo-warning' : ''}>{position.dte} días</td>
          <td><button className="demo-icon" aria-label={'Abrir workspace de ' + position.strategy} onClick={() => openStrategy(position.strategy)}><ArrowUpRight size={16} /></button></td></tr>
        {expanded === position.strategy && <tr className="demo-expanded"><td colSpan={8}>{positionDetail(position)}<button className="demo-text-action" onClick={() => openStrategy(position.strategy)}>Abrir workspace <ArrowUpRight size={14} /></button></td></tr>}
      </React.Fragment>)}
    </tbody></table></div>
    <footer className="demo-table-footer"><span>3 estrategias · 5 contratos</span><span>Total abierto <strong><Pnl value={demoAccount.openPnl} /></strong></span></footer>
  </section>;
  const holdingsList = <section className="demo-strategies"><header><h2>Posiciones abiertas</h2><span className="demo-secondary">3 posiciones · 5 contratos</span></header><div className="demo-table-wrap"><table><thead><tr><th>Activo / estructura</th><th>Contratos</th><th>Valor / spread</th><th>P&L abierto</th><th>Vencimiento</th><th><span className="sr-only">Detalle</span></th></tr></thead><tbody>{demoPositions.map(item => <tr key={item.strategy}><td style={{textAlign:"left"}}><button className="demo-strategy-name" onClick={() => openStrategy(item.strategy)}>{item.symbol} · {item.structure}</button><small>{item.legs}</small></td><td>{item.quantity}</td><td>{money(item.value)}</td><td><Pnl value={item.pnl}/></td><td className={item.dte <= 2 ? "demo-warning" : ""}>{item.dte} días</td><td><button className="demo-icon" aria-label={"Abrir posición de " + item.strategy} onClick={() => openStrategy(item.strategy)}><ArrowUpRight size={16}/></button></td></tr>)}</tbody></table></div><footer className="demo-table-footer"><span>Valuación de ejemplo · USD</span><span>Total abierto <strong><Pnl value={demoAccount.openPnl}/></strong></span></footer></section>;
  return <div className={'main-demo' + (view === 'main' || view === 'account' ? ' is-overview' : '')}>
    <div className="demo-location"><div>{view !== initialView && <button className="demo-back" aria-label={initialView === 'account' ? 'Volver a Cartera' : undefined} onClick={() => setView(initialView)}><ArrowLeft size={16} />{initialView === 'account' ? 'Cartera' : initialView === 'market' ? 'Mercado' : 'Resumen'}</button>}<h1>{view === 'main' ? 'Hoy' : view === 'strategy' ? strategy : view === 'strategies' ? 'Estrategias activas' : view === 'market' ? 'Mercado' : 'Cartera'}</h1>{view === 'main' && <span>Cuenta de ejemplo</span>}</div><div className="demo-mode"><span>Datos demo</span><button onClick={onExit}>Ver cuenta real <ArrowUpRight size={13} /></button></div></div>
    {(view === 'main' || view === 'account') ? <MonitorOverview accountView={view === 'account'} analysis={marketContent} positions={view === 'account' ? holdingsList : strategyList} onStrategy={openStrategy} onMarket={name => { onMarketSelect?.(name); setView('market'); }} /> : <>
    {view !== 'market' && <section className="demo-capital" aria-label="Resumen de cuenta">
      {[
        { label: 'Patrimonio', value: money(demoAccount.netLiq) },
        { label: 'P&L abierto', value: <Pnl value={demoAccount.openPnl} /> },
        { label: 'Poder de compra', value: money(demoAccount.buyingPower) },
      ].map(metric => <button key={metric.label} onClick={() => setView('account')}><span>{metric.label}</span><strong>{metric.value}</strong></button>)}
      <button className="demo-account-link" onClick={() => setView('account')}>Cartera <ArrowUpRight size={16} /></button>
    </section>}
    <div className="demo-grid demo-grid-detail"><main className="demo-center">
      {view === 'strategies' && strategyList}
      {view === 'strategy' && <section className="demo-workspace">
        <div className="demo-workspace-summary"><span className="demo-status">Activa</span><span>{p.symbol} · v1</span><span>Vence en {p.dte} días</span><span>Abierto <Pnl value={p.pnl} /></span></div>
        <p className="demo-objective">{objectives[index]}</p>
        <nav className="demo-tabs" aria-label="Workspace de estrategia">{(['positions', 'conversation', 'activity'] as const).map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'positions' ? 'Posiciones · 1' : t === 'conversation' ? 'Conversación' : 'Actividad'}</button>)}</nav>
        {tab === 'positions' && <><h2>Posición abierta</h2>{positionDetail(p)}<div className="demo-position-plan"><h3>Plan de seguimiento</h3><p>{p.note}</p><button className="demo-text-action" onClick={() => setTab('conversation')}><MessageSquare size={16} />Investigar con contexto</button></div></>}
        {tab === 'activity' && <div className="demo-activity"><p><strong>14:32 ET · Revisión del supervisor</strong><span>{p.note}</span></p><p><strong>14:35 ET · Lectura de cartera</strong><span>{p.quantity} contratos · valor {fmtPrice(p.value)} USD / spread · P&L {fmtPnl(p.pnl)}</span></p></div>}
        {tab === 'conversation' && <div className="demo-conversation"><div className="demo-chat-context"><strong>Contexto de la sesión</strong><span>{strategy} · v1 · {p.symbol} · {p.legs} · {p.quantity} contratos · vence en {p.dte} días</span></div>
          {finding && <div className="demo-evidence"><strong>Hallazgo seleccionado · supervisor, {p.symbol === 'QQQ' ? '14:20 ET' : '14:32 ET'}</strong><p>{p.symbol === 'QQQ' ? 'QQQ concentra el 31% del capital asignado. Revisar la distribución antes de aumentar esta estrategia.' : 'El spread 600 / 595 vence en 2 días y tiene una ganancia abierta de $340. Revisar el plan de salida.'}</p><span>{p.symbol === 'QQQ' ? 'Evidencia: distribución del capital asignado, lectura 14:20 ET.' : 'Evidencia: posición abierta, vencimiento y valuación, lectura 14:32 ET.'}</span></div>}
          <h2>Investigar {strategy}</h2><p className="demo-secondary">La sesión conserva el contexto de esta estrategia y tu borrador al volver a Main.</p>
          <div className="demo-suggestions">{['¿Cómo viene la estrategia?', '¿Qué puede afectar esta posición?', 'Revisar el plan de salida'].map(prompt => <button key={prompt} onClick={() => patchSession({ ...session, draft: prompt })}>{prompt}</button>)}</div>
          <div className="demo-messages" aria-live="polite">{session.messages.map((message, i) => <div key={i}><strong>Vos</strong><p>{message}</p><span className="demo-secondary">Respuesta de ejemplo: contrastar el riesgo restante con el objetivo de salida y el próximo evento. Revisar alternativas antes de decidir.</span></div>)}</div>
          <form onSubmit={event => { event.preventDefault(); if (session.draft.trim()) patchSession({ draft: '', messages: [...session.messages, session.draft.trim()] }); }}><label htmlFor="strategy-question">Consulta sobre {strategy}</label><textarea id="strategy-question" placeholder="Preguntá sobre resultados, riesgo o el plan…" value={session.draft} onChange={event => patchSession({ ...session, draft: event.target.value })} /><div><span className="demo-secondary">Sesión de trabajo · {strategy}</span><button type="submit" disabled={!session.draft.trim()}>Guardar consulta</button></div></form>
        </div>}
      </section>}
      {view === 'market' && <section className="demo-real-market">{marketContent || <p className="demo-secondary">Mercado requiere conexión con GaleCore.</p>}</section>}
    </main>

    </div>
    </>}
  </div>;
}
