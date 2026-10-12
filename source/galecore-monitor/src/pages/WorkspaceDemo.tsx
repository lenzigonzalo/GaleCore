import React, { useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, Pause, Play } from 'lucide-react';
import type { Tab } from '../components/layout/TabNav';
import type { WorkspaceMode } from '../components/layout/WorkspaceNav';
import { MacroPreview } from './MacroPreview';
import { MainDemo } from './MainDemo';
import { SettingsDemo } from './SettingsDemo';
import { demoAccount, demoPositions, demoEquity } from './MainDemo.fixture';
import { visualOrders, visualAgents, visualDocuments } from './WorkspaceDemo.fixture';
import './WorkspaceDemo.css';

const money = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pnl = (n: number) => <span className={n >= 0 ? 'demo-positive' : 'demo-negative'}>{n >= 0 ? '+' : '−'}{money(n)}</span>;
function Curve({ values = demoEquity }: { values?: number[] }) {
  const min = Math.min(...values) - 200, max = Math.max(...values) + 200;
  const points = values.map((v,i) => (8 + i * 684 / Math.max(1, values.length-1)) + ',' + (120 - (v-min)/(max-min)*100)).join(' ');
  return <svg className="wd-curve" viewBox="0 0 700 140" preserveAspectRatio="none" role="img" aria-label="Evolución ficticia del escenario demo">
    {[20,70,120].map(y=><line key={y} x1="8" x2="692" y1={y} y2={y} stroke="var(--border-dark)"/>)}
    <polygon points={'8,140 ' + points + ' 692,140'} fill="var(--accent)" opacity=".05"/>
    <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
  </svg>;
}
/** TEMPORAL GC-0011. Cuenta/operativa/config son de ejemplo; marketContent aporta mercado real. */
export function WorkspaceDemo({ active, mode, onNavigate, onExit, marketContent, onMarketSelect }: { marketContent?: React.ReactNode; onMarketSelect?: (symbol:string)=>void; active: Tab; mode: WorkspaceMode; onNavigate: (tab: Tab) => void; onExit: () => void }) {
  const [selected, setSelected] = useState(0);
  const [paused, setPaused] = useState<string[]>([]);
  const [orders, setOrders] = useState(visualOrders);
  const [agents, setAgents] = useState(visualAgents);
  const [document, setDocument] = useState(0);
  const [toast, setToast] = useState('');
  const [shadowPeriod, setShadowPeriod] = useState(60);
  const p = demoPositions[selected];
  const toggleStrategy = (name: string) => setPaused(v => v.includes(name) ? v.filter(s=>s!==name) : [...v,name]);
  const openLab = (_i: number) => { onNavigate('lab'); };
  const mockAction = (text: string) => setToast(text + ' · solo en esta demo');
  const isMain = active === 'inicio' || active === 'monitor' || active === 'gex';

  return <div className="workspace-demo">
    {toast && <div className="wd-toast" role="status"><Check size={16}/>{toast}<button onClick={()=>setToast('')}>Cerrar</button></div>}
    <div hidden={!isMain}><MainDemo onExit={onExit} marketContent={isMain ? marketContent : undefined} onMarketSelect={onMarketSelect} initialView={active === 'monitor' ? 'account' : active === 'gex' ? 'market' : 'main'} />

    </div>

    {active === 'macro' && <MacroPreview />}

    {(active === 'operativa' || active === 'rpf' || (active === 'estrategias' && mode !== 'lab')) && <div className="wd-content">
      <div className="wd-metrics"><div><span>Estrategias activas</span><strong>{3-paused.length}<small> / 3</small></strong></div><div><span>P&L abierto</span><strong>{pnl(demoAccount.openPnl)}</strong></div><div><span>Atención requerida</span><strong>2 <small>posiciones</small></strong></div><div><span>Próximo vencimiento</span><strong>2 <small>días · SPY</small></strong></div><div><span>Órdenes por revisar</span><strong>{orders.filter(o=>o.state==='Pendiente de revisión').length}</strong></div></div>
      <div className="wd-operation-grid"><section className="wd-panel wd-position-panel"><header><h2>Estrategias y posiciones</h2><span>Actualizado · 14:35 ET</span></header><div className="wd-table-scroll"><table className="wd-table"><thead><tr><th>Estrategia / posición</th><th>Estado</th><th>P&L abierto</th><th>DTE</th><th>Gestión</th></tr></thead><tbody>{demoPositions.map((item,i)=><tr key={item.strategy} className={selected===i?'selected':''} onClick={()=>setSelected(i)}><td><button className="wd-name" onClick={()=>setSelected(i)}>{item.strategy}</button><small>{item.legs} · ×{item.quantity}</small></td><td><button className={'wd-chip '+(paused.includes(item.strategy)?'amber':'green')} onClick={e=>{e.stopPropagation();toggleStrategy(item.strategy);}}>{paused.includes(item.strategy)?<Play size={12}/>:<Pause size={12}/>} {paused.includes(item.strategy)?'Entradas pausadas':'Activa'}</button></td><td>{pnl(item.pnl)}</td><td>{item.dte}d</td><td><span className={i===0?'wd-amber':'wd-muted'}>{['Revisar salida','Vigilar exposición','Según plan'][i]}</span></td></tr>)}</tbody></table></div>
        <div className="wd-position-focus"><div><span className="wd-kicker">POSICIÓN SELECCIONADA</span><h3>{p.strategy}</h3><p>{p.structure} · {p.legs}</p></div><button className="main-link" onClick={()=>openLab(selected)}>Analizar en Lab <ArrowUpRight size={15}/></button></div>
        <div className="wd-position-numbers"><span>Contratos<strong>{p.quantity}</strong></span><span>Valor / spread<strong>{money(p.value)}</strong></span><span>Objetivo de salida<strong>55% del crédito</strong></span><span>Pérdida límite<strong>2× crédito recibido</strong></span></div>
        <div className="wd-management"><div><span>Ganancia sobre crédito recibido</span><strong>{[50, -46.8,48][selected]}%</strong></div><div className="wd-progress"><i style={{width:[50,0,48][selected]+'%'}}/><b style={{left:'55%'}}/></div><div className="wd-progress-label"><span>Entrada</span><span>Objetivo 55%</span><span>100%</span></div></div>
      </section>
      <aside className="wd-panel"><header><h2>Próximas decisiones</h2><span className="wd-chip amber">2</span></header><button className="wd-attention" onClick={()=>setSelected(0)}><span className="wd-kicker wd-amber">SPY INCOME · 2 DTE</span><h3>Cerca del objetivo de salida</h3><p>Ganancia abierta de $340. Revisar el cierre antes del dato de inflación.</p><span>Objetivo 55% · actual 50% <ChevronRight size={14}/></span></button><button className="wd-attention" onClick={()=>setSelected(1)}><span className="wd-kicker">QQQ NEUTRAL · RIESGO</span><h3>31% del capital asignado</h3><p>Revisar concentración antes de aumentar el tamaño.</p><span>Supervisor de riesgo <ChevronRight size={14}/></span></button><div className="wd-event"><strong>Mañana · 08:30 ET</strong><span>Inflación de Estados Unidos</span><small>En seguimiento: SPY · QQQ · IWM</small></div></aside>
      <section className="wd-panel wd-full"><header><h2>Órdenes y actividad</h2><span>Cuenta demo · USD</span></header><div className="wd-table-scroll"><table className="wd-table"><thead><tr><th>Hora</th><th>Estrategia</th><th>Orden</th><th>Tipo</th><th>Precio</th><th>Estado</th><th/></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td>{o.time}</td><td>{o.strategy}</td><td>{o.action}<small>{o.id}</small></td><td>{o.type}</td><td>{o.price}</td><td><span className={'wd-chip '+(o.state==='Ejecutada'?'green':'amber')}>{o.state}</span></td><td>{o.state==='Pendiente de revisión' && <button className="btn" onClick={()=>{setOrders(v=>v.map(x=>x.id===o.id?{...x,state:'Revisada · demo'}:x));mockAction('Revisión registrada');}}>Revisar</button>}</td></tr>)}</tbody></table></div></section></div>
    </div>}

    {active === 'shadow' && <div className="wd-content"><div className="wd-section-title"><div><h2>Experimentos en seguimiento</h2><p>3 versiones · datos de ejemplo · ejecución simulada</p></div><div className="demo-periods">{[20,60].map(n=><button key={n} aria-pressed={shadowPeriod===n} onClick={()=>setShadowPeriod(n)}>{n} sesiones</button>)}</div></div><div className="wd-metrics"><div><span>Capital de referencia</span><strong>$10.000</strong></div><div><span>Resultado SHADOW</span><strong>{pnl(486.5)}</strong></div><div><span>Retorno simulado</span><strong className="demo-positive">+4,87%</strong></div><div><span>Drawdown máximo</span><strong>−2,4%</strong></div><div><span>Operaciones cerradas</span><strong>28</strong></div></div><section className="wd-panel"><header><h2>Evolución del experimento</h2><span>{shadowPeriod} sesiones · curva de ejemplo</span></header><Curve values={demoEquity.map(v=>10000+(v-demoEquity[0])/(demoEquity[demoEquity.length-1]-demoEquity[0])*486.5).slice(-shadowPeriod)}/></section><div className="wd-three-grid">{demoPositions.map((item,i)=><section className="wd-panel" key={item.strategy}><header><h2>{item.strategy}</h2><span className="wd-chip green">SHADOW</span></header><p>v2.{i} · {item.structure}</p><div className="wd-experiment"><strong>{pnl([320,-85,251.5][i])}</strong><span>{[12,8,8][i]} cierres · {['66,7','50','62,5'][i]}% acierto</span></div><p className="wd-muted">Muestra de exploración. Todavía no demuestra una ventaja persistente.</p><button className="main-link" onClick={()=>openLab(i)}>Abrir proyecto <ArrowUpRight size={14}/></button></section>)}</div></div>}

    {active === 'agentes' && <div className="wd-content"><div className="wd-section-title"><div><h2>Agentes y tareas</h2><p>{agents.filter(a=>a.enabled).length} activos · próxima ejecución 14:40 ET</p></div><button className="btn" onClick={()=>{onNavigate('lab');}}>Diseñar agente en Lab</button></div><div className="wd-two-grid">{agents.map((a,i)=><section className="wd-panel" key={a.name}><header><h2>{a.name}</h2><button className={'wd-chip '+(a.enabled?'green':'amber')} onClick={()=>setAgents(v=>v.map((x,j)=>j===i?{...x,enabled:!x.enabled}:x))}>{a.enabled?<Pause size={12}/>:<Play size={12}/>} {a.enabled?'Activo':'Pausado'}</button></header><p>{a.role}</p><div className="wd-agent-meta"><span>{a.schedule}</span><span>Última: {a.last}</span></div><div className="wd-agent-result"><Check size={15}/>{a.result}</div><button className="main-link" onClick={()=>{setDocument(i%visualDocuments.length);onNavigate('inteligencia');}}>Ver resultado <ArrowUpRight size={14}/></button></section>)}</div><section className="wd-panel wd-top"><header><h2>Próximas tareas</h2><span>ET</span></header>{[['14:40','Revisar posiciones y reglas','Supervisor de posiciones'],['15:00','Contrastar candidatos','Explorador de oportunidades · pausado'],['17:00','Guardar decisiones del día','Curador de conocimiento']].map(row=><div className="wd-task" key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><small>{row[2]}</small></div>)}</section></div>}

    {active === 'inteligencia' && <div className="wd-library"><aside><span className="wd-kicker">BIBLIOTECA COMPARTIDA</span>{visualDocuments.map((d,i)=><button className={document===i?'selected':''} key={d.title} onClick={()=>setDocument(i)}><span>{d.kind} · {d.date}</span><strong>{d.title}</strong><small>{d.project}</small></button>)}</aside><article className="wd-document"><span className="wd-kicker">{visualDocuments[document].kind} · {visualDocuments[document].date}</span><h2>{visualDocuments[document].title}</h2><div className="wd-source-tags"><span>{visualDocuments[document].project}</span><span>Versión 1</span><span>Escenario demo</span></div><h3>Conclusión</h3><p>{visualDocuments[document].text}</p><h3>Evidencia del caso</h3><p>Lectura de posiciones, contexto del mercado y reglas vigentes del proyecto. El resultado se conserva junto con sus supuestos para revisarlo después.</p><Curve/><h3>Próxima revisión</h3><p>Después del dato de inflación, contrastar reacción observada y exposición de las estrategias.</p><button className="btn" onClick={()=>{onNavigate('lab');}}>Continuar en Lab</button></article></div>}

    {(active === 'config' || active === 'admin') && <SettingsDemo onLab={() => onNavigate('lab')} />}
  </div>;
}
