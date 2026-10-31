const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { modelOptions, selection, modelFlags, normalize } = require('./lab-models');
const { createSharing } = require('./lab-sharing');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const TYPES = ['personal', 'analysis', 'strategy'];
const TEXT = /\.(md|txt|json|yaml|yml|csv|tsv|py|log)$/i;
const IMAGE_TYPES = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'};
function attachmentFile(dir, rel) {
  if(!/^adjuntos\/[\w.\- ]+$/.test(rel))throw fail('Adjunto no encontrado: '+rel,404);
  const base=fs.realpathSync(dir);let file;
  try{file=fs.realpathSync(path.join(base,rel));}catch{throw fail('Adjunto no encontrado: '+rel,404);}
  if(!file.startsWith(base+path.sep)||!fs.statSync(file).isFile())throw fail('Adjunto fuera del proyecto.',403);
  if(fs.statSync(file).size>15*1024*1024)throw fail('El archivo supera 15 MB.',413);
  return file;
}
// Desde Archivos no se tocan los registros: JSON (con hash, los escribe el harness) ni el descriptor del proyecto.
const LOCKED = /\.json$/i;
const BAD_NAME = /[<>:"|?*\x00-\x1f]|(^|[\/\\])\.\.?($|[\/\\])/;
const PRIVATE = /(^|[\/\\])(?:\.|node_modules|auth|credentials|secrets|tokens|env\.json)/i;
function atomic(file, value) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); }
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) { if (e.code === 'ENOENT') return fallback; throw fail('No se pudo leer el registro local; no se sobrescribió.', 500); } }
// PowerShell puede guardar texto en UTF-16 LE; leerlo como UTF-8 duplica el contenido con caracteres nulos.
function readProjectText(file) {
  const bytes = fs.readFileSync(file);
  return bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
}
function safeFile(dir, relative) {
  if (!relative || path.isAbsolute(relative) || PRIVATE.test(relative) || !TEXT.test(relative)) throw fail('Archivo no disponible.', 404);
  const base = fs.realpathSync(dir), target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw fail('Archivo fuera del proyecto.', 403);
  let actual; try { actual = fs.realpathSync(target); } catch { throw fail('Archivo no encontrado.', 404); }
  if (!actual.startsWith(base + path.sep) || !fs.statSync(actual).isFile()) throw fail('Archivo fuera del proyecto.', 403);
  if (fs.statSync(actual).size > 512 * 1024) throw fail('Archivo demasiado grande para la vista previa.', 413);
  return actual;
}
// Investigaciones (WS-0066): viven en knowledge/research/ (comunes); la que se guardó desde un proyecto lleva `project: <id>`
// en su encabezado y Archivos la muestra en la carpeta «investigaciones», sólo para leer (el cuerpo ya es Markdown legible).
const RESEARCH_DIR = 'investigaciones', RESEARCH_FILE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/;
function researchProject(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').split(/\r?\n---\r?\n/)[0];
    return (head.match(/^project: ['"]?([^\s'"]+)['"]?\s*$/m) || [])[1] || null;
  } catch { return null; }
}
function projectResearch(kb, id) {
  const dir = path.join(kb, 'research');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => RESEARCH_FILE.test(f) && researchProject(path.join(dir, f)) === id) : [];
}
function readResearch(kb, id, rel) {
  const name = rel.slice(RESEARCH_DIR.length + 1);
  if (!projectResearch(kb, id).includes(name)) throw fail('Archivo no encontrado.', 404);
  return fs.readFileSync(path.join(kb, 'research', name), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim() + '\n';
}
function tree(dir, prefix = '', depth = 0) {
  if (depth > 5) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => !e.isSymbolicLink() && !PRIVATE.test(e.name)).slice(0,200).flatMap(e => {
    const rel = prefix + e.name;
    if(e.isDirectory()) return [{ path:rel, name:e.name, kind:'folder', children:tree(path.join(dir,e.name),rel+'/',depth+1) }];
    return [{path:rel,name:e.name,kind:'file',...(TEXT.test(e.name)?{}:{text:false})}];
  });
}
// Una ruta del explorador de Archivos (owner 17/10: crear, editar, renombrar, eliminar como en el explorador): dentro
// del proyecto, sin archivos privados ni enlaces, con la carpeta de arriba ya existente.
function projectPath(dir, relative, { exists = false, editable = false } = {}) {
  relative = String(relative || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (relative === RESEARCH_DIR || relative.startsWith(RESEARCH_DIR + '/')) throw fail('«investigaciones» es sólo de lectura: son las investigaciones guardadas desde este proyecto.', 403);
  if (!relative || relative.length > 300 || path.isAbsolute(relative) || PRIVATE.test(relative) || BAD_NAME.test(relative)) throw fail('Nombre o ruta no válida.');
  if (editable && LOCKED.test(relative)) throw fail('Los registros JSON los escribe el harness; no se editan desde Archivos.', 403);
  const base = fs.realpathSync(dir), target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw fail('Ruta fuera del proyecto.', 403);
  let parent; try { parent = fs.realpathSync(path.dirname(target)); } catch { throw fail('La carpeta no existe.', 404); }
  if (parent !== base && !parent.startsWith(base + path.sep)) throw fail('Ruta fuera del proyecto.', 403);
  if (exists) { if (!fs.existsSync(target)) throw fail('No existe.', 404); if (fs.lstatSync(target).isSymbolicLink()) throw fail('Ruta fuera del proyecto.', 403); }
  return target;
}
function holdsRecords(target) {
  if (!fs.statSync(target).isDirectory()) return LOCKED.test(target);
  return fs.readdirSync(target, { withFileTypes: true }).some(e => LOCKED.test(e.name) || (e.isDirectory() && holdsRecords(path.join(target, e.name))));
}
// Qué está haciendo el motor, en palabras del trader (WS-0039: «mostrá qué se está haciendo», owner 16/10). Sólo la
// línea de actividad; el comando y su salida no se muestran.
const THINGS={option_chains:'la cadena de opciones',volatility_metrics:'volatilidad y próximo balance',candles:'la historia de precios',quote:'la cotización',trade:'el último precio',option_greeks:'los precios teóricos',earnings_history:'los balances pasados',gamma_exposure:'el GEX',gex_analysis:'el GEX',iv_rank:'el IV rank',implied_volatility:'la volatilidad por vencimiento',put_skew:'el skew'};
const KINDS={technical:'técnico',fundamental:'fundamental',macro:'macro',flow:'de flujo'};
function describeStep(tool,input){
  const cmd=String(input?.command||input?.cmd||''),file=String(input?.file_path||input?.path||'');
  if(tool==='Read'&&/mapa-[\w-]+\.md/.test(file))return 'Leyendo el mapa';
  if(/Write|Edit/.test(tool||'')&&/mapa-[\w-]+\.md/.test(file)||/mapa-[\w-]+\.md/.test(cmd)&&/>\s*["']?\S*mapa-[\w-]+\.md|Set-Content|Out-File|write_text|\.write\(/i.test(cmd))return 'Actualizando el mapa';
  if(/mapa-[\w-]+\.md/.test(cmd))return 'Leyendo el mapa';
  if(/Write|Edit/.test(tool||''))return /memory[\/]/.test(file)?'Actualizando la memoria del proyecto':'Guardando '+path.basename(file);
  if(tool==='Read')return 'Leyendo '+path.basename(file);
  if(tool==='Grep'||tool==='Glob')return 'Buscando en archivos';
  if(tool==='WebSearch'||tool==='WebFetch')return 'Buscando en la web';
  if(tool==='Skill')return 'Abriendo el método '+String(input?.skill||'');
  let m=cmd.match(/galecore get ([\w.]+)(?:[^|;&]*?--symbol[ =]"?([\w$]+))?/);
  if(m){const [area,name]=m[1].split('.'),sym=m[2]?' de '+m[2].replace('$',''):'';
    const thing=THINGS[name]||(area==='calendar'?'el calendario':area==='macro'||area==='rates'?'datos macro':area==='filings'?'los informes a la SEC':area==='account'?'tu cuenta real':area==='history'?'la historia del índice':'datos de GaleCore');
    return 'Trayendo '+thing+sym;}
  if((m=cmd.match(/analyze pack --kind (\w+)(?:[^|;&]*?--symbol[ =]"?(\w+))?/)))return 'Armando el perfil '+(KINDS[m[1]]||m[1])+(m[2]?' de '+m[2]:'');
  const steps=[[/kb search/,'Buscando antecedentes'],[/catalog --match/,'Eligiendo cómo responder'],[/state/,'Mirando el estado de tus estrategias'],[/profile show/,'Leyendo tu perfil'],[/story pack/,'Leyendo la historia del mercado'],[/gap add/,'Anotando un dato que falta'],[/(research|strategy) save|project add/,'Guardando el avance'],[/strategy (check|critique|sheet|controls)/,'Revisando la propuesta'],[/python[^|]*( -c | -\s|<<)/,'Calculando'],[/grep|cat|ls|find|Get-Content/,'Revisando archivos']];
  for(const [re,label] of steps)if(re.test(cmd))return label;
  return 'Trabajando';
}
// Owner 18/10-19/10: mientras trabaja, que se vea qué hace como en Claude Code: cada herramienta con su detalle
// (comando o archivo) y lo que el modelo va diciendo entre una y otra. Los últimos pasos del turno, no sólo el actual.
function stepDetail(tool,input){
  const file=String(input?.file_path||input?.path||'');
  if(file)return file.replace(/\\/g,'/').split('/').slice(-2).join('/');
  if(input?.pattern)return String(input.pattern);
  if(input?.query||input?.url)return String(input.query||input.url);
  const cmd=String(input?.command||input?.cmd||'').replace(/^"?[^"]*powershell(\.exe)?"?\s+-Command\s+(['"])([\s\S]*)\2\s*$/i,'$3').split(/\r?\n/)[0].replace(/^cd\s+("[^"]*"|\S+)\s*(&&|;)\s*/,'').replace(/python -B -m galecore_ai\.adapters\.cli/g,'galecore-ai').trim();
  const safe=cmd.replace(/(bearer|basic)\s+[^\s"']+/gi,'$1 •••').replace(/(api[_-]?key|token|password|secret)(\s*[:=]\s*)[^\s&"']+/gi,'$1$2•••');   // revisión 19/10: el detalle se guarda en el chat
  return safe.length>110?safe.slice(0,107)+'…':safe;
}
function pushStep(chat,step){const steps=chat.steps||(chat.steps=[]);const last=steps.at(-1);if(last&&last.label===step.label&&last.detail===step.detail)return;steps.push({...step,at:new Date().toISOString()});if(steps.length>14)steps.splice(0,steps.length-14);}
function setActivity(chat,label,detail=''){chat.activity=label;if(!label||label==='Pensando'||(label==='Trabajando'&&!detail))return;pushStep(chat,{label,detail});}
function setNote(chat,text){const t=String(text||'').replace(/\s+/g,' ').trim();if(!t)return;pushStep(chat,{label:t.length>160?t.slice(0,157)+'…':t,detail:'',kind:'note'});}
function limitText(resetsAt){
  if(typeof resetsAt !== 'number') return 'Se terminó tu límite de uso de Claude. Probá más tarde o seguí con Codex.';
  const at = new Date(resetsAt * 1000), today = at.toDateString() === new Date().toDateString();
  const hour = at.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  return 'Se terminó tu límite de uso de Claude. Vuelve ' + (today ? 'a las ' + hour : 'el ' + at.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' }) + ' a las ' + hour) + '; hasta entonces podés seguir con Codex.';
}
// Uso (WS-0067): sólo lo que el motor informa, por turno y sin estimar. Claude: `result.usage`, `modelUsage.<modelo>.contextWindow`,
// `total_cost_usd` y `rate_limit_event`; Codex: `turn.completed.usage` y telemetría de su sesión local.
function recordUsage(chat,turn,extra={}){
  const u=chat.usage||(chat.usage={turns:[]});
  u.turns.push({at:new Date().toISOString(),...turn});if(u.turns.length>500)u.turns.splice(0,u.turns.length-500);
  Object.assign(u,extra);
}
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:undefined;
function sessionTail(file){
  const size=fs.statSync(file).size,fd=fs.openSync(file,'r'),len=Math.min(size,262144),buf=Buffer.alloc(len);
  try{fs.readSync(fd,buf,0,len,size-len);}finally{fs.closeSync(fd);}
  return buf.toString('utf8').split('\n');
}
// Los chats anteriores al registro de uso no tienen `usage`. Recuperar sólo la última llamada real de Claude:
// su fecha no cambia al abrir el chat, y no se deducen ventana de contexto ni cuotas del nombre del modelo.
function claudeLastUsage(nativeId,home=process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude')){
  try{
    if(!UUID.test(String(nativeId||'')))return;
    const base=path.join(home,'projects');
    for(const dir of fs.readdirSync(base,{withFileTypes:true})){
      if(!dir.isDirectory())continue;
      const file=path.join(base,dir.name,nativeId+'.jsonl');if(!fs.existsSync(file))continue;
      const lines=sessionTail(file);
      for(let i=lines.length-1;i>=0;i--){
        let e;try{e=JSON.parse(lines[i]);}catch{continue;}
        const u=e.message?.usage,at=Date.parse(e.timestamp);
        if(e.type!=='assistant'||e.isSidechain||e.sessionId!==nativeId||!Number.isFinite(at)||!u)continue;
        if(num(u.input_tokens)===undefined||u.input_tokens<0||num(u.cache_read_input_tokens)===undefined||u.cache_read_input_tokens<0)continue;
        return{at:new Date(at).toISOString(),input:u.input_tokens+Math.max(0,num(u.cache_creation_input_tokens)||0)+u.cache_read_input_tokens,
          cached:u.cache_read_input_tokens,output:Math.max(0,num(u.output_tokens)||0)};
      }
    }
  }catch{/* Sin sesión legible: no fabricar uso ni modificar el chat. */}
}
function refreshClaudeUsage(chat){
  if(chat.provider!=='claude'||chat.usage?.turns?.length)return;
  const turn=claudeLastUsage(chat.nativeId);
  if(turn)(chat.usage||(chat.usage={turns:[]})).turns=[turn];
}
// Codex no manda sus límites por `exec --json`: los deja en el archivo de la sesión (`token_count.rate_limits`, % usado y hora
// de renovación de la ventana de 5 h y la semanal). Se lee lo último que escribió el motor, sin estimar; sin archivo, no se muestra.
function codexTelemetry(nativeId,home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')){
  try{
    if(!ID.test(String(nativeId||'')))return;
    const base=path.join(home,'sessions'),desc=d=>fs.readdirSync(d).sort().reverse();
    let file;
    for(const y of desc(base)){for(const m of desc(path.join(base,y))){for(const d of desc(path.join(base,y,m))){
      const hit=fs.readdirSync(path.join(base,y,m,d)).find(f=>f.endsWith(nativeId+'.jsonl'));if(hit){file=path.join(base,y,m,d,hit);break;}}
      if(file)break;}if(file)break;}
    if(!file)return;
    const lines=sessionTail(file).filter(l=>l.includes('"token_count"'));
    const telemetry={};
    for(let i=lines.length-1;i>=0;i--){
      let payload;try{payload=JSON.parse(lines[i])?.payload;}catch{continue;}
      if(payload?.type!=='token_count')continue;
      const info=payload.info,used=num(info?.last_token_usage?.total_tokens),window=num(info?.model_context_window);
      if(!telemetry.context&&used!==undefined&&used>=0&&window>0)telemetry.context={used,window};
      const rl=payload.rate_limits;
      if(!rl||telemetry.limit)continue;
      const windows={};
      for(const w of [rl.primary,rl.secondary]){
        if(!w||num(w.used_percent)===undefined||w.used_percent<0||![300,10080].includes(w.window_minutes))continue;
        windows[w.window_minutes===10080?'seven_day':'five_hour']={utilization:w.used_percent/100,resetsAt:num(w.resets_at)};
      }
      if(Object.keys(windows).length)telemetry.limit={windows};
      if(telemetry.context&&telemetry.limit)break;
    }
    if(Object.keys(telemetry).length)return telemetry;
  }catch{/* sin límites de Codex: el resto del uso se muestra igual */}
}
function codexLimits(nativeId,home){return codexTelemetry(nativeId,home)?.limit;}
function refreshCodexUsage(chat){
  if(chat.provider!=='codex')return;
  const telemetry=codexTelemetry(chat.nativeId);
  if(telemetry)Object.assign(chat.usage||(chat.usage={turns:[]}),telemetry);
}
function claudeUsage(chat,event){
  const u=event.usage;if(!u)return;
  const it=(Array.isArray(u.iterations)&&u.iterations.at(-1))||u;   // el contexto es el de la última vuelta, no la suma del turno
  const input=(num(u.input_tokens)||0)+(num(u.cache_read_input_tokens)||0)+(num(u.cache_creation_input_tokens)||0);
  const used=(num(it.input_tokens)||0)+(num(it.cache_read_input_tokens)||0)+(num(it.cache_creation_input_tokens)||0);
  const windows=Object.values(event.modelUsage||{}).map(m=>num(m?.contextWindow)).filter(Boolean);
  recordUsage(chat,{input,cached:num(u.cache_read_input_tokens)||0,output:num(u.output_tokens)||0,...(num(event.total_cost_usd)!==undefined?{costUsd:event.total_cost_usd}:{})},
    windows.length?{context:{used,window:Math.max(...windows)}}:{});
}
// «/skill» y «@agente» del chat (WS-0067): el trader elige una pieza de su espacio (o compartida con él) y el Lab se la indica al
// motor con el mismo mecanismo de siempre: leerla con `space show <tipo>/<clave>`. Igual para Claude y Codex (D-0014).
function mentionLine(list){
  const items=(Array.isArray(list)?list:[]).slice(0,8).filter(m=>m&&(m.kind==='skill'||m.kind==='agent')&&/^[\w.-]{1,80}$/.test(String(m.key||'')))
    .map(m=>({kind:m.kind,key:String(m.key),title:String(m.title||m.key).replace(/\s+/g,' ').slice(0,80)}));
  if(!items.length)return '';
  return '[El trader indicó: '+items.map(m=>(m.kind==='skill'?'aplicá la skill «':'trabajá con el agente «')+m.title+'» (leela con `space show '+m.kind+'/'+m.key+'` y seguila)').join('; ')+'.]';
}
// Segundo plano (WS-0067). Claude informa los subagentes y los comandos en segundo plano con eventos `system`
// (`task_started`, `task_progress`, `task_updated`, `task_notification`; los pasos del subagente traen `parent_tool_use_id`).
// Las tareas internas de un subagente (`owned_by_subagent`) no se muestran. Codex no informa nada parecido.
function consumeTask(chat,event){
  const tasks=chat.tasks||(chat.tasks=[]);
  const find=id=>tasks.find(t=>t.id===id);
  if(event.subtype==='task_started'&&!event.owned_by_subagent&&event.task_id){
    if(!find(event.task_id))tasks.push({id:event.task_id,kind:event.task_type==='local_agent'?'agent':'command',label:String(event.description||'').slice(0,120),...(event.subagent_type?{agentType:String(event.subagent_type)}:{}),status:'running'});
    if(tasks.length>12)tasks.splice(0,tasks.length-12);
  }
  const t=find(event.task_id);if(!t)return;
  if(event.subtype==='task_progress'){t.last=String(event.description||'').slice(0,110);if(num(event.usage?.total_tokens)!==undefined)t.tokens=event.usage.total_tokens;if(num(event.usage?.tool_uses)!==undefined)t.tools=event.usage.tool_uses;}
  if(event.subtype==='task_updated'&&event.patch?.status)t.status=String(event.patch.status);
  if(event.subtype==='task_notification'){t.status=String(event.status||'completed');if(event.summary)t.summary=String(event.summary).slice(0,200);}
}
function consumeEvent(chat, event, provider) {
  if(provider === 'codex') {
    if(event.type === 'thread.started') chat.nativeId = event.thread_id;
    // Owner 19/10: Codex narra en mensajes propios («Voy a comparar…»); sólo el último del turno es la respuesta, los
    // anteriores pasan a los pasos, como con Claude.
    if(event.type === 'item.completed' && event.item?.type === 'agent_message') {
      const prev=chat.messages.at(-1);
      if(chat.turnStartedAt&&prev?.role==='assistant'&&prev.turn===chat.turnStartedAt){chat.messages.pop();setNote(chat,prev.text);}
      chat.messages.push({id:crypto.randomUUID(),role:'assistant',text:event.item.text,at:new Date().toISOString(),...(chat.turnStartedAt?{turn:chat.turnStartedAt}:{})});
    }
    if(event.type === 'item.started') { const input=event.item?.type === 'command_execution' ? {command:event.item.command} : event.item?.type === 'file_change' ? {file_path:(event.item.changes||[])[0]?.path} : null;
      setActivity(chat, input ? describeStep(input.command ? 'Bash' : 'Write', input) : 'Pensando', input ? stepDetail('Bash', input) : ''); }
    if(event.type === 'item.completed' && event.item?.type === 'reasoning') setNote(chat, event.item.text);
    if(event.type === 'turn.completed' && event.usage) recordUsage(chat,{input:num(event.usage.input_tokens)||0,cached:num(event.usage.cached_input_tokens)||0,output:num(event.usage.output_tokens)||0});
    if(event.type === 'turn.completed')refreshCodexUsage(chat);
    if(event.type === 'turn.failed' || event.type === 'error') chat.error = event.error?.message || event.message || 'El motor no pudo completar el pedido.';
  } else {
    if(event.session_id) chat.nativeId = event.session_id;
    if(event.type === 'system' && /^task_/.test(event.subtype||'')) consumeTask(chat,event);
    if(event.type === 'assistant' && !event.parent_tool_use_id) {
      // WS-0027: los textos intermedios son narración interna («Now try the CLI…»), llegan en eventos propios y no
      // van al chat. En el chat queda sólo la respuesta final del turno (evento `result`).
      // Owner 19/10: la narración intermedia no va al chat como mensaje, pero sí a los pasos, como en Claude Code.
      for(const c of event.message?.content || []){
        if(c.type==='text'&&(event.message.content.some(x=>x.type==='tool_use')||event.message.stop_reason==='tool_use')) setNote(chat,c.text);
        if(c.type==='tool_use') setActivity(chat,describeStep(c.name,c.input),stepDetail(c.name,c.input));
      }
    }
    // Owner 24/10: si se terminó el límite de la suscripción, decirlo y cuándo vuelve (no «revisá permisos»).
    if(event.type === 'rate_limit_event' && event.rate_limit_info?.status === 'rejected') chat.limitResetsAt = event.rate_limit_info.resetsAt || true;
    if(event.type === 'rate_limit_event' && event.rate_limit_info){const i=event.rate_limit_info,w=i.unifiedWindows||{};
      (chat.usage||(chat.usage={turns:[]})).limit={status:i.status,resetsAt:num(i.resetsAt),utilization:num(i.utilization),type:i.rateLimitType,
        windows:Object.fromEntries(Object.entries(w).map(([k,v])=>[k,{utilization:num(v?.utilization),resetsAt:num(v?.resetsAt)}]))};}
    if(event.type === 'result') claudeUsage(chat,event);
    const limited = chat.limitResetsAt || (event.type === 'result' && event.is_error && /hit your .*limit|usage limit|rate.?limit/i.test(String(event.result || '')));
    if(event.type === 'result' && !event.is_error && event.result) chat.messages.push({id:crypto.randomUUID(),role:'assistant',text:event.result,at:new Date().toISOString()});
    if(event.type === 'result' && event.is_error) chat.error = limited ? limitText(chat.limitResetsAt) : 'Claude no pudo completar el pedido. Revisá acceso y permisos en el CLI.';
    // Con el Lab como host los permisos se preguntan en el chat; lo que el trader negó no es un error.
    const refused = (event.permission_denials || []).filter(d => !(chat.refused || []).includes(d.tool_use_id));
    // Owner 27/10: una regla del Lab (p. ej. no escribir en galecore-ai/) frena un paso aunque esté en Auto; si el turno
    // terminó, no es una falla: aviso de una línea con el paso, sin marcar el chat como fallido.
    if(event.type === 'result' && !event.is_error && refused.length) { const d = refused[0], detail = stepDetail(d.tool_name, d.tool_input); chat.notice = 'Un paso quedó sin hacer porque el Lab no lo permite' + (detail ? ' («' + detail + '»)' : '') + '; siguió por otro lado.'; }
  }
}
// Mapa de la idea (WS-0039): una página memory/mapa-<tema>.md que el agente reescribe en el turno. El Lab sólo anota
// cuál tocó cada chat y la sirve separada en secciones; no hay otra llamada al modelo.
const MAPA=/^mapa-[\w-]+\.md$/;
function latestMapa(dir,since){
  const mem=path.join(dir,'memory');if(!fs.existsSync(mem))return null;
  const found=fs.readdirSync(mem).filter(f=>MAPA.test(f)).map(f=>({f,t:fs.statSync(path.join(mem,f)).mtimeMs})).filter(x=>x.t>=since).sort((a,b)=>b.t-a.t)[0];
  return found?'memory/'+found.f:null;
}
function readMapa(dir,rel){
  const file=safeFile(dir,rel);
  return {path:rel,updatedAt:fs.statSync(file).mtime.toISOString(),...parseMapa(fs.readFileSync(file,'utf8'))};
}
function parseMapa(text){
  // Secciones fijas del diseño (Hipótesis, Objetivo, Entrada… Datos, Evidencia); las reglas y los datos van en tablas.
  // «- valor · qué es» = cifra grande; un bloque ```grafico con JSON = la serie que sostiene la evidencia, con su fuente.
  let title='';const intro=[],sections=[];let chart=null;
  for(const raw of text.split(/\r?\n/)){const line=raw.trim();
    if(chart!==null){if(line.startsWith('```')){try{const c=JSON.parse(chart);if(sections.length&&Array.isArray(c.series))sections.at(-1).chart=c;}catch{ /* JSON roto: sin gráfico */ }chart=null;}else chart+=raw+'\n';continue;}
    if(!line)continue;
    if(/^```grafico/.test(line)){chart='';continue;}
    if(/^# /.test(line)&&!title&&!sections.length){title=line.slice(2).trim();continue;}
    if(/^## /.test(line)){sections.push({heading:line.slice(3).trim(),lines:[]});continue;}
    if(!sections.length){intro.push(line);continue;}
    // Tablas markdown (owner 17/10: el mapa como la solapa Diseño): primera fila = encabezado, la de guiones se salta.
    if(line.startsWith('|')){const cells=line.replace(/^\||\|$/g,'').split('|').map(c=>c.trim());const sec=sections.at(-1);
      if(cells.every(c=>/^:?-{2,}:?$/.test(c)))continue;if(!sec.table)sec.table={head:cells,rows:[]};else sec.table.rows.push(cells);continue;}
    const item=line.replace(/^[-*]\s+/,''),mark=/^✓/.test(item)?'ok':/^✗/.test(item)?'missing':null;
    sections.at(-1).lines.push({mark,text:mark?item.slice(1).trim():item});
  }
  return {title,intro,sections};
}
function createWorkspaces({ root, kb, local, binaries, environment, legacyProjects, legacySessions, execute = execFile, spawnProcess = spawn, autoSync = false, request, sessionFile }) {
  const metadata = path.join(local,'lab-projects.json'), chatDir=path.join(local,'chats'), removedDir=path.join(local,'chats-borradas');
  // Nombre y archivado de cada proyecto, elegidos por el usuario en la lista (no tocan su carpeta ni sus registros).
  const overridesFile=path.join(local,'lab-project-overrides.json');
  fs.mkdirSync(chatDir,{recursive:true});
  let registry=read(metadata,[]);
  const jobs=new Map();
  const shellProjects=new Map();
  const designReads=new Map();
  function designFingerprint(name) {
    const dir=path.join(kb,'strategies',name), digest=crypto.createHash('sha256');
    const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>/^\d+\.\d+\.\d+\.(proposal|approval|critique)\.json$/.test(f)).sort():[];
    for(const file of files){digest.update(file);digest.update(fs.readFileSync(path.join(dir,file)));}
    const log=path.join(kb,'projects',name+'.json');if(fs.existsSync(log))digest.update(fs.readFileSync(log));
    return digest.digest('hex');
  }
  async function readStrategy(p, design) {
    if(p.externalStrategy)return {missing:true,reason:'El diseño referenciado no está incluido en esta copia compartida.'};
    const fingerprint=design?designFingerprint(p.strategyName):null;
    const cached=designReads.get(p.strategyName);
    if(design&&cached?.fingerprint===fingerprint)return cached.promise;
    const promise=new Promise((resolve,reject)=>execute('python',['-B','-m','galecore_ai.adapters.cli','project',design?'design':'show','strategy:'+p.strategyName],{cwd:root,env:environment(),windowsHide:true,timeout:60000,maxBuffer:2*1024*1024},(e,out)=>{
      let data;try{data=JSON.parse(out);}catch{return reject(fail('No se pudo leer la estrategia desde el harness.',502));}
      if(e&&!data.current){if(String(data.error||'').includes('no strategy named'))return resolve({missing:true});if(!data.integrity_failed?.length)return reject(fail('No se pudo verificar la estrategia con el harness.',502));}
      try{if(design&&designFingerprint(p.strategyName)!==fingerprint)return reject(fail('La estrategia cambió durante la lectura. Volvé a actualizar.',409));}catch{return reject(fail('Los archivos cambiaron durante la lectura. Volvé a actualizar.',409));}
      resolve(data);
    }));
    if(design){const entry={fingerprint,promise};designReads.set(p.strategyName,entry);promise.catch(()=>{if(designReads.get(p.strategyName)===entry)designReads.delete(p.strategyName);});}
    return promise;
  }
  const chatFiles=()=>fs.readdirSync(chatDir).filter(f=>UUID.test(f.replace('.json','')) && f.endsWith('.json'));
  const loadChat=id=>{if(!UUID.test(id))throw fail('Conversación desconocida.',404);const c=read(path.join(chatDir,id+'.json'),null);if(!c)throw fail('Conversación desconocida.',404);return c;};
  const saveChat=c=>atomic(path.join(chatDir,c.id+'.json'),c);
  for(const f of chatFiles()){const c=read(path.join(chatDir,f),null);if(c?.state==='running'){c.state='interrupted';c.activity='Servicio reiniciado';saveChat(c);}}
  function listProjects(){
    const old=legacyProjects().map(p=>({...p,type:p.id==='portfolio'?'analysis':'strategy',strategyName:p.id==='portfolio'?null:p.id}));
    const descriptors=[];
    for(const folder of ['workspaces','strategies']){
      const base=path.join(kb,folder);if(!fs.existsSync(base))continue;
      for(const entry of fs.readdirSync(base,{withFileTypes:true})){
        if(!entry.isDirectory()||!ID.test(entry.name))continue;
        const dir=path.join(base,entry.name);if(!fs.realpathSync(dir).startsWith(fs.realpathSync(kb)+path.sep))continue;
        const syncState=read(path.join(dir,'.sync.json'),null);
        const received=!!syncState;
        const meta=read(path.join(dir,'workspace.json'),null)||(syncState?.projectName?{id:entry.name,label:syncState.projectName,type:syncState.kind==='strategy'?'strategy':'analysis'}:null);
        if(received&&meta?.strategyName===meta?.id&&meta.id!==entry.name)meta.strategyName=entry.name;
        if(received&&folder==='strategies'&&meta)meta.strategyName=entry.name;
        const externalStrategy=received&&(!syncState.owner||syncState.owner!==syncState.context?.user)&&folder==='workspaces'&&meta?.type==='strategy'&&meta.strategyName&&meta.strategyName!==entry.name;
        if(meta&&(meta.id===entry.name||received)&&typeof meta.label==='string'&&meta.label.length<=100&&TYPES.includes(meta.type)&&(folder!=='strategies'||meta.type==='strategy'))descriptors.push({id:entry.name,label:meta.label,type:meta.type,relative:folder+'/'+entry.name,strategyName:externalStrategy?null:meta.type==='strategy'?(typeof meta.strategyName==='string'&&ID.test(meta.strategyName)?meta.strategyName:entry.name):null,...(externalStrategy?{externalStrategy:true}:{}),dir});
      }
    }
    const all=old.map(p=>({...p,...registry.find(r=>r.id===p.id),...descriptors.find(d=>d.id===p.id)}));
    for(const p of descriptors)if(!all.some(o=>o.id===p.id))all.push(p);
    // Una estrategia con carpeta propia no abre un proyecto aparte si otro proyecto ya la declara (strategyName en su workspace.json).
    const declared=new Set(descriptors.filter(d=>d.strategyName&&d.strategyName!==d.id).map(d=>d.strategyName));
    for(let i=all.length-1;i>=0;i--)if(declared.has(all[i].id)&&!descriptors.some(d=>d.id===all[i].id))all.splice(i,1);
    for(const p of registry){if(all.some(o=>o.id===p.id)||!p.relative)continue;const dir=path.join(kb,p.relative);if(fs.existsSync(dir) && fs.realpathSync(dir).startsWith(fs.realpathSync(kb)+path.sep))all.push({...p,dir});}
    const overrides=read(overridesFile,{});
    return all.map(p=>({...p,...(overrides[p.id]?.label?{label:overrides[p.id].label}:{}),...(overrides[p.id]?.archived?{archived:true}:{})}));
  }
  function setOverride(id,change){const all=read(overridesFile,{});all[id]={...all[id],...change};atomic(overridesFile,all);}
  // Borra la carpeta del proyecto (sólo dentro de knowledge/workspaces|strategies) y lo que cuelga: seguimientos, registro,
  // investigaciones que lo nombran, tareas (canceladas con el harness) y conversaciones (a chats-borradas/).
  async function removeProject(p){
    const kbReal=fs.realpathSync(kb), inside=(d,sub)=>{try{const r=fs.realpathSync(d);return r.startsWith(path.join(kbReal,sub)+path.sep);}catch{return false;}};
    const dirs=['workspaces','strategies'].map(f=>path.join(kb,f,p.id)).filter(d=>fs.existsSync(d)&&!fs.lstatSync(d).isSymbolicLink()&&inside(d,path.basename(path.dirname(d))));
    if(!dirs.length||!ID.test(p.id)){setOverride(p.id,{archived:true});return {archived:true};}
    const named=new RegExp('^([0-9]{4}-[0-9]{2}-[0-9]{2}-)?('+p.id+'|'+p.id.replace(/_/g,'-')+')([^a-z0-9_-]|$)','i'), gone=[...dirs];
    const research=path.join(kb,'research');
    if(fs.existsSync(research))for(const f of fs.readdirSync(research))if(named.test(f))gone.push(path.join(research,f));
    for(const f of projectResearch(kb,p.id))if(!gone.includes(path.join(research,f)))gone.push(path.join(research,f));
    for(const x of [path.join(kb,'followups',p.id),path.join(kb,'projects',p.id+'.json')])if(fs.existsSync(x))gone.push(x);
    const cancelled=[], tasksDir=path.join(kb,'tasks');
    for(const t of fs.existsSync(tasksDir)?fs.readdirSync(tasksDir):[]){
      const def=read(path.join(tasksDir,t,'task.json'),null);if(def?.strategy!==p.id||def.status==='cancelled')continue;
      await new Promise((ok,bad)=>execute('python',['-B','-m','galecore_ai.adapters.cli','task','cancel',t,'--prompt','Proyecto '+p.id+' eliminado en el Lab'],{cwd:root,env:environment(),windowsHide:true,timeout:60000},e=>e?bad(fail('No se pudo cancelar la tarea '+t+'; el proyecto no se borró.',502)):ok()));
      cancelled.push(t);
    }
    fs.mkdirSync(removedDir,{recursive:true});
    for(const f of chatFiles()){const c=read(path.join(chatDir,f),null);if(c?.project===p.id)fs.renameSync(path.join(chatDir,f),path.join(removedDir,f));}
    for(const x of gone)fs.rmSync(x,{recursive:true,force:true});
    const reg=registry.filter(r=>r.id!==p.id);if(reg.length!==registry.length){registry=reg;atomic(metadata,registry);}
    const ov=read(overridesFile,{});if(ov[p.id]){delete ov[p.id];atomic(overridesFile,ov);}
    let commit=null;
    if(fs.existsSync(path.join(kb,'.git'))){
      const rel=gone.map(x=>path.relative(kb,x).split(path.sep).join('/')), git=(...a)=>new Promise(ok=>execute('git',['-C',kb,...a],{windowsHide:true,timeout:60000},(e,out)=>ok(e?null:String(out).trim())));
      const staged=[];for(const r of rel)if(await git('add','-A','--',r)!==null)staged.push(r);   // lo que nunca se versionó no está en el commit
      if(staged.length&&await git('commit','-m','lab: proyecto '+p.id+' eliminado','--',...staged)!==null)commit=await git('rev-parse','--short','HEAD');
    }
    return {deleted:true,archived:true,cancelled,removed:gone.map(x=>path.relative(kb,x).split(path.sep).join('/')),commit};
  }
  function project(id){const p=listProjects().find(p=>p.id===id);if(!p)throw fail('Proyecto desconocido.',404);return p;}
  function createProject(body){
    const label=String(body.label||'').trim(), type=body.type||'analysis';   // owner 19/10: se crea sólo con nombre; la estrategia llega por intención (mark_strategy.py)
    if(!label || label.length>100 || !TYPES.includes(type))throw fail('Indicá el nombre del proyecto.');
    const slug=label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,60);
    if(!ID.test(slug) || listProjects().some(p=>p.id===slug))throw fail('Ya existe ese proyecto o el nombre no es válido.',409);
    const relative=(type==='strategy'?'strategies/':'workspaces/')+slug, dir=path.join(kb,relative);
    if(fs.existsSync(dir))throw fail('La carpeta ya existe. No se modificó su contenido.',409);
    fs.mkdirSync(path.dirname(dir),{recursive:true});
    if(!fs.realpathSync(path.dirname(dir)).startsWith(fs.realpathSync(kb)+path.sep))throw fail('Carpeta fuera del conocimiento local.',403);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir,'README.md'),'# '+label+'\n\nWorkspace de '+(type==='strategy'?'estrategia':type==='personal'?'trabajo personal':'análisis')+'.\n\nLos resultados y memorias se guardan acá. Las conversaciones permanecen en el historial local del Lab.\n',{flag:'wx'});
    fs.writeFileSync(path.join(dir,'AGENTS.md'),'# Convenciones de '+label+'\n\nTrabajá en este proyecto. Leé README.md y memory/README.md (el criterio vigente, por tema) y recuperá antecedentes antes de preguntar.\nUsá galecore-ai/ para memoria canónica y GaleCore (galecore-app/) para datos/cálculos financieros.\n'+'No guardes secretos. No mezcles cambios de otros proyectos. Guardar no aprueba ni despliega.\n',{flag:'wx'});
    fs.mkdirSync(path.join(dir,'memory'),{recursive:true});if(type!=='personal')fs.writeFileSync(path.join(dir,'memory','README.md'),'# Memoria de '+label+'\n\nCriterio vigente del proyecto, una página por tema. Índice:\n\n',{flag:'wx'});fs.mkdirSync(path.join(dir,'files'),{recursive:true});
    const p={id:slug,label,type,relative,strategyName:type==='strategy'?slug:null};fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});registry.push(p);atomic(metadata,registry);return p;
  }
  // Un workspace personal explícito y separado del conocimiento financiero compartido.
  if(!listProjects().some(p=>p.id==='personal'))createProject({label:'Personal',type:'personal'});
  // Proyectos compartidos (WS-0064): el CLI del harness sincroniza; acá sólo se dispara y se avisa si hubo conflictos.
  const sharing=createSharing({root,kb,environment,execute,...(request&&{request}),...(sessionFile&&{sessionFile})});
  const busy=p=>[...jobs.values()].some(j=>j.project===p.id)||shellProjects.has(p.id);
  const publicProject=({dir,...p})=>sharing.isShared({dir})?{...p,shared:true,following:sharing.isFollowing({dir}),syncNotice:sharing.notice(p)}:p;
  // Las conversaciones de prueba (origin «prueba») no se listan: el trader ve sólo las suyas.
  function listChats(){return chatFiles().map(f=>read(path.join(chatDir,f),null)).filter(c=>c&&c.origin!=='prueba').map(({messages,usage,...c})=>({...c,messageCount:messages.length}));}
  // Al abrir una conversación nueva en un proyecto, el final de la anterior del mismo proyecto (ya guardada por el Lab):
  // retomar sin depender de que el modelo haya guardado (WS-0029 H8). No genera datos nuevos.
  function previousTail(chat){
    const prev=chatFiles().map(f=>read(path.join(chatDir,f),null)).filter(c=>c&&c.project===chat.project&&c.id!==chat.id&&(c.messages||[]).some(m=>m.role==='assistant')).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0];
    if(!prev)return '';
    const tail=prev.messages.slice(-4).map(m=>(m.role==='user'?'Trader: ':'Respuesta: ')+m.text).join('\n\n').slice(-4000);
    return 'Final de la conversación anterior de este proyecto («'+prev.title+'»), para retomar sin preguntar (lo vigente está en memory/ y en los registros):\n'+tail;
  }
  // Los scripts de contexto del producto (galecore-lab/context) los corre el Lab, no el motor (D-0014). Asíncrono para
  // no frenar el servidor; si falla o tarda más de un minuto, avisa sin perder los otros bloques (WS-0059).
  function script(name,input){
    const label={'session_context.py':'hechos del momento','match_request.py':'capacidad del pedido'}[name];
    const missing=label?'['+label+'] contexto no disponible: falló su preparación.':'';
    const file=path.join(root,'galecore-lab','context',name);
    if(!fs.existsSync(file))return Promise.resolve(missing);
    return new Promise(done=>{
      let out='',timedOut=false;const proc=spawn('python',[file],{cwd:input.cwd,env:{...environment(),GALECORE_KNOWLEDGE_DIR:kb},windowsHide:true});
      const timer=setTimeout(()=>{timedOut=true;proc.kill();},60000);
      proc.stdout.setEncoding('utf8');proc.stdout.on('data',d=>{out+=d;});proc.stderr.on('data',()=>{});
      proc.on('error',()=>{clearTimeout(timer);done(missing);});proc.on('close',code=>{clearTimeout(timer);done([out.trim(),code!==0||timedOut?missing:''].filter(Boolean).join('\n'));});
      proc.stdin.end(JSON.stringify(input));
    });
  }
  // Lo único propio de cada motor: cómo recibe el contexto, cómo se le apagan navegador y conectores, y cómo retoma
  // (D-0014). El resto (qué contexto, qué datos, qué se guarda) es igual para todos. El contexto va por archivo, no por
  // la línea de comando (Windows la corta en ~32.000 caracteres); el archivo se borra al terminar el turno.
  function engineArgs(chat,p,context,auto){
    if(chat.provider==='codex'){
      // Codex no lee instrucciones de un archivo suelto: van como perfil (<CODEX_HOME>/<nombre>.config.toml, -p).
      const name='galecore-lab-'+chat.id, file=path.join(environment().CODEX_HOME||path.join(os.homedir(),'.codex'),name+'.config.toml');
      fs.writeFileSync(file,'developer_instructions = '+JSON.stringify(context)+'\n');
      // Búsqueda web sí (GaleCore primero, PRODUCT.md); navegador y conectores no; red para la API local de GaleCore;
      // escribe en el proyecto y en knowledge/.
      const sandbox=['-c','web_search="live"','--disable','browser_use','--disable','computer_use','--disable','in_app_browser','--disable','apps',
        '-c','sandbox_workspace_write.network_access=true','-c','sandbox_workspace_write.writable_roots='+JSON.stringify([kb])];
      const args=['--no-daemon','exec','--json','--skip-git-repo-check','-p',name,...modelFlags(chat),...(auto?['--approve-for-me']:[]),...sandbox];
      // --approve-for-me ya usa el sandbox workspace-write y Codex rechaza los dos juntos (0.164): en Auto no va --sandbox.
      return {file,args:chat.nativeId?[...args,'resume',chat.nativeId,'-']:[...args,...(auto?[]:['--sandbox','workspace-write']),'-C',p.dir,'-']};
    }
    // Claude: sin la configuración del usuario ni conectores; los permisos (web después de GaleCore, sin tocar el código)
    // salen de knowledge/.claude/settings.json. Sonnet/medium por defecto (GALECORE_LAB_MODEL / GALECORE_LAB_EFFORT).
    const file=path.join(local,'contexts',chat.id+'.md');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,context);
    // stdio mantiene los permisos en el chat también en CLI anteriores a --permission-prompts.
    // Manual usa default, igual que al cambiar el modo durante un turno: nunca bypassPermissions.
    const args=['-p',...modelFlags(chat),'--input-format','stream-json','--output-format','stream-json','--verbose','--append-system-prompt-file',file,
      '--permission-prompt-tool','stdio','--permission-mode',(auto?'auto':'default'),'--strict-mcp-config',
      '--setting-sources','project,local','--settings',path.join(kb,'.claude','settings.json')];
    return {file,args:chat.nativeId?[...args,'--resume',chat.nativeId]:args};
  }
  function send(chat, words, options={}){
    const auto=options.mode==='auto';
    const p=project(chat.project);
    if(sharing.isRunning(p))throw fail('El proyecto está sincronizando. Esperá a que termine para enviar.',409);
    if(jobs.has(chat.id))throw fail('La conversación está respondiendo.',409);
    if(jobs.size>=4)throw fail('Hay cuatro conversaciones trabajando.',409);
    if(!binaries[chat.provider])throw fail('El motor no está instalado.',409);
    // Legacy chats have no recoverable original model metadata. Freeze the fallback once,
    // before the next send; subsequent environment changes cannot alter this selection.
    if(chat.model === undefined || chat.effort === undefined){Object.assign(chat,normalize(chat.provider,chat),{selectionSource:'legacy-fallback'});saveChat(chat);}
    const ask={id:crypto.randomUUID(),role:'user',text:words,at:new Date().toISOString(),...(options.attachments?.length?{attachments:options.attachments}:{})};chat.messages.push(ask);
    if(!chat.titleLocked&&chat.messages.filter(m=>m.role==='user').length===1)chat.title=(words||options.attachments?.[0]?.replace(/^adjuntos\/\d+-/,'')||'Adjunto').replace(/\s+/g,' ').slice(0,65);
    chat.state='running';chat.error=null;chat.notice=null;chat.activity='Pensando';chat.steps=[];chat.permission=null;chat.refused=[];chat.tasks=[];delete chat.limitResetsAt;chat.mode=auto?'auto':'manual';chat.turnStartedAt=Date.now()-1000;saveChat(chat);
    const skill=path.join(root,'galecore-lab','skills','lab-strategy-bootstrap','SKILL.md');
    // El método de diseño es una sola copia, en galecore-ai/config/skills.
    const designSkill=path.join(root,'galecore-ai','config','skills','strategy-design','SKILL.md');
    let existingMapa=chat.mapa||null;if(!existingMapa){try{existingMapa=latestMapa(p.dir,0);}catch{ existingMapa=null; }}
    // El contexto del turno, igual para cualquier motor y cualquier tipo de proyecto (owner 15/10: «no importa el
    // proveedor ni el modelo»; Personal sin filtro). Capas (D-0012, D-0014): final de la conversación anterior
    // (estrategia), núcleo PRODUCT.md, proyecto, hechos del momento y capacidad del pedido. Las reglas del entorno
    // (knowledge/AGENTS.md) y las del proyecto (su AGENTS.md) las lee cada motor solo desde la carpeta.
    const product=fs.readFileSync(path.join(root,'galecore-ai','PRODUCT.md'),'utf8');
    const resume=p.type==='strategy'&&!chat.nativeId?previousTail(chat):'';  // sólo estrategia: en cartera los pedidos son sueltos
    const here='Proyecto: '+p.id+' ('+p.type+'), carpeta '+p.dir+'.'+(fs.existsSync(path.join(p.dir,'AGENTS.md'))?' Leé AGENTS.md de este proyecto.':'')+' Si el usuario quiere construir una estrategia o trabajar una en un símbolo, aplicá la skill '+skill+' (el método de diseño, strategy_design, está en '+designSkill+': es la única copia; no busques otra).'+(p.type==='strategy'||p.type==='personal'?'':' Si la conversación va hacia una estrategia, proponé una sola vez «¿armamos esta estrategia acá?»; con el sí, corré python "'+path.join(root,'galecore-lab','mark_strategy.py')+'" desde esta carpeta (activa el mapa de estrategia y su seguimiento) y seguí; no abras otro proyecto.')+' Registrarla no es estrategia aprobada; el bootstrap no despliega.'+(p.type==='strategy'
      // Owner 17/10: el mapa es el diseño que se va armando; se reescribe en cada turno con el formato vigente (también
      // si el de memory/ tiene otro formato) y la respuesta cierra proponiendo la próxima pieza del diseño.
      ?' Antes de responder, reescribí el mapa del proyecto ('+(existingMapa?'el que ya existe es '+path.join(p.dir,existingMapa)+' (ruta exacta, no la adivines)':'todavía no hay: creá '+path.join(p.dir,'memory/mapa-'+chat.id.slice(0,8)+'.md'))+') con el formato de «Mapa de la idea» (en el método de ideas y estrategias del contexto), aunque nada haya cambiado: pasá lo que ya estaba a sus 8 partes.'
      :' Si este turno trabaja una idea o una estrategia, antes de responder reescribí su mapa (formato en «Mapa de la idea», '+path.join(root,'galecore-ai','config','skills','strategy-design','method.md')+') en '+path.join(p.dir,existingMapa||('memory/mapa-'+chat.id.slice(0,8)+'.md'))+'; si la idea ya tiene un mapa en memory/, actualizá ése.');
    const job={proc:null,project:p.id,chat,asks:new Map()};jobs.set(chat.id,job);let done=false;const started=chat.turnStartedAt;
    function finish(code){if(done)return;done=true;jobs.delete(chat.id);chat.permission=null;for(const t of chat.tasks||[])if(t.status==='running')t.status='ended';chat.state=chat.state==='cancelled'?'cancelled':code===0&&!chat.error?'idle':'failed';chat.activity='';if(code!==0&&!chat.error&&chat.state!=='cancelled')chat.error='El motor terminó sin completar el pedido. Revisá su autenticación/permisos en la terminal.';try{const m=latestMapa(p.dir,started);if(m)chat.mapa=m;}catch{ /* sin mapa, el chat sigue */ }saveChat(chat);if(job.file)fs.rmSync(job.file,{force:true});sharing.sync(p,{busy}).catch(()=>null).then(()=>script('commit_knowledge.py',{cwd:p.dir}));}
    Promise.all([script('session_context.py',{prompt:words,cwd:p.dir}),script('match_request.py',{prompt:words,cwd:p.dir})]).then(([facts,asked])=>{
      if(chat.state==='cancelled')return finish(1);
      ask.context={facts,asked};saveChat(chat);  // lo mide el arnés de pruebas, sea cual sea el motor
      const context=[resume,product,here,facts,asked].filter(Boolean).join('\n\n');
      const engine=engineArgs(chat,p,context,auto);job.file=engine.file;
      const proc=job.proc=spawnProcess(binaries[chat.provider],engine.args,{cwd:p.dir,env:{...environment(),GALECORE_HOST_PROVIDER:chat.provider||'',GALECORE_HOST_MODEL:chat.model||'',...(chat.provider==='codex'?{}:{BASH_DEFAULT_TIMEOUT_MS:'300000',BASH_MAX_TIMEOUT_MS:'600000'})},windowsHide:true,stdio:['pipe','pipe','pipe']});
      const decoder=new StringDecoder('utf8');let pending='';
      const claude=chat.provider!=='codex';
      job.write=o=>{if(!proc.stdin.destroyed&&!proc.stdin.writableEnded)proc.stdin.write(JSON.stringify(o)+'\n');};
      // Un pedido de permiso queda en el chat hasta que el trader responde (POST /chats/<id>/permission); los otros pedidos
      // de control no los usa el Lab y se contestan con error para que el motor no espere.
      const control=e=>{
        if(e.request?.subtype!=='can_use_tool'){job.write({type:'control_response',response:{subtype:'error',request_id:e.request_id,error:'El Lab no atiende '+e.request?.subtype}});return;}
        const r=e.request;job.asks.set(e.request_id,r);
        chat.permission={id:e.request_id,tool:r.tool_name,label:describeStep(r.tool_name,r.input),detail:stepDetail(r.tool_name,r.input)||r.description||'',always:(r.permission_suggestions||[]).length>0};
        chat.activity='Esperando tu permiso';saveChat(chat);
      };
      proc.stdout.on('data',chunk=>{pending+=decoder.write(chunk);if(pending.length>2*1024*1024){proc.kill();chat.error='La salida superó el límite del chat.';return;}let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);try{const e=JSON.parse(line);if(claude&&e.type==='control_request'){control(e);continue;}if(claude&&e.type==='control_response')continue;consumeEvent(chat,e,chat.provider);if(claude&&e.type==='result')proc.stdin.end();saveChat(chat);}catch{ /* Sólo eventos JSON, sin mostrar transcripciones internas. */ }}});
      let stderrBuf='';proc.stderr.on('data',d=>{stderrBuf+=String(d);});proc.on('error',()=>{chat.error='No se pudo iniciar el motor local.';finish(1);});proc.on('close',code=>{if(stderrBuf.trim())console.error('[lab] stderr de '+chat.provider+':\n'+stderrBuf.slice(0,2000));if(pending.trim()){try{consumeEvent(chat,JSON.parse(pending),chat.provider);}catch{}}finish(code);});
      if(claude){job.write({type:'control_request',request_id:'init-'+chat.id,request:{subtype:'initialize'}});job.write({type:'user',message:{role:'user',content:options.prompt||words},parent_tool_use_id:null,session_id:''});}
      else proc.stdin.end((options.prompt||words)+'\n');
    }).catch(()=>{chat.error='No se pudo iniciar el motor local.';finish(1);});
    return chat;
  }
  async function route(req,res,url,json,readBody){
    const parts=url.pathname.split('/').filter(Boolean);
    if(req.method==='GET' && url.pathname==='/workspaces'){const shown=listProjects().filter(p=>!p.archived);json(res,200,{projects:shown.map(publicProject),chats:listChats().filter(c=>shown.some(p=>p.id===c.project)),chatOptions:modelOptions(),defaultProvider:process.env.GALECORE_LAB_PROVIDER==='claude'?'claude':'codex',providers:['codex','claude'].map(id=>({id,label:id==='codex'?'Codex':'Claude Code',installed:!!binaries[id]}))});return true;}
    if(req.method==='POST' && url.pathname==='/workspaces'){json(res,201,createProject(await readBody(req)));return true;}
    if(req.method==='GET' && url.pathname==='/workspaces/users'){json(res,200,await sharing.searchUsers(url.searchParams.get('q')));return true;}
    if(req.method==='GET' && url.pathname==='/workspaces/shared'){json(res,200,await sharing.catalog({busy}));return true;}
    if(req.method==='POST' && url.pathname==='/workspaces/sync'){json(res,200,await sharing.syncAll(listProjects,{busy}));return true;}
    if(req.method==='POST' && parts[0]==='shared-projects'&&parts.length===3&&['subscribe','pause'].includes(parts[2])){
      json(res,200,await sharing.subscribe(parts[1],parts[2]==='subscribe',listProjects,{busy}));return true;
    }
    if(parts[0]==='workspaces'&&parts[1]&&['sharing','share','unshare','sync','notice'].includes(parts[2])&&parts.length===3){
      const p=project(parts[1]);
      if(req.method==='GET'&&parts[2]==='sharing'){json(res,200,{...(await sharing.status(p)),notice:sharing.notice(p)});return true;}
      if(req.method!=='POST')return false;
      if(parts[2]==='share'){json(res,200,await sharing.share(p,await readBody(req),{busy}));return true;}
      if(parts[2]==='unshare'){json(res,200,await sharing.unshare(p,await readBody(req)));return true;}
      if(parts[2]==='notice'){sharing.clearNotice(p);json(res,200,{cleared:true});return true;}
      if(!sharing.isShared(p))throw fail('Este proyecto no está compartido.',409);
      const opts=(await readBody(req))||{};const summary=await sharing.sync(p,{busy,minInterval:opts.auto?20000:0});json(res,200,{...summary,notice:sharing.notice(p)});return true;
    }
    if(req.method==='POST'&&parts[0]==='workspaces'&&parts[1]&&(parts[2]==='rename'||parts[2]==='archive')&&parts.length===3){
      const p=project(parts[1]);
      if(sharing.isRunning(p)||busy(p))throw fail('El proyecto está trabajando; volvé a intentar al terminar.',409);
      if(parts[2]==='rename'){const label=String((await readBody(req)).label||'').trim();if(!label||label.length>100)throw fail('Indicá un nombre de hasta 100 caracteres.');setOverride(p.id,{label});json(res,200,{...publicProject(p),label});return true;}
      // Eliminar un proyecto lo borra de verdad con lo que cuelga de él (WS-0063); queda un commit en knowledge/ para deshacerlo.
      if(p.id==='personal')throw fail('El espacio personal no se elimina.');
      if(p.id==='portfolio')throw fail('Cartera no se elimina.');
      if([...jobs.values()].some(j=>j.project===p.id))throw fail('El proyecto tiene una conversación respondiendo.',409);
      json(res,200,await removeProject(p));return true;
    }
    if(req.method==='POST'&&parts[0]==='workspaces'&&parts[2]==='files'&&parts[3]&&parts.length===4){
      const p=project(parts[1]), b=await readBody(req), op=parts[3];
      if(sharing.isRunning(p)||busy(p))throw fail('El proyecto está trabajando; volvé a intentar al terminar.',409);
      if(op==='write'){
        const target=projectPath(p.dir,b.path,{editable:true});const text=String(b.text??'');
        if(!TEXT.test(target))throw fail('Sólo se editan archivos de texto (md, txt, csv, yaml, py).');
        if(Buffer.byteLength(text)>512*1024)throw fail('El archivo supera 512 KB.',413);
        if(b.create&&fs.existsSync(target))throw fail('Ya existe un archivo con ese nombre.',409);
        if(!b.create&&!fs.existsSync(target))throw fail('No existe.',404);
        fs.writeFileSync(target,text);json(res,200,{path:b.path});return true;
      }
      if(op==='mkdir'){const target=projectPath(p.dir,b.path);if(fs.existsSync(target))throw fail('Ya existe.',409);fs.mkdirSync(target);json(res,201,{path:b.path});return true;}
      if(op==='rename'){
        const from=projectPath(p.dir,b.from,{exists:true,editable:true}), to=projectPath(p.dir,b.to,{editable:true});
        if(fs.existsSync(to))throw fail('Ya existe uno con ese nombre.',409);if(holdsRecords(from))throw fail('La carpeta tiene registros del harness; no se mueve desde Archivos.',403);
        fs.renameSync(from,to);json(res,200,{path:b.to});return true;
      }
      if(op==='delete'){
        const target=projectPath(p.dir,b.path,{exists:true,editable:true});
        if(holdsRecords(target))throw fail('Tiene registros del harness; no se borra desde Archivos.',403);
        fs.rmSync(target,{recursive:true});json(res,200,{deleted:b.path});return true;
      }
      throw fail('Operación desconocida.',404);
    }
    // Al elegir un proyecto sin conversación, el panel muestra el último mapa del proyecto.
    if(req.method==='GET'&&parts[0]==='workspaces'&&parts[1]&&parts[2]==='mapa'&&parts.length===3){
      const dir=project(parts[1]).dir, rel=latestMapa(dir,0);
      json(res,200,{mapa:rel?readMapa(dir,rel):null});return true;}
    if(req.method==='GET'&&parts[0]==='workspaces'&&parts[2]==='strategy'){
      const p=project(parts[1]); if(p.type!=='strategy')throw fail('Este proyecto no es una estrategia.');
      const value=await readStrategy(p,url.searchParams.get('view')==='design');json(res,200,value);return true;
    }
    if(req.method==='GET'&&parts[0]==='workspaces'&&parts[2]==='attachments'&&parts.length===3){
      const p=project(parts[1]), rel=url.searchParams.get('path')||'', file=attachmentFile(p.dir,rel);
      const type=IMAGE_TYPES[path.extname(rel).toLowerCase()];
      res.writeHead(200,{'Content-Type':type||'application/octet-stream','Content-Disposition':(type?'inline':'attachment')+'; filename="'+path.basename(rel)+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(fs.readFileSync(file));return true;
    }
    if(req.method==='POST'&&parts[0]==='workspaces'&&parts[2]==='attachments'){
      // Un adjunto del chat (WS-0036): cuerpo crudo, nombre en X-File-Name, hasta 15 MB, a adjuntos/ del proyecto.
      const p=project(parts[1]), raw=decodeURIComponent(String(req.headers['x-file-name']||'archivo'));
      if(sharing.isRunning(p))throw fail('El proyecto está sincronizando; volvé a intentar al terminar.',409);
      const safe=raw.replace(/[^\w.\- ]+/g,'_').replace(/^[.\s]+/,'').slice(-80)||'archivo';
      const chunks=[];let size=0;
      await new Promise((ok,ko)=>{req.on('data',d=>{size+=d.length;if(size>15*1024*1024){ko(fail('El archivo supera 15 MB.',413));req.destroy();}else chunks.push(d);});req.on('end',ok);req.on('error',ko);});
      if(sharing.isRunning(p))throw fail('El proyecto está sincronizando; volvé a intentar al terminar.',409);
      // Desde Archivos («Subir») va a la carpeta elegida, con su nombre; desde el chat, a adjuntos/.
      const folder=url.searchParams.get('dir');
      if(folder!==null){const rel=(folder?folder.replace(/\/+$/,'')+'/':'')+safe;const target=projectPath(p.dir,rel,{editable:true});if(fs.existsSync(target))throw fail('Ya existe un archivo con ese nombre.',409);fs.writeFileSync(target,Buffer.concat(chunks));json(res,201,{path:rel,name:safe,size});return true;}
      const rel='adjuntos/'+Date.now()+'-'+safe;fs.mkdirSync(path.join(p.dir,'adjuntos'),{recursive:true});
      fs.writeFileSync(path.join(p.dir,rel),Buffer.concat(chunks));json(res,201,{path:rel,name:safe,size});return true;
    }
    if(req.method==='GET'&&parts[0]==='workspaces'&&parts[2]==='files'){
      const p=project(parts[1]), rel=url.searchParams.get('path');
      if(rel&&rel.startsWith(RESEARCH_DIR+'/')){json(res,200,{path:rel,text:readResearch(kb,p.id,rel)});return true;}
      if(rel){json(res,200,{path:rel,text:readProjectText(safeFile(p.dir,rel))});return true;}
      const mine=projectResearch(kb,p.id),nodes=tree(p.dir).filter(n=>n.name!==RESEARCH_DIR);
      if(mine.length)nodes.push({path:RESEARCH_DIR,name:RESEARCH_DIR,kind:'folder',children:mine.map(f=>({path:RESEARCH_DIR+'/'+f,name:f,kind:'file'}))});
      json(res,200,{tree:nodes,folder:p.relative});return true;
    }
    if(req.method==='POST'&&url.pathname==='/chats'){const b=await readBody(req);project(b.project);if(!['codex','claude'].includes(b.provider))throw fail('Motor desconocido.');let chosen;try{chosen=selection(b.provider,b);}catch(e){throw fail(e.message);}const c={id:crypto.randomUUID(),project:b.project,provider:b.provider,...chosen,...(b.origin==='prueba'?{origin:'prueba'}:{}),title:'Nueva conversación',createdAt:new Date().toISOString(),nativeId:null,state:'idle',activity:'',error:null,messages:[]};saveChat(c);json(res,201,c);return true;}
    if(parts[0]==='chats'&&parts[1]){const c=loadChat(parts[1]);
      if(req.method==='GET'&&parts.length===2){refreshCodexUsage(c);refreshClaudeUsage(c);json(res,200,c);return true;}
      if(req.method==='GET'&&parts[2]==='mapa'){
        // Mientras responde, el mapa que se escribió en este turno ya se muestra (no espera al final).
        // WS-0044: en un proyecto de estrategia (una idea), una conversación que todavía no tocó el mapa ve el último del proyecto.
        const p=project(c.project), dir=p.dir, live=c.state==='running'&&c.turnStartedAt?latestMapa(dir,c.turnStartedAt):null, rel=live||c.mapa||(p.type==='strategy'?latestMapa(dir,0):null);
        if(!rel){json(res,200,{mapa:null});return true;}
        json(res,200,{mapa:readMapa(dir,rel)});return true;}
      if(req.method==='POST'&&parts[2]==='messages'){const b=await readBody(req);
        // Ctrl+S del chat: se corta el turno y se manda el siguiente enseguida; el proceso tarda un instante en cerrar.
        if(c.state==='cancelled')for(let i=0;i<100&&jobs.has(c.id);i++)await new Promise(r=>setTimeout(r,50));const words=String(b.text||'').trim();if(words.length>12000)throw fail('El mensaje debe tener hasta 12000 caracteres.');
        // Adjuntos subidos antes a /workspaces/<id>/attachments: sólo rutas de adjuntos/ del proyecto, que existan.
        const targetProject=project(c.project);
        if(sharing.isRunning(targetProject))throw fail('El proyecto está sincronizando. Esperá a que termine para enviar.',409);
        const dir=targetProject.dir, files=(Array.isArray(b.attachments)?b.attachments:[]).slice(0,10).map(String);
        if(!words&&!files.length)throw fail('Escribí un mensaje o adjuntá un archivo.');
        for(const rel of files)attachmentFile(dir,rel);
        const text=files.length?words+'\n\nArchivos adjuntos (en la carpeta del proyecto): '+files.join(', '):words;
        // Editar el último mensaje (WS-0067): el motor no rebobina; el Lab saca del transcript ese pedido y su respuesta y le avisa que el texto nuevo lo reemplaza.
        let prompt;if(b.replace===true){if(jobs.has(c.id))throw fail('La conversación está respondiendo.',409);const at=c.messages.map(m=>m.role).lastIndexOf('user');if(at<0)throw fail('No hay un mensaje para reemplazar.',409);const old=c.messages[at].text;c.messages.splice(at);saveChat(c);if(b.retry!==true)prompt='[Este mensaje reemplaza al pedido anterior ("'+old.replace(/\s+/g,' ').slice(0,300)+'"): ignorá ese pedido y tu respuesta; lo que ya hiciste en archivos sigue ahí.]\n\n'+text;}
        const mentions=mentionLine(b.mentions);if(mentions)prompt=mentions+'\n\n'+(prompt||text);
        json(res,202,send(c,words,{mode:b.mode==='auto'?'auto':'manual',attachments:files,prompt:prompt||text}));return true;}
      if(req.method==='POST'&&parts[2]==='rename'){const title=String((await readBody(req)).title||'').trim();if(!title||title.length>100)throw fail('Indicá un nombre de hasta 100 caracteres.');c.title=title;c.titleLocked=true;saveChat(c);json(res,200,{id:c.id,title});return true;}
      // Eliminar saca la conversación del historial; el archivo pasa a chats-borradas/ (local, no se muestra).
      if(req.method==='POST'&&parts[2]==='delete'){if(jobs.has(c.id))throw fail('La conversación está respondiendo. Detenela antes de eliminarla.',409);fs.mkdirSync(removedDir,{recursive:true});fs.renameSync(path.join(chatDir,c.id+'.json'),path.join(removedDir,c.id+'.json'));json(res,200,{deleted:c.id});return true;}
      // Respuesta del trader a un pedido de permiso: permitir, permitir siempre (la sugerencia del motor, como «no volver a
      // preguntar» del CLI) o no permitir.
      if(req.method==='POST'&&parts[2]==='permission'){const b=await readBody(req),j=jobs.get(c.id),r=j?.asks.get(b.id);
        if(!r)throw fail('Ese pedido de permiso ya no está activo.',409);
        const decision=['allow','always','deny'].includes(b.decision)?b.decision:'deny';j.asks.delete(b.id);
        const response=decision==='deny'?{behavior:'deny',message:'El trader no lo permitió. Seguí sin eso o proponé otra forma.'}:{behavior:'allow',updatedInput:r.input,...(decision==='always'&&r.permission_suggestions?.length?{updatedPermissions:r.permission_suggestions}:{})};
        if(decision==='deny')j.chat.refused=[...(j.chat.refused||[]),r.tool_use_id];
        j.write({type:'control_response',response:{subtype:'success',request_id:b.id,response}});
        j.chat.permission=null;j.chat.activity='Trabajando';saveChat(j.chat);json(res,200,{decision});return true;}
      // Cambiar Manual/Auto en medio de una respuesta (Claude): el motor sigue con el modo nuevo.
      if(req.method==='POST'&&parts[2]==='mode'){const mode=(await readBody(req)).mode==='auto'?'auto':'manual',j=jobs.get(c.id),target=j?.chat||c;
        if(j?.write&&c.provider!=='codex')j.write({type:'control_request',request_id:'mode-'+Date.now(),request:{subtype:'set_permission_mode',mode:mode==='auto'?'auto':'default'}});
        target.mode=mode;saveChat(target);json(res,200,{mode,live:!!j});return true;}
      if(req.method==='POST'&&parts[2]==='stop'){const j=jobs.get(c.id);if(j){j.chat.state='cancelled';saveChat(j.chat);j.proc?.kill();}json(res,200,{requested:!!j});return true;}
    }
    return false;
  }
  if(autoSync)sharing.catalog().catch(()=>{});   // discover only; following requires an explicit choice
  function reserveShell(p){
    if(sharing.isRunning(p))throw fail('El proyecto está sincronizando; volvé a abrir la terminal al terminar.',409);
    shellProjects.set(p.id,(shellProjects.get(p.id)||0)+1);
    let released=false;
    return ()=>{if(released)return;released=true;const n=shellProjects.get(p.id)-1;if(n)shellProjects.set(p.id,n);else shellProjects.delete(p.id);};
  }
  return {route,listProjects,reserveShell,shutdown(){for(const j of jobs.values())j.proc?.kill();}};
}
module.exports={mentionLine,createWorkspaces,safeFile,tree,consumeEvent,parseMapa,describeStep,codexLimits,codexTelemetry,claudeLastUsage};
