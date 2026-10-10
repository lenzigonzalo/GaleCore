import React, { useState, useEffect } from 'react';
import { ArrowUpRight, ArrowLeft, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import { demoAccount, demoWatchlist, demoPositions, demoEquity } from './MainDemo.fixture';
import { fmtPnl, fmtPrice } from '../utils/formatters';
import './MainDemo.css';

type View = 'main' | 'strategies' | 'strategy' | 'market' | 'account';
type Conversation = { draft: string; messages: string[] };
const money = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const Pnl = ({ value }: { value: number }) => <span className={value >= 0 ? 'demo-positive' : 'demo-negative'}>{fmtPnl(value)}</span>;
const daily = [430, -92, 504.8];
const objectives = ['Cobrar prima con riesgo definido sobre SPY.', 'Operar un rango con riesgo definido sobre QQQ.', 'Cobrar prima por encima del rango de IWM.'];
/** TEMPORAL: recorrido aislado de diseño; retirar fixtures y navegación según GC-0011. */
export function MainDemo({ onExit, initialView = 'main' }: { onExit: () => void; initialView?: View }) {
  const [view, setView] = useState<View>(initialView);
  useEffect(() => { setView(initialView); }, [initialView]);
  const [symbol, setSymbol] = useState('SPY');
  const [strategy, setStrategy] = useState('SPY Income');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<'positions' | 'conversation' | 'activity'>('positions');
  const [conversations, setConversations] = useState<Record<string, Conversation>>({});
  const [period, setPeriod] = useState<5 | 20 | 60>(20);
  const [finding, setFinding] = useState(false);
  const p = demoPositions.find(item => item.strategy === strategy)!;
  const index = demoPositions.indexOf(p);
  const active = demoWatchlist.find(item => item.symbol === symbol)!;
  const session = conversations[strategy] || { draft: '', messages: [] };
  const openStrategy = (name: string, investigate = false) => {
    const position = demoPositions.find(item => item.strategy === name)!;
    setStrategy(name); setSymbol(position.symbol); setView('strategy');
    setFinding(investigate); setTab(investigate ? 'conversation' : 'positions');
  };
  const patchSession = (next: Conversation) => setConversations(previous => ({ ...previous, [strategy]: next }));
  const values = demoEquity.slice(-period);
  const low = Math.min(...values) - 250, high = Math.max(...values) + 250;
  const line = values.map((v, i) => (8 + i * 724 / (values.length - 1)) + ',' + (90 - (v - low) * 72 / (high - low))).join(' ');
  const priceShape = [0.992,0.993,0.991,0.994,0.996,0.995,0.997,0.994,0.996,0.998,0.997,0.999,0.998,1];
  const priceLine = priceShape.map((v,i) => (8+i*724/13)+','+(105-(v-.990)*9000)).join(' ');
  const positionDetail = (position: typeof p) => <div className="demo-position-detail">
    <div><strong>{position.symbol} · {position.structure}</strong><span>{position.legs}</span></div>
    <div><span>Contratos</span><strong>{position.quantity}</strong></div>
    <div><span>Vencimiento</span><strong className={position.dte <= 2 ? 'demo-warning' : ''}>{position.dte} días</strong></div>
    <div><span>Valor / spread</span><strong>{fmtPrice(position.value)} USD</strong></div>
    <div><span>P&L abierto</span><strong><Pnl value={position.pnl} /></strong></div>
  </div>;
  const strategyList = <section className="demo-strategies">
    <header><button className="demo-heading-link" onClick={() => setView('strategies')}>Estrategias activas <span>3</span><ArrowUpRight size={16} /></button><span className="demo-secondary">3 posiciones abiertas</span></header>
    <div className="demo-table-wrap"><table><thead><tr><th><span className="sr-only">Desplegar</span></th><th>Estrategia / activo</th><th>Estado</th><th>Posiciones</th><th>P&L hoy</th><th>P&L abierto</th><th>Próximo venc.</th><th><span className="sr-only">Workspace</span></th></tr></thead><tbody>
      {demoPositions.map((position, i) => <React.Fragment key={position.strategy}>
        <tr><td><button className="demo-icon" aria-label={'Ver posiciones de ' + position.strategy} aria-expanded={expanded === position.strategy} onClick={() => setExpanded(expanded === position.strategy ? null : position.strategy)}>{expanded === position.strategy ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></td>
          <td><button className="demo-strategy-name" onClick={() => openStrategy(position.strategy)}>{position.strategy}</button><small>{position.symbol} · {position.structure}</small></td>
          <td><span className="demo-status">Activa</span></td><td>1</td><td><Pnl value={daily[i]} /></td><td><Pnl value={position.pnl} /></td><td className={position.dte <= 2 ? 'demo-warning' : ''}>{position.dte} días</td>
          <td><button className="demo-icon" aria-label={'Abrir workspace de ' + position.strategy} onClick={() => openStrategy(position.strategy)}><ArrowUpRight size={16} /></button></td></tr>
        {expanded === position.strategy && <tr className="demo-expanded"><td colSpan={8}>{positionDetail(position)}<button className="demo-text-action" onClick={() => openStrategy(position.strategy)}>Abrir workspace <ArrowUpRight size={14} /></button></td></tr>}
      </React.Fragment>)}
    </tbody></table></div>
    <footer className="demo-table-footer"><span>3 estrategias · 5 contratos</span><span>Total abierto <strong><Pnl value={demoAccount.openPnl} /></strong></span></footer>
  </section>;
  return <div className="main-demo">
    <div className="demo-location"><div>{view !== 'main' && <button className="demo-back" onClick={() => setView('main')}><ArrowLeft size={16} />Resumen</button>}<h1>{view === 'main' ? 'Hoy' : view === 'strategy' ? strategy : view === 'strategies' ? 'Estrategias activas' : view === 'market' ? symbol + ' · Mercado' : 'Cartera'}</h1>{view === 'main' && <span>Cuenta · 14:35 ET</span>}</div><div className="demo-mode"><span>Datos demo</span><button onClick={onExit}>Ver cuenta real <ArrowUpRight size={13} /></button></div></div>
    <section className="demo-capital" aria-label="Resumen de cuenta">
      {[
        { label: 'Patrimonio', value: money(demoAccount.netLiq) },
        { label: 'P&L hoy', value: <Pnl value={demoAccount.dailyPnl} />, extra: '+0.66%' },
        { label: 'P&L abierto', value: <Pnl value={demoAccount.openPnl} /> },
        { label: 'Poder de compra', value: money(demoAccount.buyingPower) },
      ].map(metric => <button key={metric.label} onClick={() => setView('account')}><span>{metric.label}</span><strong>{metric.value}</strong>{metric.extra && <small className="demo-positive">{metric.extra}</small>}</button>)}
      <button className="demo-account-link" onClick={() => setView('account')}>Cartera <ArrowUpRight size={16} /></button>
    </section>
    <div className="demo-grid"><main className="demo-center">
      {(view === 'main' || view === 'strategies') && strategyList}
      {view === 'main' && <>
        <div className="demo-context-grid">
          <section className="demo-findings"><header><h2>Hallazgos del agente</h2><span className="demo-secondary">Revisión 14:32 ET</span></header>
            <button className="demo-finding" onClick={() => openStrategy('SPY Income', true)}><span className="demo-event-mark demo-warning">2d</span><div><strong>SPY Income · revisar salida</strong><p>Spread 600 / 595 vence en 2 días. Ganancia abierta de $340.</p><span>Supervisor de cartera · evidencia y plan</span></div><ChevronRight size={16} /></button>
            <button className="demo-finding" onClick={() => openStrategy('QQQ Neutral', true)}><span className="demo-event-mark">31%</span><div><strong>QQQ Neutral · exposición concentrada</strong><p>QQQ reúne el 31% de la exposición. P&L abierto −$185.</p><span>Supervisor de riesgo · revisar distribución</span></div><ChevronRight size={16} /></button>
          </section>
          <section className="demo-agenda"><header><h2>Agenda</h2><span className="demo-secondary">ET</span></header>
            <button className="demo-finding" onClick={() => { setSymbol('SPY'); setView('market'); }}><span className="demo-event-mark">Mañana<br />08:30</span><div><strong>Inflación · Estados Unidos</strong><p>En seguimiento: SPY, QQQ, IWM</p><span>Calendario económico</span></div><ArrowUpRight size={16} /></button>
            <button className="demo-finding" onClick={() => openStrategy('SPY Income')}><span className="demo-event-mark">En 2d<br />16:00</span><div><strong>Vencimiento de SPY Income</strong><p>2 contratos · put spread 600 / 595</p><span>Calendario de posiciones</span></div><ArrowUpRight size={16} /></button>
          </section>
        </div>
        <section className="demo-performance"><header><div className="demo-evolution-heading"><button className="demo-heading-link" onClick={() => setView('account')}>Evolución <ArrowUpRight size={14} /></button><strong><Pnl value={values[values.length - 1] - values[0]} /></strong><span>{period} sesiones</span></div><div className="demo-periods">{([5,20,60] as const).map(n => <button key={n} aria-pressed={period === n} onClick={() => setPeriod(n)}>{n === 5 ? '1S' : n === 20 ? '1M' : '3M'}</button>)}</div></header>
          <svg className="demo-equity" viewBox="0 0 740 100" preserveAspectRatio="none" role="img" aria-label="Curva de equity ficticia, no representa resultados reales">{[20,55,90].map(y => <line key={y} x1="8" x2="732" y1={y} y2={y} stroke="var(--border-dark)" />)}<polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>
          <footer className="demo-table-footer"><span>{money(values[0])} → {money(values[values.length - 1])}</span><span>Acierto 64% · 16 / 25 cierres en el último mes</span></footer>
        </section>
      </>}
      {view === 'strategy' && <section className="demo-workspace">
        <div className="demo-workspace-summary"><span className="demo-status">Activa</span><span>{p.symbol} · v1</span><span>P&L hoy <Pnl value={daily[index]} /></span><span>Abierto <Pnl value={p.pnl} /></span></div>
        <p className="demo-objective">{objectives[index]}</p>
        <nav className="demo-tabs" aria-label="Workspace de estrategia">{(['positions', 'conversation', 'activity'] as const).map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'positions' ? 'Posiciones · 1' : t === 'conversation' ? 'Conversación' : 'Actividad'}</button>)}</nav>
        {tab === 'positions' && <><h2>Posición abierta</h2>{positionDetail(p)}<div className="demo-position-plan"><h3>Plan de seguimiento</h3><p>{p.note}</p><button className="demo-text-action" onClick={() => setTab('conversation')}><MessageSquare size={16} />Investigar con contexto</button></div></>}
        {tab === 'activity' && <div className="demo-activity"><p><strong>14:32 ET · Revisión del supervisor</strong><span>{p.note}</span></p><p><strong>14:35 ET · Lectura de cartera</strong><span>{p.quantity} contratos · valor {fmtPrice(p.value)} USD / spread · P&L {fmtPnl(p.pnl)}</span></p></div>}
        {tab === 'conversation' && <div className="demo-conversation"><div className="demo-chat-context"><strong>Contexto de la sesión</strong><span>{strategy} · v1 · {p.symbol} · {p.legs} · {p.quantity} contratos · vence en {p.dte} días</span></div>
          {finding && <div className="demo-evidence"><strong>Hallazgo seleccionado · supervisor, {p.symbol === 'QQQ' ? '14:20 ET' : '14:32 ET'}</strong><p>{p.symbol === 'QQQ' ? 'QQQ concentra el 31% de la exposición. Revisar la distribución antes de aumentar esta estrategia.' : 'El spread 600 / 595 vence en 2 días y tiene una ganancia abierta de $340. Revisar el plan de salida.'}</p><span>{p.symbol === 'QQQ' ? 'Evidencia: distribución de exposición de cartera, lectura 14:20 ET.' : 'Evidencia: posición abierta, vencimiento y valuación, lectura 14:32 ET.'}</span></div>}
          <h2>Investigar {strategy}</h2><p className="demo-secondary">La sesión conserva el contexto de esta estrategia y tu borrador al volver a Main.</p>
          <div className="demo-suggestions">{['¿Cómo viene la estrategia?', '¿Qué puede afectar esta posición?', 'Revisar el plan de salida'].map(prompt => <button key={prompt} onClick={() => patchSession({ ...session, draft: prompt })}>{prompt}</button>)}</div>
          <div className="demo-messages" aria-live="polite">{session.messages.map((message, i) => <div key={i}><strong>Vos</strong><p>{message}</p><span className="demo-secondary">Respuesta de ejemplo: contrastar el riesgo restante con el objetivo de salida y el próximo evento. Revisar alternativas antes de decidir.</span></div>)}</div>
          <form onSubmit={event => { event.preventDefault(); if (session.draft.trim()) patchSession({ draft: '', messages: [...session.messages, session.draft.trim()] }); }}><label htmlFor="strategy-question">Consulta sobre {strategy}</label><textarea id="strategy-question" placeholder="Preguntá sobre resultados, riesgo o el plan…" value={session.draft} onChange={event => patchSession({ ...session, draft: event.target.value })} /><div><span className="demo-secondary">Sesión de trabajo · {strategy}</span><button type="submit" disabled={!session.draft.trim()}>Guardar consulta</button></div></form>
        </div>}
      </section>}
      {view === 'market' && <section className="demo-market-view"><header><h2>{symbol} · contexto de mercado</h2><span className="demo-secondary">14:35 ET</span></header><div className="demo-market-price"><strong>{fmtPrice(active.price)}</strong><span className={active.change >= 0 ? 'demo-positive' : 'demo-negative'}>{active.change > 0 ? '+' : ''}{active.change.toFixed(2)}%</span></div><div className="demo-market-facts"><div><span>Régimen</span><strong>{active.context}</strong></div><div><span>En cartera</span><strong>{demoPositions.some(item => item.symbol === symbol) ? '1 posición abierta' : 'Sin posiciones'}</strong></div></div>
        <div className="demo-performance"><header><h2>Precio intradiario</h2><span className="demo-secondary">Sesión de ejemplo · 09:30–14:35 ET</span></header><svg className="demo-equity" style={{ height: 210 }} viewBox="0 0 740 120" preserveAspectRatio="none" role="img" aria-label="Precio intradiario ficticio"><line x1="8" x2="732" y1="60" y2="60" stroke="var(--border-dark)" /><polyline points={priceLine} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg><footer className="demo-table-footer"><span>Bid {fmtPrice(active.price-0.01)} · Ask {fmtPrice(active.price+0.01)}</span><span>Volumen 28,4M · IV 22,6% · IV rank 38</span></footer></div><h2 style={{ marginTop: 26 }}>Estrategias vinculadas</h2>{demoPositions.filter(item => item.symbol === symbol).map(item => <button className="demo-finding" key={item.strategy} onClick={() => openStrategy(item.strategy)}><div><strong>{item.strategy}</strong><p>{item.legs} · vence en {item.dte} días</p></div><Pnl value={item.pnl} /><ArrowUpRight size={16} /></button>)}{!demoPositions.some(item => item.symbol === symbol) && <p className="demo-secondary">Este activo está en seguimiento y no tiene estrategias activas.</p>}
        <div className="demo-position-plan"><h3>Próximo evento</h3><p>{['SPY', 'QQQ', 'IWM', 'TLT'].includes(symbol) ? 'Inflación · mañana 08:30 ET. Fuente: calendario económico.' : 'Resultados próximos. Fecha por confirmar.'}</p></div>
      </section>}
      {view === 'account' && <section className="demo-account-view"><header><h2>Resumen y riesgo</h2><span className="demo-secondary">USD · lectura 14:35 ET</span></header><div className="demo-market-facts"><div><span>Efectivo</span><strong>{money(demoAccount.cash)}</strong></div><div><span>Realizado hoy</span><strong><Pnl value={demoAccount.realizedToday} /></strong></div><div><span>P&L abierto</span><strong><Pnl value={demoAccount.openPnl} /></strong></div></div><h2>Posiciones por estrategia</h2>{demoPositions.map(item => <button className="demo-finding" key={item.strategy} onClick={() => openStrategy(item.strategy)}><div><strong>{item.strategy}</strong><p>{item.symbol} · {item.legs} · {item.quantity} contratos</p></div><Pnl value={item.pnl} /><ArrowUpRight size={16} /></button>)}</section>}
    </main>
    <aside className="demo-watchlist" aria-label="Watchlist"><header><h2>Watchlist</h2><button className="demo-icon" aria-label={'Abrir Mercado de ' + symbol} onClick={() => setView('market')}><ArrowUpRight size={16} /></button></header><table><thead><tr><th>Activo</th><th>Último</th><th>Cambio</th></tr></thead><tbody>{demoWatchlist.map(t => <tr key={t.symbol} className={symbol === t.symbol ? 'selected' : ''}><td><button aria-label={'Analizar ' + t.symbol} onClick={() => { setSymbol(t.symbol); setView('market'); }}>{t.symbol}</button></td><td>{fmtPrice(t.price)}</td><td className={t.change >= 0 ? 'demo-positive' : 'demo-negative'}>{t.change > 0 ? '+' : ''}{t.change.toFixed(2)}%</td></tr>)}</tbody></table><div className="demo-watchlist-note"><span>Contexto activo</span><strong>{symbol}</strong><p>{active.context}</p></div></aside>
    </div>
  </div>;
}
