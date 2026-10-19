const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { modelOptions, selection, modelFlags, normalize } = require('./lab-models');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const TYPES = ['personal', 'analysis', 'strategy'];
const TEXT = /\.(md|txt|json|yaml|yml|csv|tsv|py|log)$/i;
// Desde Archivos no se tocan los registros: JSON (con hash, los escribe el harness) ni el descriptor del proyecto.
const LOCKED = /\.json$/i;
const BAD_NAME = /[<>:"|?*\x00-\x1f]|(^|[\/\\])\.\.?($|[\/\\])/;
const PRIVATE = /(^|[\/\\])(?:\.|node_modules|auth|credentials|secrets|tokens|env\.json)/i;
function atomic(file, value) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); }
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) { if (e.code === 'ENOENT') return fallback; throw fail('No se pudo leer el registro local; no se sobrescribió.', 500); } }
function safeFile(dir, relative) {
  if (!relative || path.isAbsolute(relative) || PRIVATE.test(relative) || !TEXT.test(relative)) throw fail('Archivo no disponible.', 404);
  const base = fs.realpathSync(dir), target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw fail('Archivo fuera del proyecto.', 403);
  let actual; try { actual = fs.realpathSync(target); } catch { throw fail('Archivo no encontrado.', 404); }
  if (!actual.startsWith(base + path.sep) || !fs.statSync(actual).isFile()) throw fail('Archivo fuera del proyecto.', 403);
  if (fs.statSync(actual).size > 512 * 1024) throw fail('Archivo demasiado grande para la vista previa.', 413);
  return actual;
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
  if(/mapa-[\w-]+\.md/.test(file)||/mapa-[\w-]+\.md/.test(cmd)&&/>|Set-Content|write/i.test(cmd))return 'Actualizando el mapa';
  if(/Write|Edit/.test(tool||''))return /memory[\/]/.test(file)?'Actualizando la memoria del proyecto':'Guardando '+path.basename(file);
  if(tool==='Read')return 'Leyendo '+path.basename(file);
  let m=cmd.match(/galecore get ([\w.]+)(?:[^|;&]*?--symbol[ =]"?([\w$]+))?/);
  if(m){const [area,name]=m[1].split('.'),sym=m[2]?' de '+m[2].replace('$',''):'';
    const thing=THINGS[name]||(area==='calendar'?'el calendario':area==='macro'||area==='rates'?'datos macro':area==='filings'?'los informes a la SEC':area==='account'?'tu cuenta real':area==='history'?'la historia del índice':'datos de GaleCore');
    return 'Trayendo '+thing+sym;}
  if((m=cmd.match(/analyze pack --kind (\w+)(?:[^|;&]*?--symbol[ =]"?(\w+))?/)))return 'Armando el perfil '+(KINDS[m[1]]||m[1])+(m[2]?' de '+m[2]:'');
  const steps=[[/kb search/,'Buscando antecedentes'],[/catalog --match/,'Eligiendo cómo responder'],[/state/,'Mirando el estado de tus estrategias'],[/profile show/,'Leyendo tu perfil'],[/story pack/,'Leyendo la historia del mercado'],[/gap add/,'Anotando un dato que falta'],[/(research|strategy) save|project add/,'Guardando el avance'],[/strategy (check|critique|sheet|controls)/,'Revisando la propuesta'],[/python[^|]*( -c | -\s|<<)/,'Calculando'],[/grep|cat|ls|find|Get-Content/,'Revisando archivos']];
  for(const [re,label] of steps)if(re.test(cmd))return label;
  return 'Trabajando';
}
// Owner 18/10: mientras piensa, que se vea qué hizo (como Claude Code): los últimos pasos del turno, no sólo el actual.
function setActivity(chat,label){chat.activity=label;if(!label||label==='Pensando'||label==='Trabajando')return;const steps=chat.steps||(chat.steps=[]);if(steps.at(-1)?.label!==label)steps.push({label,at:new Date().toISOString()});if(steps.length>8)steps.splice(0,steps.length-8);}
function consumeEvent(chat, event, provider) {
  if(provider === 'codex') {
    if(event.type === 'thread.started') chat.nativeId = event.thread_id;
    if(event.type === 'item.completed' && event.item?.type === 'agent_message') chat.messages.push({id:crypto.randomUUID(),role:'assistant',text:event.item.text,at:new Date().toISOString()});
    if(event.type === 'item.started') setActivity(chat, event.item?.type === 'command_execution' ? describeStep('Bash',{command:event.item.command}) : event.item?.type === 'file_change' ? describeStep('Write',{file_path:(event.item.changes||[])[0]?.path}) : 'Pensando');
    if(event.type === 'turn.failed' || event.type === 'error') chat.error = event.error?.message || event.message || 'El motor no pudo completar el pedido.';
  } else {
    if(event.session_id) chat.nativeId = event.session_id;
    if(event.type === 'assistant') {
      // WS-0027: los textos intermedios son narración interna («Now try the CLI…»), llegan en eventos propios y no
      // van al chat. En el chat queda sólo la respuesta final del turno (evento `result`).
      const step=(event.message?.content || []).find(c=>c.type==='tool_use');if(step) setActivity(chat,describeStep(step.name,step.input));
    }
    if(event.type === 'result' && !event.is_error && event.result) chat.messages.push({id:crypto.randomUUID(),role:'assistant',text:event.result,at:new Date().toISOString()});
    if(event.type === 'result' && event.is_error) chat.error='Claude no pudo completar el pedido. Revisá acceso y permisos en el CLI.';
    if(event.permission_denials?.length) chat.error='Una herramienta necesita permiso. Retomá en la terminal para autorizarla; este chat no omite permisos.';
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
function createWorkspaces({ root, kb, local, binaries, environment, legacyProjects, legacySessions, execute = execFile, spawnProcess = spawn }) {
  const metadata = path.join(local,'lab-projects.json'), chatDir=path.join(local,'chats'), removedDir=path.join(local,'chats-borradas');
  // Nombre y archivado de cada proyecto, elegidos por el usuario en la lista (no tocan su carpeta ni sus registros).
  const overridesFile=path.join(local,'lab-project-overrides.json');
  fs.mkdirSync(chatDir,{recursive:true});
  let registry=read(metadata,[]);
  const jobs=new Map();
  const designReads=new Map();
  function designFingerprint(name) {
    const dir=path.join(kb,'strategies',name), digest=crypto.createHash('sha256');
    const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>/^\d+\.\d+\.\d+\.(proposal|approval|critique)\.json$/.test(f)).sort():[];
    for(const file of files){digest.update(file);digest.update(fs.readFileSync(path.join(dir,file)));}
    const log=path.join(kb,'projects',name+'.json');if(fs.existsSync(log))digest.update(fs.readFileSync(log));
    return digest.digest('hex');
  }
  async function readStrategy(p, design) {
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
        const meta=read(path.join(dir,'workspace.json'),null);
        if(meta&&meta.id===entry.name&&typeof meta.label==='string'&&meta.label.length<=100&&TYPES.includes(meta.type)&&(folder!=='strategies'||meta.type==='strategy'))descriptors.push({id:entry.name,label:meta.label,type:meta.type,relative:folder+'/'+entry.name,strategyName:meta.type==='strategy'?entry.name:null,dir});
      }
    }
    const all=old.map(p=>({...p,...registry.find(r=>r.id===p.id),...descriptors.find(d=>d.id===p.id)}));
    for(const p of descriptors)if(!all.some(o=>o.id===p.id))all.push(p);
    for(const p of registry){if(all.some(o=>o.id===p.id)||!p.relative)continue;const dir=path.join(kb,p.relative);if(fs.existsSync(dir) && fs.realpathSync(dir).startsWith(fs.realpathSync(kb)+path.sep))all.push({...p,dir});}
    const overrides=read(overridesFile,{});
    return all.map(p=>({...p,...(overrides[p.id]?.label?{label:overrides[p.id].label}:{}),...(overrides[p.id]?.archived?{archived:true}:{})}));
  }
  function setOverride(id,change){const all=read(overridesFile,{});all[id]={...all[id],...change};atomic(overridesFile,all);}
  function project(id){const p=listProjects().find(p=>p.id===id);if(!p)throw fail('Proyecto desconocido.',404);return p;}
  function createProject(body){
    const label=String(body.label||'').trim(), type=body.type;
    if(!label || label.length>100 || !TYPES.includes(type))throw fail('Indicá nombre y tipo de proyecto.');
    const slug=label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,60);
    if(!ID.test(slug) || listProjects().some(p=>p.id===slug))throw fail('Ya existe ese proyecto o el nombre no es válido.',409);
    const relative=(type==='strategy'?'strategies/':'workspaces/')+slug, dir=path.join(kb,relative);
    if(fs.existsSync(dir))throw fail('La carpeta ya existe. No se modificó su contenido.',409);
    fs.mkdirSync(path.dirname(dir),{recursive:true});
    if(!fs.realpathSync(path.dirname(dir)).startsWith(fs.realpathSync(kb)+path.sep))throw fail('Carpeta fuera del conocimiento local.',403);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir,'README.md'),'# '+label+'\n\nWorkspace de '+(type==='strategy'?'estrategia':type==='personal'?'trabajo personal':'análisis')+'.\n\nLos resultados y memorias se guardan acá. Las conversaciones permanecen en el historial local del Lab.\n',{flag:'wx'});
    fs.writeFileSync(path.join(dir,'AGENTS.md'),'# Convenciones de '+label+'\n\nTrabajá en este proyecto. Leé README.md y memory/README.md (el criterio vigente, por tema) y recuperá antecedentes antes de preguntar.\nUsá GaleCore-AI para memoria canónica y GaleCore para datos/cálculos financieros.\n'+'No guardes secretos. No mezcles cambios de otros proyectos. Guardar no aprueba ni despliega.\n',{flag:'wx'});
    fs.mkdirSync(path.join(dir,'memory'),{recursive:true});if(type!=='personal')fs.writeFileSync(path.join(dir,'memory','README.md'),'# Memoria de '+label+'\n\nCriterio vigente del proyecto, una página por tema. Índice:\n\n',{flag:'wx'});fs.mkdirSync(path.join(dir,'files'),{recursive:true});
    const p={id:slug,label,type,relative,strategyName:type==='strategy'?slug:null};fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});registry.push(p);atomic(metadata,registry);return p;
  }
  // Un workspace personal explícito y separado del conocimiento financiero compartido.
  if(!listProjects().some(p=>p.id==='personal'))createProject({label:'Personal',type:'personal'});
  const publicProject=({dir,...p})=>p;
  // Las conversaciones que abre tools/caso.py (origin «prueba») no se listan: el trader ve sólo las suyas.
  function listChats(){return chatFiles().map(f=>read(path.join(chatDir,f),null)).filter(c=>c&&c.origin!=='prueba').map(({messages,...c})=>({...c,messageCount:messages.length}));}
  // Al abrir una conversación nueva en un proyecto, el final de la anterior del mismo proyecto (ya guardada por el Lab):
  // retomar sin depender de que el modelo haya guardado (WS-0029 H8). No genera datos nuevos.
  function previousTail(chat){
    const prev=chatFiles().map(f=>read(path.join(chatDir,f),null)).filter(c=>c&&c.project===chat.project&&c.id!==chat.id&&(c.messages||[]).some(m=>m.role==='assistant')).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0];
    if(!prev)return '';
    const tail=prev.messages.slice(-4).map(m=>(m.role==='user'?'Trader: ':'Respuesta: ')+m.text).join('\n\n').slice(-4000);
    return 'Final de la conversación anterior de este proyecto («'+prev.title+'»), para retomar sin preguntar (lo vigente está en memory/ y en los registros):\n'+tail;
  }
  // Los scripts de contexto del producto (tools/terminal/context) los corre el Lab, no el motor (D-0014). Asíncrono para
  // no frenar el servidor; sin el script, si falla o tarda más de un minuto, nada: el turno sigue sin esa parte.
  function script(name,input){
    const file=path.join(root,'tools','terminal','context',name);
    if(!fs.existsSync(file))return Promise.resolve('');
    return new Promise(done=>{
      let out='';const proc=spawn('python',[file],{cwd:input.cwd,env:{...environment(),GALECORE_KNOWLEDGE_DIR:kb},windowsHide:true});
      const timer=setTimeout(()=>proc.kill(),60000);
      proc.stdout.setEncoding('utf8');proc.stdout.on('data',d=>{out+=d;});proc.stderr.on('data',()=>{});
      proc.on('error',()=>{clearTimeout(timer);done('');});proc.on('close',()=>{clearTimeout(timer);done(out.trim());});
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
      const args=['--no-daemon','exec','--json','-p',name,...modelFlags(chat),...(auto?['--approve-for-me']:[]),...sandbox];
      return {file,args:chat.nativeId?[...args,'resume',chat.nativeId,'-']:[...args,'--sandbox','workspace-write','-C',p.dir,'-']};
    }
    // Claude: sin la configuración del usuario ni conectores; los permisos (web después de GaleCore, sin tocar el código)
    // salen de knowledge/.claude/settings.json. Sonnet/medium por defecto (GALECORE_LAB_MODEL / GALECORE_LAB_EFFORT).
    const file=path.join(local,'contexts',chat.id+'.md');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,context);
    const args=['-p',...modelFlags(chat),'--output-format','stream-json','--verbose','--append-system-prompt-file',file,
      ...(auto?['--permission-mode','auto']:['--permission-prompts','none']),'--strict-mcp-config',
      '--setting-sources','project,local','--settings',path.join(kb,'.claude','settings.json')];
    return {file,args:chat.nativeId?[...args,'--resume',chat.nativeId]:args};
  }
  function send(chat, words, options={}){
    const auto=options.mode==='auto';
    const p=project(chat.project);
    if(jobs.has(chat.id))throw fail('La conversación está respondiendo.',409);
    if([...jobs.values()].some(j=>j.project===p.id || j.project==='portfolio' || p.id==='portfolio') || legacySessions().some(s=>s.state==='running'&&(s.project===p.id||s.project==='portfolio'||p.id==='portfolio')))throw fail('Otra sesión está trabajando en este workspace. Esperá a que termine.',409);
    if(jobs.size>=4)throw fail('Hay cuatro conversaciones trabajando.',409);
    if(!binaries[chat.provider])throw fail('El motor no está instalado.',409);
    // Legacy chats have no recoverable original model metadata. Freeze the fallback once,
    // before the next send; subsequent environment changes cannot alter this selection.
    if(chat.model === undefined || chat.effort === undefined){Object.assign(chat,normalize(chat.provider,chat),{selectionSource:'legacy-fallback'});saveChat(chat);}
    const ask={id:crypto.randomUUID(),role:'user',text:words,at:new Date().toISOString()};chat.messages.push(ask);
    if(!chat.titleLocked&&chat.messages.filter(m=>m.role==='user').length===1)chat.title=words.replace(/\s+/g,' ').slice(0,65);
    chat.state='running';chat.error=null;chat.activity='Pensando';chat.steps=[];chat.turnStartedAt=Date.now()-1000;saveChat(chat);
    const skill=path.join(root,'tools','terminal','skills','lab-strategy-bootstrap','SKILL.md');
    // El contexto del turno, igual para cualquier motor y cualquier tipo de proyecto (owner 15/10: «no importa el
    // proveedor ni el modelo»; Personal sin filtro). Capas (D-0012, D-0014): final de la conversación anterior
    // (estrategia), núcleo PRODUCT.md, proyecto, hechos del momento y capacidad del pedido. Las reglas del entorno
    // (knowledge/AGENTS.md) y las del proyecto (su AGENTS.md) las lee cada motor solo desde la carpeta.
    const product=fs.readFileSync(path.join(root,'GaleCore-AI','PRODUCT.md'),'utf8');
    const resume=p.type==='strategy'&&!chat.nativeId?previousTail(chat):'';  // sólo estrategia: en cartera los pedidos son sueltos
    const here='Proyecto: '+p.id+' ('+p.type+'), carpeta '+p.dir+'.'+(fs.existsSync(path.join(p.dir,'AGENTS.md'))?' Leé AGENTS.md de este proyecto.':'')+' Si el usuario quiere construir una estrategia o trabajar una en un símbolo, aplicá la skill '+skill+' y, si el proyecto no es de estrategia, ofrecé abrir uno una sola vez por conversación. Crear la carpeta no es estrategia aprobada; el bootstrap no despliega.'+(p.type==='strategy'
      // Owner 17/10: el mapa es el diseño que se va armando; se reescribe en cada turno con el formato vigente (también
      // si el de memory/ tiene otro formato) y la respuesta cierra proponiendo la próxima pieza del diseño.
      ?' Antes de responder, reescribí el mapa del proyecto (el mapa-*.md de memory/, o '+path.join(p.dir,'memory/mapa-'+chat.id.slice(0,8)+'.md')+' si no hay) con el formato de «Mapa de la idea», aunque nada haya cambiado: pasá lo que ya estaba a sus secciones (hipótesis, objetivo, reglas, datos, evidencia). Cerrá la respuesta según «Construir una estrategia es avanzar el diseño».'
      :' Si este turno trabaja una idea o una estrategia, antes de responder reescribí su mapa (formato en «Mapa de la idea») en '+path.join(p.dir,chat.mapa||('memory/mapa-'+chat.id.slice(0,8)+'.md'))+'; si la idea ya tiene un mapa en memory/, actualizá ése.');
    const job={proc:null,project:p.id,chat};jobs.set(chat.id,job);let done=false;const started=chat.turnStartedAt;
    function finish(code){if(done)return;done=true;jobs.delete(chat.id);chat.state=chat.state==='cancelled'?'cancelled':code===0&&!chat.error?'idle':'failed';chat.activity='';if(code!==0&&!chat.error&&chat.state!=='cancelled')chat.error='El motor terminó sin completar el pedido. Revisá su autenticación/permisos en la terminal.';try{const m=latestMapa(p.dir,started);if(m)chat.mapa=m;}catch{ /* sin mapa, el chat sigue */ }saveChat(chat);if(job.file)fs.rmSync(job.file,{force:true});script('commit_knowledge.py',{cwd:p.dir});}
    Promise.all([script('session_context.py',{cwd:p.dir}),script('match_request.py',{prompt:words,cwd:p.dir})]).then(([facts,asked])=>{
      if(chat.state==='cancelled')return finish(1);
      ask.context={facts,asked};saveChat(chat);  // lo mide tools/caso.py, sea cual sea el motor
      const context=[resume,product,here,facts,asked].filter(Boolean).join('\n\n');
      const engine=engineArgs(chat,p,context,auto);job.file=engine.file;
      const proc=job.proc=spawnProcess(binaries[chat.provider],engine.args,{cwd:p.dir,env:{...environment(),GALECORE_HOST_PROVIDER:chat.provider||'',GALECORE_HOST_MODEL:chat.model||''},windowsHide:true,stdio:['pipe','pipe','pipe']});
      const decoder=new StringDecoder('utf8');let pending='';
      proc.stdout.on('data',chunk=>{pending+=decoder.write(chunk);if(pending.length>2*1024*1024){proc.kill();chat.error='La salida superó el límite del chat.';return;}let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);try{consumeEvent(chat,JSON.parse(line),chat.provider);saveChat(chat);}catch{ /* Sólo eventos JSON, sin mostrar transcripciones internas. */ }}});
      proc.stderr.on('data',()=>{});proc.on('error',()=>{chat.error='No se pudo iniciar el motor local.';finish(1);});proc.on('close',code=>{if(pending.trim()){try{consumeEvent(chat,JSON.parse(pending),chat.provider);}catch{}}finish(code);});proc.stdin.end(words+'\n');
    }).catch(()=>{chat.error='No se pudo iniciar el motor local.';finish(1);});
    return chat;
  }
  async function route(req,res,url,json,readBody){
    const parts=url.pathname.split('/').filter(Boolean);
    if(req.method==='GET' && url.pathname==='/workspaces'){const shown=listProjects().filter(p=>!p.archived);json(res,200,{projects:shown.map(publicProject),chats:listChats().filter(c=>shown.some(p=>p.id===c.project)),chatOptions:modelOptions(),providers:['codex','claude'].map(id=>({id,label:id==='codex'?'Codex':'Claude Code',installed:!!binaries[id]}))});return true;}
    if(req.method==='POST' && url.pathname==='/workspaces'){json(res,201,createProject(await readBody(req)));return true;}
    if(req.method==='POST'&&parts[0]==='workspaces'&&parts[1]&&(parts[2]==='rename'||parts[2]==='archive')&&parts.length===3){
      const p=project(parts[1]);
      if(parts[2]==='rename'){const label=String((await readBody(req)).label||'').trim();if(!label||label.length>100)throw fail('Indicá un nombre de hasta 100 caracteres.');setOverride(p.id,{label});json(res,200,{...publicProject(p),label});return true;}
      // Eliminar un proyecto lo saca de la lista; su carpeta y sus registros quedan en knowledge/ (se recupera).
      if(p.id==='personal')throw fail('El espacio personal no se elimina.');
      if([...jobs.values()].some(j=>j.project===p.id))throw fail('El proyecto tiene una conversación respondiendo.',409);
      setOverride(p.id,{archived:true});json(res,200,{archived:true});return true;
    }
    if(req.method==='POST'&&parts[0]==='workspaces'&&parts[2]==='files'&&parts[3]&&parts.length===4){
      const p=project(parts[1]), b=await readBody(req), op=parts[3];
      if(p.id==='portfolio'&&[b.path,b.from,b.to].some(x=>/^(workspaces|strategies|projects)(\/|$)/i.test(String(x||'').replace(/\\/g,'/'))))throw fail('Eso es de otro proyecto: abrilo desde su proyecto.',403);
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
    if(req.method==='GET'&&parts[0]==='workspaces'&&parts[2]==='strategy'){
      const p=project(parts[1]); if(p.type!=='strategy')throw fail('Este proyecto no es una estrategia.');
      const value=await readStrategy(p,url.searchParams.get('view')==='design');json(res,200,value);return true;
    }
    if(req.method==='POST'&&parts[0]==='workspaces'&&parts[2]==='attachments'){
      // Un adjunto del chat (WS-0036): cuerpo crudo, nombre en X-File-Name, hasta 15 MB, a adjuntos/ del proyecto.
      const p=project(parts[1]), raw=decodeURIComponent(String(req.headers['x-file-name']||'archivo'));
      const safe=raw.replace(/[^\w.\- ]+/g,'_').replace(/^[.\s]+/,'').slice(-80)||'archivo';
      const chunks=[];let size=0;
      await new Promise((ok,ko)=>{req.on('data',d=>{size+=d.length;if(size>15*1024*1024){ko(fail('El archivo supera 15 MB.',413));req.destroy();}else chunks.push(d);});req.on('end',ok);req.on('error',ko);});
      // Desde Archivos («Subir») va a la carpeta elegida, con su nombre; desde el chat, a adjuntos/.
      const folder=url.searchParams.get('dir');
      if(folder!==null){const rel=(folder?folder.replace(/\/+$/,'')+'/':'')+safe;const target=projectPath(p.dir,rel,{editable:true});if(fs.existsSync(target))throw fail('Ya existe un archivo con ese nombre.',409);fs.writeFileSync(target,Buffer.concat(chunks));json(res,201,{path:rel,name:safe,size});return true;}
      const rel='adjuntos/'+Date.now()+'-'+safe;fs.mkdirSync(path.join(p.dir,'adjuntos'),{recursive:true});
      fs.writeFileSync(path.join(p.dir,rel),Buffer.concat(chunks));json(res,201,{path:rel,name:safe,size});return true;
    }
    if(req.method==='GET'&&parts[0]==='workspaces'&&parts[2]==='files'){
      const p=project(parts[1]), rel=url.searchParams.get('path');const target=rel?safeFile(p.dir,rel):null;if(p.id==='portfolio'&&target&&target.toLowerCase().startsWith(path.join(fs.realpathSync(p.dir),'workspaces').toLowerCase()+path.sep))throw fail('Elegí el proyecto personal para leer sus archivos.',403);json(res,200,rel?{path:rel,text:fs.readFileSync(target,'utf8')}:{tree:tree(p.dir).filter(n=>p.id!=='portfolio'||n.name!=='workspaces'),folder:p.relative});return true;
    }
    if(req.method==='POST'&&url.pathname==='/chats'){const b=await readBody(req);project(b.project);if(!['codex','claude'].includes(b.provider))throw fail('Motor desconocido.');let chosen;try{chosen=selection(b.provider,b);}catch(e){throw fail(e.message);}const c={id:crypto.randomUUID(),project:b.project,provider:b.provider,...chosen,...(b.origin==='prueba'?{origin:'prueba'}:{}),title:'Nueva conversación',createdAt:new Date().toISOString(),nativeId:null,state:'idle',activity:'',error:null,messages:[]};saveChat(c);json(res,201,c);return true;}
    if(parts[0]==='chats'&&parts[1]){const c=loadChat(parts[1]);
      if(req.method==='GET'&&parts.length===2){json(res,200,c);return true;}
      if(req.method==='GET'&&parts[2]==='mapa'){
        // Mientras responde, el mapa que se escribió en este turno ya se muestra (no espera al final).
        // WS-0044: en un proyecto de estrategia (una idea), una conversación que todavía no tocó el mapa ve el último del proyecto.
        const p=project(c.project), dir=p.dir, live=c.state==='running'&&c.turnStartedAt?latestMapa(dir,c.turnStartedAt):null, rel=live||c.mapa||(p.type==='strategy'?latestMapa(dir,0):null);
        if(!rel){json(res,200,{mapa:null});return true;}
        const file=safeFile(dir,rel);
        json(res,200,{mapa:{path:rel,updatedAt:fs.statSync(file).mtime.toISOString(),...parseMapa(fs.readFileSync(file,'utf8'))}});return true;}
      if(req.method==='POST'&&parts[2]==='messages'){const b=await readBody(req);const words=String(b.text||'').trim();if(!words||words.length>12000)throw fail('El mensaje debe tener entre 1 y 12000 caracteres.');
        // Adjuntos subidos antes a /workspaces/<id>/attachments: sólo rutas de adjuntos/ del proyecto, que existan.
        const dir=project(c.project).dir, files=(Array.isArray(b.attachments)?b.attachments:[]).slice(0,10).map(String);
        for(const rel of files){if(!/^adjuntos\/[\w.\- ]+$/.test(rel)||!fs.existsSync(path.join(dir,rel)))throw fail('Adjunto no encontrado: '+rel,404);}
        const text=files.length?words+'\n\nArchivos adjuntos (en la carpeta del proyecto): '+files.join(', '):words;
        json(res,202,send(c,text,{mode:b.mode==='auto'?'auto':'manual'}));return true;}
      if(req.method==='POST'&&parts[2]==='rename'){const title=String((await readBody(req)).title||'').trim();if(!title||title.length>100)throw fail('Indicá un nombre de hasta 100 caracteres.');c.title=title;c.titleLocked=true;saveChat(c);json(res,200,{id:c.id,title});return true;}
      // Eliminar saca la conversación del historial; el archivo pasa a chats-borradas/ (local, no se muestra).
      if(req.method==='POST'&&parts[2]==='delete'){if(jobs.has(c.id))throw fail('La conversación está respondiendo. Detenela antes de eliminarla.',409);fs.mkdirSync(removedDir,{recursive:true});fs.renameSync(path.join(chatDir,c.id+'.json'),path.join(removedDir,c.id+'.json'));json(res,200,{deleted:c.id});return true;}
      if(req.method==='POST'&&parts[2]==='stop'){const j=jobs.get(c.id);if(j){j.chat.state='cancelled';saveChat(j.chat);j.proc?.kill();}json(res,200,{requested:!!j});return true;}
    }
    return false;
  }
  return {route,listProjects,shutdown(){for(const j of jobs.values())j.proc?.kill();}};
}
module.exports={createWorkspaces,safeFile,tree,consumeEvent,parseMapa,describeStep};
