import React from 'react';
interface Rule {id:string;block:string;text:string;parameter:string;runtime:string;runtime_note?:string;basis?:string;rationale?:string;sources?:string[]}
interface Parameter {name:string;value:string;unit:string;reasonable_range:string;depends_on:string;would_found:string;status:string;rules:string[];sources:string[]}
interface Gate {id:string;label:string;metric_ref:string;operator:string;threshold?:{value?:number;min?:number;max?:number};on_no_data?:string}
interface Controls {reglas:{regla:string;clase:string;nota?:string}[];indispensables:{control:string;estado:string}[];vigilancia_del_supervisor:{control:string;como:string;clase:string}[];motivo:string;recomendar_aprobacion:boolean}
interface Spec {
  universe?:{symbols?:string[];instrument_types?:string[]}; structure?:{default_structure?:string};
  operational?:{timezone?:string;calendar?:string;currency?:string;session_hours?:{start?:string;end?:string}};
  candidate_construction?:{constraints?:{min_dte?:number;max_dte?:number;min_credit?:number};sizing?:{fixed_contracts?:number};legs?:{side:string;type:string;strike_selection:{method:string;target_delta?:number;width?:number;delta_tolerance?:number;points_from_spot?:number;pct_from_spot?:number;strike?:number;from_leg?:string;offset_points?:number}}[]};
  entry_filters?:{gate_layer?:{gates?:Gate[]};signal_layer?:{gates?:Gate[]}};
  risk_limits?:{max_concurrent_positions?:number;min_minutes_between_entries?:number;max_loss_per_trade_usd?:number};
}
export interface StrategyView {
  missing?: boolean | string[];
  current?: {
    ref:string;approved:boolean;purpose:string;spec_hash:string;display_name?:string;recorded_at?:string;
    hypothesis?:{mechanism:string;expected_result:string;capture:string;failure_conditions:string[]};
    rules?:Rule[];parameters?:Parameter[];spec?:Spec;controls?:Controls;
    management?:{id:string;kind:string;trigger:string;action:string;rules:string[]}[];
    evaluation_plan?:{question:string;method:string;primary_metric:string;comparison:string;dependence:string;sample_sufficiency:string;supports_if:string;refutes_if:string;inconclusive_if:string;data:string;execution_evidence:string;owner_inputs:string[]};
    critique?:{verdict:string;missing:string[];biases:string[];alternative_explanation:string;why_not:string[];shutdown_criteria:string[];closed_trade_review:string};
    owner_decisions?:{question:string;recommendation:string;status:string;decision:string}[];
    pending?:string[];limitations?:string[];declared_gaps?:string[];
    runtime_sources?:{need:string;capability:string;endpoint:string;source:string;used_for:string}[];
    runtime_calculations?:{name:string;inputs:string;implementation:string;source:string}[];
  };
  versions?:{ref:string;approved:boolean}[];newer_than_approved?:string[];
  log?:{open?:{words:string}[]};integrity_failed?:unknown[];
}
const basis:Record<string,string>={grounded:'Con evidencia',hypothesis:'Hipótesis',pending_parameter:'Sin fundamento suficiente',owner_decision:'Decisión del usuario',design_choice:'Elección de diseño'};
const structures:Record<string,string>={iron_condor:'Iron condor',put_credit_spread:'Put credit spread',call_credit_spread:'Call credit spread'};
const operators:Record<string,string>={LT:'<',LTE:'≤',GT:'>',GTE:'≥',EQ:'=',BETWEEN:'entre'};
const defined=(value:unknown)=>value===undefined||value===null||value===''?'Sin definir':String(value);
function List({items}:{items:string[]}) {return <ul>{items.map((v,i)=><li key={i}>{v}</li>)}</ul>;}
function Table({headers,children}:{headers:string[];children:React.ReactNode}) {return <div className="lab-definition-table" tabIndex={0} role="region" aria-label={headers.join(', ')}><table><thead><tr>{headers.map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}
function Section({title,count,open=false,children}:{title:string;count?:number;open?:boolean;children:React.ReactNode}) {return <details className="lab-definition-section" open={open}><summary><h2>{title}</h2>{count!==undefined&&<span>{count}</span>}</summary><div className="lab-definition-body">{children}</div></details>;}
function RuleTable({rules,controls}:{rules:Rule[];controls?:Controls}) {
  if(!rules.length)return <p>Sin reglas guardadas en esta sección.</p>;
  return <Table headers={['Regla','Definición','Valor declarado','Control']}>{rules.map(r=><tr key={r.id}><td>{r.id}</td><td><p>{r.text}</p><details><summary>Fundamento y alcance</summary><p>{basis[r.basis || ''] || 'Fundamento no informado'}</p>{r.rationale&&<p>{r.rationale}</p>}{r.runtime_note&&<p>{r.runtime_note}</p>}{!!r.sources?.length&&<small>{r.sources.join(', ')}</small>}</details></td><td>{r.parameter || 'No separado en la regla'}</td><td>{controls?.reglas.find(c=>c.regla===r.id)?.clase || (r.runtime==='not_applicable'?'No aplica':'Sin clasificación comprobada')}</td></tr>)}</Table>;
}
export function LabStrategySheet({strategy}:{strategy:StrategyView|null}) {
  const c=strategy?.current;
  if(!c)return <section className="lab-shadow-draft"><h2>Diseño todavía sin guardar</h2><p>Este proyecto aún no tiene una propuesta canónica. Las definiciones aparecerán cuando se guarde una versión desde el chat.</p></section>;
  const rules=c.rules || [],params=c.parameters || [],management=c.management || [];
  const spec=c.spec,cons=spec?.candidate_construction?.constraints,op=spec?.operational,limits=spec?.risk_limits;
  const gates=[...(spec?.entry_filters?.gate_layer?.gates || []),...(spec?.entry_filters?.signal_layer?.gates || [])];
  const missing=[...(params.length?[]:['Tabla estructurada de parámetros ausente.']),...(management.length?[]:['Gestión como condición → acción ausente.']),...(spec?[]:['Definición estructurada de mercado e instrumentos ausente.']),...(c.evaluation_plan?[]:['Plan de evaluación ausente.']),'Falta un inventario completo por dato y cálculo: fuente de GaleCore, uso, frescura y respuesta si falta.','Mercado / plaza de ejecución no declarado explícitamente.'];
  const pending=Array.from(new Set([...(c.pending || []),...(strategy?.log?.open || []).map(v=>v.words)]));
  const ev=c.evaluation_plan;
  return <div className="lab-strategy-sheet">
    <div className="lab-design-identity"><span>Versión {c.ref.split('/').pop()}</span><span>{c.approved?'Aprobada para SHADOW Dev':'Propuesta sin aprobar'}</span><span className="lab-design-attention">Definiciones pendientes</span></div>
    {!!strategy?.newer_than_approved?.length&&<p className="lab-design-warning">Hay propuestas posteriores sin aprobar: {strategy.newer_than_approved.join(', ')}. Se muestra la versión aprobada.</p>}
    <section className="lab-design-overview" aria-label="Definición de la estrategia">
      <div><span className="lab-eyebrow">HIPÓTESIS</span><p>{c.hypothesis?.mechanism || 'Sin definir'}</p><span className="lab-eyebrow">OBJETIVO</span><p>{c.hypothesis?.expected_result || 'Sin definir'}</p>{c.hypothesis?.capture&&<details><summary>Cómo las reglas capturan la hipótesis</summary><p>{c.hypothesis.capture}</p></details>}</div>
      <dl className="lab-design-facts">{[
        ['Subyacentes',spec?.universe?.symbols?.join(', ')],['Instrumentos',spec?.universe?.instrument_types?.map(v=>v==='EQUITY_OPTION'?'Opciones sobre acciones / ETF':v).join(', ')],
        ['Estructura',structures[spec?.structure?.default_structure || ''] || spec?.structure?.default_structure],['Vencimiento',cons?.min_dte!==undefined&&cons?.max_dte!==undefined?cons.min_dte+'–'+cons.max_dte+' días':undefined],
        ['Sesión',op?.session_hours?.start&&op?.session_hours?.end?op.session_hours.start+'–'+op.session_hours.end+' · '+(op.timezone || 'Zona sin definir'):undefined],['Calendario declarado',op?.calendar],['Moneda',op?.currency],['Mercado / plaza',undefined],
      ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{defined(value)}</dd></div>)}</dl>
    </section>
    <div className="lab-design-warning"><strong>El diseño no declara todo lo necesario.</strong><details><summary>Ver definiciones faltantes</summary><List items={missing}/></details></div>
    <Section title="Entrada y umbrales" count={rules.filter(r=>r.block==='entry').length} open>
      {gates.length>0&&<Table headers={['Dato de entrada','Condición ejecutada','Si falta el dato']}>{gates.map(g=><tr key={g.id}><td>{g.label}<small>{g.metric_ref}</small></td><td className="lab-definition-value">{operators[g.operator] || g.operator} {defined(g.threshold?.value ?? (g.threshold?.min!==undefined&&g.threshold?.max!==undefined?g.threshold.min+'–'+g.threshold.max:undefined))}</td><td>{g.on_no_data==='BLOCK'?'Bloquear entrada':defined(g.on_no_data)}</td></tr>)}</Table>}
      <dl className="lab-design-facts lab-design-entry-facts">{[['Posiciones simultáneas',limits?.max_concurrent_positions],['Separación entre entradas',limits?.min_minutes_between_entries!==undefined?limits.min_minutes_between_entries+' minutos':undefined],['Crédito mínimo',cons?.min_credit!==undefined?cons.min_credit+' '+(op?.currency || '')+' por acción':undefined]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{defined(value)}</dd></div>)}</dl>
      <details><summary>Reglas completas de entrada</summary><RuleTable rules={rules.filter(r=>r.block==='entry')} controls={c.controls}/></details>
    </Section>
    <Section title="Instrumentos y construcción" count={rules.filter(r=>['construction','sizing'].includes(r.block)).length}>
      {!!spec?.candidate_construction?.legs?.length&&<Table headers={['Pata','Selección','Delta','Tolerancia','Ancho']}>{spec.candidate_construction.legs.map((leg,i)=><tr key={i}><td>{leg.side==='SELL'?'Vender':'Comprar'} {leg.type}</td><td>{leg.strike_selection.method}</td><td className="lab-definition-value">{defined(leg.strike_selection.target_delta)}</td><td>{defined(leg.strike_selection.delta_tolerance)}</td><td>{defined(leg.strike_selection.width)}</td></tr>)}</Table>}
      <p>Contratos fijos: <strong>{defined(spec?.candidate_construction?.sizing?.fixed_contracts)}</strong></p>
      <RuleTable rules={rules.filter(r=>['construction','sizing'].includes(r.block))} controls={c.controls}/>
    </Section>
    <Section title="Gestión y salida" count={management.length}>
      {management.length>0&&<Table headers={['Cuando ocurre','Acción','Reglas']}>{management.map(step=><tr key={step.id}><td>{step.trigger}</td><td>{step.action}</td><td>{step.rules.join(', ')}</td></tr>)}</Table>}
      <details><summary>Reglas completas de gestión y seguimiento</summary><RuleTable rules={rules.filter(r=>['monitoring','adjustment','exit'].includes(r.block))} controls={c.controls}/></details>
    </Section>
    <Section title="Riesgo e invalidación" count={rules.filter(r=>['risk','invalidation','operational'].includes(r.block)).length}>
      <p>Riesgo máximo por operación declarado: <strong>{defined(limits?.max_loss_per_trade_usd)} {op?.currency}</strong></p>
      <RuleTable rules={rules.filter(r=>['risk','invalidation','operational'].includes(r.block))} controls={c.controls}/>
    </Section>
    <Section title="Parámetros y fundamento" count={params.length}>
      {params.length?<Table headers={['Parámetro','Valor','Unidad','Rango de diseño','Fundamento']}>{params.map((p,i)=><tr key={i}><td><span>{p.name}</span><small>{p.rules.join(', ')}</small></td><td className="lab-definition-value">{p.value}</td><td>{p.unit}</td><td>{p.reasonable_range}</td><td>{basis[p.status] || p.status}<details><summary>Detalle del fundamento</summary><dl><dt>Depende de</dt><dd>{p.depends_on}</dd><dt>Evidencia necesaria</dt><dd>{p.would_found}</dd>{!!p.sources?.length&&<><dt>Fuentes guardadas</dt><dd>{p.sources.join(', ')}</dd></>}</dl></details></td></tr>)}</Table>:<p>Sin tabla estructurada. Los parámetros en texto no reemplazan unidad, rango y fundamento.</p>}
    </Section>
    <Section title="Datos y cálculos de GaleCore">
      <p className="lab-design-warning">Inventario del diseño incompleto: falta declarar cada dependencia y cálculo con su fuente, parámetros, frescura y respuesta ante datos faltantes.</p>
      {!!c.runtime_sources?.length&&<><h3>Fuentes de la implementación actual</h3><p>Rutas del código de GaleCore. No prueban disponibilidad en vivo ni cubren las reglas fuera del runtime.</p><Table headers={['Dato / cálculo','Origen','Uso']}>{c.runtime_sources.map((s,i)=><tr key={i}><td>{s.need}<small>{s.capability}</small></td><td><strong>{s.source}</strong><small>{s.endpoint}</small></td><td>{s.used_for}</td></tr>)}</Table></>}
      {!!c.runtime_calculations?.length&&<><h3>Cálculos implementados en GaleCore</h3><Table headers={['Cálculo','Entradas','Implementación']} >{c.runtime_calculations.map(s=><tr key={s.name}><td>{s.name}</td><td>{s.inputs}</td><td>{s.source}<small>{s.implementation}</small></td></tr>)}</Table></>}
      {ev?.data&&<details><summary>Datos declarados en el plan de evaluación</summary><p>{ev.data}</p></details>}
      {!!c.declared_gaps?.length&&<details><summary>Dependencias y controles sin ejecutar ({c.declared_gaps.length})</summary><List items={c.declared_gaps}/></details>}
    </Section>
    <Section title="Evaluación y crítica">
      {ev?<dl className="lab-design-evaluation">{[['Pregunta',ev.question],['Método',ev.method],['Métrica principal',ev.primary_metric],['Comparación',ev.comparison],['Dependencia entre operaciones',ev.dependence],['Muestra suficiente',ev.sample_sufficiency],['Apoya la hipótesis si',ev.supports_if],['Refuta la hipótesis si',ev.refutes_if],['Resultado inconcluso si',ev.inconclusive_if],['Qué demuestra SHADOW',ev.execution_evidence]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>:<p>Plan de evaluación sin guardar.</p>}
      {!!c.hypothesis?.failure_conditions?.length&&<details><summary>Condiciones de fallo de la hipótesis</summary><List items={c.hypothesis.failure_conditions}/></details>}
      {c.critique?<details><summary>Crítica guardada · {c.critique.verdict}</summary>{[['Qué falta para juzgar',c.critique.missing],['Sesgos',c.critique.biases],['Razones para no ejecutar',c.critique.why_not],['Cuándo detener',c.critique.shutdown_criteria]].map(([label,values])=><div key={label as string}><h3>{label}</h3><List items={values as string[]}/></div>)}<h3>Revisión tras cada cierre</h3><p>{c.critique.closed_trade_review}</p><h3>Explicación alternativa</h3><p>{c.critique.alternative_explanation}</p></details>:<p>Crítica no disponible en esta lectura.</p>}
    </Section>
    <Section title="Controles y decisiones pendientes" count={pending.length+(c.owner_decisions || []).filter(d=>d.status!=='decided').length}>
      {c.controls&&<><p>{c.controls.motivo}</p><Table headers={['Control indispensable','Estado']}>{c.controls.indispensables.map(v=><tr key={v.control}><td>{v.control}</td><td>{v.estado}</td></tr>)}</Table><details><summary>Lo que vigila el supervisor (alerta, sin bloquear)</summary><Table headers={['Control','Vigilancia']}>{c.controls.vigilancia_del_supervisor.map(v=><tr key={v.control}><td>{v.control}</td><td>{v.como}</td></tr>)}</Table></details></>}
      {!!pending.length&&<List items={pending}/>}
      {!!ev?.owner_inputs?.length&&<><h3>Umbrales y decisiones del usuario para evaluar</h3><List items={ev.owner_inputs}/></>}
      {!!c.owner_decisions?.length&&<Table headers={['Decisión','Estado','Respuesta / propuesta guardada']}>{c.owner_decisions.map((d,i)=><tr key={i}><td>{d.question}</td><td>{d.status==='decided'?'Decidida':'Pendiente'}</td><td>{d.status==='decided'?d.decision:d.recommendation}</td></tr>)}</Table>}
      {!!c.limitations?.length&&<details><summary>Límites conocidos</summary><List items={c.limitations}/></details>}
    </Section>
    <details className="lab-design-provenance"><summary>Versión y procedencia</summary><p>{c.ref}</p><p>{c.purpose}</p><code>{c.spec_hash}</code><p>{c.recorded_at?'Guardada: '+new Date(c.recorded_at).toLocaleString('es-AR'):''}</p></details>
  </div>;
}
