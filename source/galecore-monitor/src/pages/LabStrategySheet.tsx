import React from 'react';

export interface StrategyView {
  missing?: boolean;
  current?: {
    ref:string; approved:boolean; purpose:string; spec_hash:string;
    hypothesis?: {mechanism:string;expected_result:string;capture:string;failure_conditions:string[]};
    rules?: {id:string;block:string;text:string;parameter:string;runtime:string}[];
    owner_decisions?: {question:string;recommendation:string;status:string;decision:string}[];
    pending?: string[]; limitations?: string[]; declared_gaps?: string[];
  };
  versions?: {ref:string;approved:boolean}[];
  newer_than_approved?: string[];
  log?: {open?: {words:string}[]};
  integrity_failed?: unknown[];
}
const blocks = [
  ['entry','Entrada'],['construction','Construcción'],['sizing','Tamaño de posición'],
  ['monitoring','Seguimiento'],['adjustment','Gestión y ajustes'],['exit','Salida'],
  ['invalidation','Invalidación'],['risk','Riesgo'],['operational','Operativa'],
];
const runtimeLabel:Record<string,string> = {supported:'Compatible con SHADOW',unsupported:'Fuera del runtime',not_applicable:'No requiere ejecución'};

export function LabStrategySheet({strategy,onChat}:{strategy:StrategyView|null;onChat:(text?:string)=>void}) {
  const current = strategy?.current;
  const discuss = (subject:string) => onChat(`Revisemos ${subject} de ${current?.ref || 'este proyecto'}. Conservá el contexto del proyecto, distinguiendo lo definido de lo pendiente. Proponé el cambio antes de guardar una nueva versión.`);
  if (!current) return <section className="lab-shadow-draft"><h2>Empecemos a definir la estrategia</h2><p>Todavía no hay una propuesta guardada. Lo conversado en el chat aparecerá aquí cuando se guarde como reglas de una versión.</p><button className="btn" onClick={()=>onChat('Quiero definir la estrategia de este proyecto: hipótesis, reglas de entrada, gestión, salida, parámetros y decisiones pendientes. Revisemos primero lo que ya conversamos.')}>Definir en el chat</button></section>;
  const rules = current.rules || [];
  const parameters = rules.filter(r=>r.parameter);
  const pending = [...(current.pending || []),...(current.declared_gaps || []),...(strategy?.log?.open || []).map(e=>e.words)];
  const decisions = current.owner_decisions || [];
  const hypothesis = current.hypothesis;
  return <div className="lab-strategy-sheet">
    <section className="lab-design-source"><strong>Versión {current.ref.split('/').pop()}</strong><span>{current.approved?'Aprobada para SHADOW Dev':'Propuesta sin aprobar'}</span><small>{current.ref}</small>
      {!!strategy?.newer_than_approved?.length && <p>Hay propuestas posteriores sin aprobar: {strategy.newer_than_approved.join(', ')}. Esta ficha muestra la versión aprobada que devuelve el proyecto.</p>}
    </section>
    <section className="lab-design-section"><h2>Qué buscamos capturar</h2>{hypothesis?<dl className="lab-design-hypothesis">{[['Mecanismo',hypothesis.mechanism],['Resultado esperado',hypothesis.expected_result],['Cómo se captura',hypothesis.capture]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value || 'Sin definir en esta versión.'}</dd></div>)}</dl>:<p>Hipótesis sin definir en esta versión.</p>}
      {!!hypothesis?.failure_conditions?.length && <><h3>Cuándo falla la hipótesis</h3><ul>{hypothesis.failure_conditions.map((v,i)=><li key={i}>{v}</li>)}</ul></>}
    </section>
    <div className="lab-design-rules">{blocks.map(([block,label])=>{const items=rules.filter(r=>r.block===block);return <section className="lab-design-section" key={block}><header><h2>{label}</h2><button className="main-link" onClick={()=>discuss(`las reglas de ${label.toLowerCase()}`)}>Trabajar en chat</button></header>{items.length?items.map(r=><article key={r.id}><div className="lab-rule-meta"><span>{r.id}</span><span>{runtimeLabel[r.runtime] || 'Compatibilidad sin comprobar'}</span></div><p>{r.text}</p>{r.parameter&&<small>Parámetro: {r.parameter}</small>}<button className="main-link" onClick={()=>discuss(`la regla ${r.id}: ${r.text}`)}>Revisar regla</button></article>):<p className="lab-design-missing">Sin reglas guardadas en este bloque.</p>}</section>;})}</div>
    <section className="lab-design-section"><header><h2>Parámetros de las reglas</h2><button className="main-link" onClick={()=>discuss('los parámetros y su fundamento')}>Revisar en chat</button></header><p>Valores declarados en las reglas de esta versión.</p>{parameters.length?<dl className="lab-design-hypothesis">{parameters.map(r=><div key={r.id}><dt>{r.id}</dt><dd>{r.parameter}</dd></div>)}</dl>:<p className="lab-design-missing">No hay parámetros declarados en las reglas.</p>}</section>
    <section className="lab-design-section"><header><h2>Qué falta resolver</h2><button className="main-link" onClick={()=>discuss('los pendientes de diseño')}>Resolver en chat</button></header>{pending.length?<ul>{Array.from(new Set(pending)).map((v,i)=><li key={i}>{v}</li>)}</ul>:<p>No hay pendientes declarados. Esto no certifica que el diseño esté completo.</p>}{decisions.map((d,i)=><article key={i}><strong>{d.question}</strong><p>{d.status==='decided'?`Decisión guardada: ${d.decision}`:`Pendiente de decisión${d.recommendation?`: ${d.recommendation}`:''}`}</p></article>)}</section>
    {!!current.limitations?.length&&<section className="lab-design-section"><h2>Límites conocidos</h2><ul>{current.limitations.map((v,i)=><li key={i}>{v}</li>)}</ul></section>}
    <p className="lab-shadow-note">La ficha lee la propuesta guardada. Trabajar en chat prepara un mensaje que podés editar antes de enviarlo; la ficha se actualiza al volver o al usar Actualizar diseño.</p>
  </div>;
}
