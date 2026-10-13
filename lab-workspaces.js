const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { StringDecoder } = require('string_decoder');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const TYPES = ['personal', 'analysis', 'strategy'];
const TEXT = /\.(md|txt|json|yaml|yml|csv|tsv)$/i;
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
    return TEXT.test(e.name) ? [{path:rel,name:e.name,kind:'file'}] : [];
  });
}
function consumeEvent(chat, event, provider) {
  if(provider === 'codex') {
    if(event.type === 'thread.started') chat.nativeId = event.thread_id;
    if(event.type === 'item.completed' && event.item?.type === 'agent_message') chat.messages.push({id:crypto.randomUUID(),role:'assistant',text:event.item.text,at:new Date().toISOString()});
    if(event.type === 'item.started') chat.activity = event.item?.type === 'command_execution' ? 'Consultando el workspace' : 'Trabajando';
    if(event.type === 'turn.failed' || event.type === 'error') chat.error = event.error?.message || event.message || 'El motor no pudo completar el pedido.';
  } else {
    if(event.session_id) chat.nativeId = event.session_id;
    if(event.type === 'assistant') {
      // WS-0027: los textos intermedios son narración interna («Now try the CLI…»), llegan en eventos propios y no
      // van al chat. En el chat queda sólo la respuesta final del turno (evento `result`).
      if((event.message?.content || []).some(c=>c.type==='tool_use')) chat.activity='Consultando el workspace';
    }
    if(event.type === 'result' && !event.is_error && event.result) chat.messages.push({id:crypto.randomUUID(),role:'assistant',text:event.result,at:new Date().toISOString()});
    if(event.type === 'result' && event.is_error) chat.error='Claude no pudo completar el pedido. Revisá acceso y permisos en el CLI.';
    if(event.permission_denials?.length) chat.error='Una herramienta necesita permiso. Retomá en la terminal para autorizarla; este chat no omite permisos.';
  }
}
function createWorkspaces({ root, kb, local, binaries, environment, instructions, legacyProjects, legacySessions, execute = execFile }) {
  const metadata = path.join(local,'lab-projects.json'), chatDir=path.join(local,'chats');
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
    for(const p of registry){if(all.some(o=>o.id===p.id))continue;const dir=path.join(kb,p.relative);if(fs.existsSync(dir) && fs.realpathSync(dir).startsWith(fs.realpathSync(kb)+path.sep))all.push({...p,dir});}
    return all;
  }
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
    fs.writeFileSync(path.join(dir,'AGENTS.md'),'# Convenciones de '+label+'\n\nTrabajá en este proyecto. Leé README.md y recuperá antecedentes antes de preguntar.\n'+(type==='personal'?'No incorpores cuenta, perfil financiero ni otros proyectos salvo pedido explícito.\n':'Usá GaleCore-AI para memoria canónica y GaleCore para datos/cálculos financieros.\n')+'No guardes secretos. No mezcles cambios de otros proyectos. Guardar no aprueba ni despliega.\n',{flag:'wx'});
    fs.mkdirSync(path.join(dir,'memory'),{recursive:true});fs.mkdirSync(path.join(dir,'files'),{recursive:true});
    const p={id:slug,label,type,relative,strategyName:type==='strategy'?slug:null};fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});registry.push(p);atomic(metadata,registry);return p;
  }
  // Un workspace personal explícito y separado del conocimiento financiero compartido.
  if(!listProjects().some(p=>p.id==='personal'))createProject({label:'Personal',type:'personal'});
  const publicProject=({dir,...p})=>p;
  function listChats(){return chatFiles().map(f=>read(path.join(chatDir,f),null)).filter(Boolean).map(({messages,...c})=>({...c,messageCount:messages.length}));}
  function send(chat, words){
    const p=project(chat.project);
    if(jobs.has(chat.id))throw fail('La conversación está respondiendo.',409);
    if([...jobs.values()].some(j=>j.project===p.id || j.project==='portfolio' || p.id==='portfolio') || legacySessions().some(s=>s.state==='running'&&(s.project===p.id||s.project==='portfolio'||p.id==='portfolio')))throw fail('Otra sesión está trabajando en este workspace. Esperá a que termine.',409);
    if(jobs.size>=4)throw fail('Hay cuatro conversaciones trabajando.',409);
    if(!binaries[chat.provider])throw fail('El motor no está instalado.',409);
    chat.messages.push({id:crypto.randomUUID(),role:'user',text:words,at:new Date().toISOString()});
    if(chat.messages.filter(m=>m.role==='user').length===1)chat.title=words.replace(/\s+/g,' ').slice(0,65);
    chat.state='running';chat.error=null;chat.activity='Pensando';saveChat(chat);
    const skill=path.join(root,'tools','terminal','skills','lab-strategy-bootstrap','SKILL.md');
    const context=p.type==='personal' ? 'Proyecto personal '+p.label+'. Leé las convenciones y memoria de este workspace. No consultes cuenta ni harness financiero salvo pedido explícito. No continúes ACTIVE_WORK_ITEM. No guardes secretos ni cambios ajenos.' : instructions(p)+'\nTipo del proyecto: '+p.type+'. Leé AGENTS.md de este workspace. Si el usuario quiere construir una estrategia o pide trabajar una estrategia en un símbolo, aplicá la skill '+skill+'. No confundir crear carpeta con estrategia aprobada. El bootstrap no despliega. Sólo guardá memoria de este proyecto.';
    let args;
    if(chat.provider==='codex'){
      args=['--no-daemon','exec','--json','-c','developer_instructions='+JSON.stringify(context)];
      if(chat.nativeId)args.push('resume',chat.nativeId,'-');else args.push('--sandbox','workspace-write','-C',p.dir,'-');
    } else {
      // WS-0028 (plan v2): el CLI abierto en la carpeta del proyecto con el contexto de producto de knowledge/ (sin el de
      // desarrollo ni ~/.claude). Permisos, hooks y commit automático salen de knowledge/.claude/settings.json.
      // Sonnet/medium por defecto (GALECORE_LAB_MODEL / GALECORE_LAB_EFFORT). Sin conectores de la cuenta.
      // D-0012: el núcleo del producto (GaleCore-AI/PRODUCT.md) va como instrucción de sistema; un import desde
      // knowledge/CLAUDE.md no carga en -p por estar fuera de la carpeta, y en el hook de inicio se recortaba.
      const product=p.type==='personal'?'':fs.readFileSync(path.join(root,'GaleCore-AI','PRODUCT.md'),'utf8')+'\n\n';
      const brief=p.type==='personal'?context:product+'Proyecto: '+p.id+' ('+p.type+').'+(fs.existsSync(path.join(p.dir,'AGENTS.md'))?' Leé AGENTS.md de este proyecto.':'')+(p.type==='strategy'?' Si el usuario quiere construir una estrategia o trabajar una en un símbolo, aplicá la skill '+skill+'. Crear la carpeta no es estrategia aprobada; el bootstrap no despliega.':'');
      args=['-p','--model',process.env.GALECORE_LAB_MODEL||'sonnet','--effort',process.env.GALECORE_LAB_EFFORT||'medium',
        '--output-format','stream-json','--verbose','--append-system-prompt',brief,'--permission-prompts','none','--strict-mcp-config',
        '--setting-sources','project,local','--settings',path.join(kb,'.claude','settings.json')];
      if(chat.nativeId)args.push('--resume',chat.nativeId);
    }
    const proc=spawn(binaries[chat.provider],args,{cwd:p.dir,env:environment(),windowsHide:true,stdio:['pipe','pipe','pipe']});
    jobs.set(chat.id,{proc,project:p.id,chat});const decoder=new StringDecoder('utf8');let pending='',done=false;
    function finish(code){if(done)return;done=true;jobs.delete(chat.id);chat.state=chat.state==='cancelled'?'cancelled':code===0&&!chat.error?'idle':'failed';chat.activity='';if(code!==0&&!chat.error&&chat.state!=='cancelled')chat.error='El motor terminó sin completar el pedido. Revisá su autenticación/permisos en la terminal.';saveChat(chat);}
    proc.stdout.on('data',chunk=>{pending+=decoder.write(chunk);if(pending.length>2*1024*1024){proc.kill();chat.error='La salida superó el límite del chat.';return;}let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);try{consumeEvent(chat,JSON.parse(line),chat.provider);saveChat(chat);}catch{ /* Sólo eventos JSON, sin mostrar transcripciones internas. */ }}});
    proc.stderr.on('data',()=>{});proc.on('error',()=>{chat.error='No se pudo iniciar el motor local.';finish(1);});proc.on('close',code=>{if(pending.trim()){try{consumeEvent(chat,JSON.parse(pending),chat.provider);}catch{}}finish(code);});proc.stdin.end(words+'\n');return chat;
  }
  async function route(req,res,url,json,readBody){
    const parts=url.pathname.split('/').filter(Boolean);
    if(req.method==='GET' && url.pathname==='/workspaces'){json(res,200,{projects:listProjects().map(publicProject),chats:listChats(),providers:['codex','claude'].map(id=>({id,label:id==='codex'?'Codex':'Claude Code',installed:!!binaries[id]}))});return true;}
    if(req.method==='POST' && url.pathname==='/workspaces'){json(res,201,createProject(await readBody(req)));return true;}
    if(req.method==='GET'&&parts[0]==='workspaces'&&parts[2]==='strategy'){
      const p=project(parts[1]); if(p.type!=='strategy')throw fail('Este proyecto no es una estrategia.');
      const value=await readStrategy(p,url.searchParams.get('view')==='design');json(res,200,value);return true;
    }
    if(req.method==='GET'&&parts[0]==='workspaces'&&parts[2]==='files'){
      const p=project(parts[1]), rel=url.searchParams.get('path');const target=rel?safeFile(p.dir,rel):null;if(p.id==='portfolio'&&target&&target.toLowerCase().startsWith(path.join(fs.realpathSync(p.dir),'workspaces').toLowerCase()+path.sep))throw fail('Elegí el proyecto personal para leer sus archivos.',403);json(res,200,rel?{path:rel,text:fs.readFileSync(target,'utf8')}:{tree:tree(p.dir).filter(n=>p.id!=='portfolio'||n.name!=='workspaces'),folder:p.relative});return true;
    }
    if(req.method==='POST'&&url.pathname==='/chats'){const b=await readBody(req);project(b.project);if(!['codex','claude'].includes(b.provider))throw fail('Motor desconocido.');const c={id:crypto.randomUUID(),project:b.project,provider:b.provider,title:'Nueva conversación',createdAt:new Date().toISOString(),nativeId:null,state:'idle',activity:'',error:null,messages:[]};saveChat(c);json(res,201,c);return true;}
    if(parts[0]==='chats'&&parts[1]){const c=loadChat(parts[1]);
      if(req.method==='GET'&&parts.length===2){json(res,200,c);return true;}
      if(req.method==='POST'&&parts[2]==='messages'){const b=await readBody(req);const words=String(b.text||'').trim();if(!words||words.length>12000)throw fail('El mensaje debe tener entre 1 y 12000 caracteres.');json(res,202,send(c,words));return true;}
      if(req.method==='POST'&&parts[2]==='stop'){const j=jobs.get(c.id);if(j){j.chat.state='cancelled';saveChat(j.chat);j.proc.kill();}json(res,200,{requested:!!j});return true;}
    }
    return false;
  }
  return {route,listProjects,shutdown(){for(const j of jobs.values())j.proc.kill();}};
}
module.exports={createWorkspaces,safeFile,tree,consumeEvent};
