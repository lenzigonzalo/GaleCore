import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Check, FlaskConical, RefreshCw } from 'lucide-react';
import { labRequest, WorkspaceProject } from '../api/lab';
import { fetchShadowMetrics, fetchShadowStatus } from '../api/shadow';
import { ShadowInstance, SpecVersionMetrics } from '../types/shadow';
import { LabStrategySheet, StrategyView } from './LabStrategySheet';
const hash=(h:string|undefined)=>h?.replace(/^sha256:/,'') || '';
const pnlClass=(n:number|null)=>n===null?'':n<0?'loss':n>0?'gain':'';
const usd=(n:number|null)=>n===null?'—':(n<0?'−':'')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const readError=(error:unknown,part:string)=>error instanceof Error && /timeout|aborted/i.test(error.message)
  ? `${part} tardó demasiado en responder. No pudimos comprobar su estado; reintentá la lectura.`
  : error instanceof Error ? error.message : `No se pudo leer ${part.toLowerCase()}.`;
export function LabShadow({project,onChat,onMonitor,mode='shadow'}:{project?:WorkspaceProject;onChat:(text?:string)=>void;onMonitor:()=>void;mode?:'design'|'shadow'}) {
  const [strategy,setStrategy]=useState<StrategyView|null>(null);
  const [metrics,setMetrics]=useState<SpecVersionMetrics[]>([]);
  const [instances,setInstances]=useState<ShadowInstance[]>([]);
  const [error,setError]=useState('');const [loading,setLoading]=useState(false);const [retry,setRetry]=useState(0);
  const [runtimeError,setRuntimeError]=useState('');const [runtimeLoading,setRuntimeLoading]=useState(false);
  useEffect(()=>{
    if(project?.type!=='strategy')return;let active=true;setLoading(true);setRuntimeLoading(true);setStrategy(null);setMetrics([]);setInstances([]);setError('');setRuntimeError('');
    labRequest<StrategyView>('/workspaces/'+project.id+'/strategy', undefined, 65000).then(s=>{
      if(!active)return;if(s.integrity_failed?.length)throw new Error('El harness detectó un problema de integridad en este proyecto.');setStrategy(s);
    }).catch(e=>{if(active)setError(readError(e,'La estrategia'));}).finally(()=>{if(active)setLoading(false);});
    if(mode==='shadow') Promise.all([fetchShadowMetrics(),fetchShadowStatus()]).then(([m,status])=>{
      if(!active)return;if(!status.persistence.available)throw new Error('El runtime no tiene persistencia disponible.');setMetrics(m.filter(v=>v.specName===project.strategyName));setInstances(status.instances.filter(i=>i.specName===project.strategyName));
    }).catch(e=>{if(active)setRuntimeError(readError(e,'La ejecución SHADOW'));}).finally(()=>{if(active)setRuntimeLoading(false);});
    return()=>{active=false;};
  },[project?.id,project?.type,project?.strategyName,retry,mode]);
  if(project?.type!=='strategy')return <div className="lab-shadow-empty"><FlaskConical size={30}/><h2>Shadow para tus estrategias</h2><p>Elegí un proyecto de estrategia para ver su preparación y sus ejecuciones.</p><button className="main-link" onClick={()=>onChat()}>Volver al chat</button></div>;
  const approved=!!strategy?.current?.approved;
  if(mode==='design') return <div className="lab-shadow-view"><header><div><span className="lab-eyebrow">ESTRATEGIA · DISEÑO</span><h1>La estrategia que estamos armando</h1>{strategy?.current?.purpose&&<p>{strategy.current.purpose}</p>}</div><button className="lab-icon" aria-label="Actualizar diseño" onClick={()=>setRetry(v=>v+1)}><RefreshCw size={18}/></button></header>{loading?<p role="status">Leyendo estrategia…</p>:error?<div className="lab-chat-error" role="alert">{error}<button onClick={()=>setRetry(v=>v+1)}>Reintentar lectura</button></div>:<LabStrategySheet strategy={strategy} onChat={onChat}/>}</div>;
  return <div className="lab-shadow-view"><header><div><span className="lab-eyebrow">SHADOW · SIMULACIÓN</span><h1>Preparación y ejecución</h1>{strategy?.current?.purpose&&<p>{strategy.current.purpose}</p>}</div><button className="lab-icon" aria-label="Actualizar Shadow" onClick={()=>setRetry(v=>v+1)}><RefreshCw size={18}/></button></header>
    {loading?<p role="status">Leyendo estrategia…</p>:error?<div className="lab-chat-error" role="alert">{error}<button onClick={()=>setRetry(v=>v+1)}>Reintentar lectura</button></div>:<>
      <ol className="lab-strategy-path">{[{label:'Workspace',done:true},{label:'Propuesta',done:!!strategy?.current},{label:'Aprobación',done:approved},{label:runtimeLoading||runtimeError?'SHADOW sin comprobar':'En Shadow',done:!!hash(strategy?.current?.spec_hash)&&instances.some(i=>i.lifecycleState==='RUNNING'&&hash(i.versionHash)===hash(strategy?.current?.spec_hash))}].map((s,i)=><li key={i} className={s.done?'done':''}><span>{s.done?<Check size={15}/>:i+1}</span>{s.label}</li>)}</ol>
      {!strategy?.current && <section className="lab-shadow-draft"><h2>De la idea a la estrategia</h2><p>El workspace está creado. En el chat vamos a trabajar la tesis, los datos, las reglas y el plan de evaluación; después, validar y criticar la propuesta antes de aprobar una versión.</p><button className="btn" onClick={()=>onChat()}>Continuar en el chat <ArrowUpRight size={16}/></button></section>}
      {strategy?.current && <div className="lab-shadow-version"><strong title={strategy.current.ref}>Versión {strategy.current.ref.split('/').pop()}</strong><span>{approved?'Versión aprobada':'Propuesta sin aprobar'}</span><button className="main-link" onClick={()=>onChat()}>Revisar en el chat</button></div>}
    </>}
    {runtimeLoading?<p role="status">Leyendo ejecución SHADOW…</p>:runtimeError?<div className="lab-chat-error" role="alert">{runtimeError}<button onClick={()=>setRetry(v=>v+1)}>Reintentar ejecución</button></div>:<>
      {metrics.length>0?<div className="lab-shadow-metrics">{metrics.map(v=><section key={v.contentHash}><header><h2>{v.specVersion}</h2><span>{v.instances} instancia{v.instances!==1?'s':''} · métricas por versión</span></header><dl><div><dt>P&L realizado</dt><dd className={pnlClass(v.realizedPnl)}>{usd(v.realizedPnl)}</dd></div><div><dt>P&L abierto</dt><dd className={pnlClass(v.unrealizedPnl)}>{usd(v.unrealizedPnl)}</dd></div><div><dt>Posiciones abiertas</dt><dd>{v.positionsOpen}</dd></div><div><dt>Operaciones cerradas</dt><dd>{v.positionsClosed}</dd></div></dl>{v.openPositionsNotValued>0&&<p>{v.openPositionsNotValued} posiciones sin valuación.</p>}<p>{v.evaluations} evaluaciones · {v.noDataBlocks} bloqueos por datos</p><details><summary>Alcance de esta versión</summary><code>{v.contentHash}</code><p>Fills simulados. No representa el rendimiento de tu cuenta real.</p></details></section>)}</div>:<p className="lab-shadow-note">No hay métricas de ejecución para este proyecto en la lectura actual.</p>}
      {instances.length>0&&<section className="lab-shadow-instances"><h2>Ejecuciones</h2>{instances.map(i=><div key={i.instanceId}><strong>{i.lifecycleState}</strong><span>{i.schedulerState}</span><span>{!hash(strategy?.current?.spec_hash)?'Versión sin comprobar':hash(i.versionHash)===hash(strategy?.current?.spec_hash)?'Versión actual':'Otra versión'}</span><code title={i.versionHash}>{hash(i.versionHash).slice(0,12)}</code><small>{new Date(i.updatedAt).toLocaleString('es-AR')}</small></div>)}<button className="main-link" onClick={onMonitor}>Abrir seguimiento completo <ArrowUpRight size={15}/></button></section>}
    </>}
    <p className="lab-shadow-note">El despliegue requiere crítica y aprobación de la versión exacta. Se prepara desde el chat; abrir esta vista no activa una estrategia.</p>
  </div>;
}
