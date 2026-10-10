import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Check, FlaskConical, RefreshCw } from 'lucide-react';
import { labRequest, WorkspaceProject } from '../api/lab';
import { fetchShadowMetrics, fetchShadowStatus } from '../api/shadow';
import { ShadowInstance, SpecVersionMetrics } from '../types/shadow';
interface StrategyView { missing?: boolean; current?: { ref:string; approved:boolean; purpose:string; spec_hash:string }; versions?: {ref:string;approved:boolean}[]; integrity_failed?: unknown[] }
const hash=(h:string|undefined)=>h?.replace(/^sha256:/,'') || '';
const pnlClass=(n:number|null)=>n===null?'':n<0?'loss':n>0?'gain':'';
const usd=(n:number|null)=>n===null?'—':(n<0?'−':'')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export function LabShadow({project,onChat,onMonitor}:{project?:WorkspaceProject;onChat:()=>void;onMonitor:()=>void}) {
  const [strategy,setStrategy]=useState<StrategyView|null>(null);
  const [metrics,setMetrics]=useState<SpecVersionMetrics[]>([]);
  const [instances,setInstances]=useState<ShadowInstance[]>([]);
  const [error,setError]=useState('');const [loading,setLoading]=useState(false);const [retry,setRetry]=useState(0);
  useEffect(()=>{
    if(project?.type!=='strategy')return;let active=true;setLoading(true);setStrategy(null);setMetrics([]);setInstances([]);setError('');
    Promise.all([labRequest<StrategyView>('/workspaces/'+project.id+'/strategy', undefined, 65000),fetchShadowMetrics(),fetchShadowStatus()]).then(([s,m,status])=>{if(!active)return;if(s.integrity_failed?.length)throw new Error('El harness detectó un problema de integridad en este proyecto.');if(!status.persistence.available)throw new Error('El runtime no tiene persistencia disponible.');setStrategy(s);setMetrics(m.filter(v=>v.specName===project.strategyName));setInstances(status.instances.filter(i=>i.specName===project.strategyName));}).catch(e=>{if(active)setError(e instanceof Error?e.message:'No se pudo leer Shadow.');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[project?.id,project?.type,project?.strategyName,retry]);
  if(project?.type!=='strategy')return <div className="lab-shadow-empty"><FlaskConical size={30}/><h2>Shadow para tus estrategias</h2><p>Elegí un proyecto de estrategia para ver su preparación y sus ejecuciones.</p><button className="main-link" onClick={onChat}>Volver al chat</button></div>;
  const approved=!!strategy?.current?.approved;
  return <div className="lab-shadow-view"><header><div><span className="lab-eyebrow">SHADOW · SIMULACIÓN</span><h1>{project.label}</h1>{strategy?.current?.purpose&&<p>{strategy.current.purpose}</p>}</div><button className="lab-icon" aria-label="Actualizar Shadow" onClick={()=>setRetry(v=>v+1)}><RefreshCw size={18}/></button></header>
    {loading?<p role="status">Leyendo estrategia y runtime…</p>:error?<div className="lab-chat-error" role="alert">{error}</div>:<>
      <ol className="lab-strategy-path">{[{label:'Workspace',done:true},{label:'Propuesta',done:!!strategy?.current},{label:'Aprobación',done:approved},{label:'En Shadow',done:!!hash(strategy?.current?.spec_hash)&&instances.some(i=>i.lifecycleState==='RUNNING'&&hash(i.versionHash)===hash(strategy?.current?.spec_hash))}].map((s,i)=><li key={s.label} className={s.done?'done':''}><span>{s.done?<Check size={15}/>:i+1}</span>{s.label}</li>)}</ol>
      {!strategy?.current && <section className="lab-shadow-draft"><h2>De la idea a la estrategia</h2><p>El workspace está creado. En el chat vamos a trabajar la tesis, los datos, las reglas y el plan de evaluación; después, validar y criticar la propuesta antes de aprobar una versión.</p><button className="btn" onClick={onChat}>Continuar en el chat <ArrowUpRight size={16}/></button></section>}
      {strategy?.current && <div className="lab-shadow-version"><strong>{strategy.current.ref}</strong><span>{approved?'Versión aprobada':'Propuesta sin aprobar'}</span><button className="main-link" onClick={onChat}>Revisar en el chat</button></div>}
      {metrics.length>0?<div className="lab-shadow-metrics">{metrics.map(v=><section key={v.contentHash}><header><h2>{v.specVersion}</h2><span>{v.instances} instancia{v.instances!==1?'s':''} · métricas por versión</span></header><dl><div><dt>P&L realizado</dt><dd className={pnlClass(v.realizedPnl)}>{usd(v.realizedPnl)}</dd></div><div><dt>P&L abierto</dt><dd className={pnlClass(v.unrealizedPnl)}>{usd(v.unrealizedPnl)}</dd></div><div><dt>Posiciones abiertas</dt><dd>{v.positionsOpen}</dd></div><div><dt>Operaciones cerradas</dt><dd>{v.positionsClosed}</dd></div></dl>{v.openPositionsNotValued>0&&<p>{v.openPositionsNotValued} posiciones sin valuación.</p>}<p>{v.evaluations} evaluaciones · {v.noDataBlocks} bloqueos por datos</p><details><summary>Alcance de esta versión</summary><code>{v.contentHash}</code><p>Fills simulados. No representa el rendimiento de tu cuenta real.</p></details></section>)}</div>:<p className="lab-shadow-note">No hay métricas de ejecución para este proyecto en la lectura actual.</p>}
      {instances.length>0&&<section className="lab-shadow-instances"><h2>Ejecuciones</h2>{instances.map(i=><div key={i.instanceId}><strong>{i.lifecycleState}</strong><span>{i.schedulerState}</span><span>{hash(i.versionHash)===hash(strategy?.current?.spec_hash)?'Versión actual':'Otra versión'}</span><code title={i.versionHash}>{hash(i.versionHash).slice(0,12)}</code><small>{new Date(i.updatedAt).toLocaleString('es-AR')}</small></div>)}<button className="main-link" onClick={onMonitor}>Abrir seguimiento completo <ArrowUpRight size={15}/></button></section>}
      <p className="lab-shadow-note">El despliegue requiere crítica y aprobación del hash exacto. Se prepara desde el chat; abrir esta vista no activa una estrategia.</p>
    </>}
  </div>;
}
