const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const os=require('os');const {createWorkspaces,safeFile,consumeEvent}=require('./lab-workspaces');
function setup(t){const base=fs.mkdtempSync(path.join(os.tmpdir(),'gc-lab-test-'));t.after(()=>{assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep+'gc-lab-test-'));fs.rmSync(base,{recursive:true,force:true});});const kb=path.join(base,'knowledge'),local=path.join(base,'local');fs.mkdirSync(kb);fs.mkdirSync(local);const service=createWorkspaces({root:base,kb,local,binaries:{codex:null,claude:null},environment:()=>({}),instructions:()=>'',legacyProjects:()=>[],legacySessions:()=>[]});return{base,kb,local,service};}
async function route(service,method,url,body){let answer;await service.route({method},{},new URL(url,'http://localhost'),(res,status,value)=>{answer={status,value};},async()=>body);return answer;}
test('proyectos personales tienen archivos propios; no crea propuesta ni aprobación',async t=>{const {kb,service}=setup(t);const state=await route(service,'GET','/workspaces');assert.equal(state.value.projects[0].type,'personal');assert.ok(fs.existsSync(path.join(kb,'workspaces/personal/AGENTS.md')));const p=await route(service,'POST','/workspaces',{label:'Estrategia SPY',type:'strategy'});assert.equal(p.value.strategyName,'estrategia_spy');assert.ok(fs.existsSync(path.join(kb,'strategies/estrategia_spy/README.md')));assert.equal(fs.existsSync(path.join(kb,'strategies/estrategia_spy/approval.json')),false);await assert.rejects(()=>route(service,'POST','/workspaces',{label:'Estrategia SPY',type:'strategy'}));});
test('Files limita lectura al proyecto y excluye archivos secretos',async t=>{const {kb,service}=setup(t);const dir=path.join(kb,'workspaces/personal');fs.writeFileSync(path.join(kb,'outside.md'),'otro proyecto');fs.writeFileSync(path.join(dir,'.env'),'secreto de test');assert.throws(()=>safeFile(dir,'../../outside.md'));assert.throws(()=>safeFile(dir,'.env'));const files=await route(service,'GET','/workspaces/personal/files');assert.ok(files.value.tree.some(f=>f.name==='AGENTS.md'));assert.equal(files.value.tree.some(f=>f.name==='.env'),false);const content=await route(service,'GET','/workspaces/personal/files?path=README.md');assert.match(content.value.text,/Personal/);});
test('historial local separado por proyecto; motor ausente no inventa respuesta',async t=>{const {service}=setup(t);const p=await route(service,'POST','/workspaces',{label:'Análisis',type:'analysis'});const a=await route(service,'POST','/chats',{project:'personal',provider:'codex'}),b=await route(service,'POST','/chats',{project:p.value.id,provider:'claude'});assert.notEqual(a.value.id,b.value.id);await assert.rejects(()=>route(service,'POST','/chats/'+a.value.id+'/messages',{text:'hola'}),/no está instalado/);const loaded=await route(service,'GET','/chats/'+a.value.id);assert.deepEqual(loaded.value.messages,[]);const state=await route(service,'GET','/workspaces');assert.equal(state.value.chats.length,2);assert.equal('messages' in state.value.chats[0],false);});
test('eventos reales de CLI preservan identidad y texto; no muestran razonamiento ni salida de herramientas',()=>{const c={messages:[]};consumeEvent(c,{type:'thread.started',thread_id:'id'},'codex');consumeEvent(c,{type:'item.completed',item:{type:'reasoning',text:'interno'}},'codex');consumeEvent(c,{type:'item.completed',item:{type:'command_execution',aggregated_output:'salida'}},'codex');consumeEvent(c,{type:'item.completed',item:{type:'agent_message',text:'Respuesta'}},'codex');assert.equal(c.nativeId,'id');assert.equal(c.messages.length,1);assert.equal(c.messages[0].text,'Respuesta');consumeEvent(c,{type:'assistant',session_id:'claude-id',message:{content:[{type:'thinking',thinking:'interno'},{type:'text',text:'Otra respuesta'}]}},'claude');consumeEvent(c,{type:'result',is_error:false,result:'Otra respuesta'},'claude');assert.equal(c.nativeId,'claude-id');assert.equal(c.messages.length,2);consumeEvent(c,{type:'result',permission_denials:[{tool_name:'Bash'}]},'claude');assert.match(c.error,/necesita permiso/);});

test('la vista de cartera no expone archivos personales por path normalizado',async t=>{const {kb,local}=setup(t);const service=createWorkspaces({root:kb,kb,local,binaries:{},environment:()=>({}),instructions:()=>'',legacyProjects:()=>[{id:'portfolio',label:'Cartera',dir:kb,relative:'.'}],legacySessions:()=>[]});const files=await route(service,'GET','/workspaces/portfolio/files');assert.equal(files.value.tree.some(f=>f.name==='workspaces'),false);await assert.rejects(()=>route(service,'GET','/workspaces/portfolio/files?path=workspaces%2Fpersonal%2FREADME.md'),/proyecto personal/);await assert.rejects(()=>route(service,'GET','/workspaces/portfolio/files?path=.%2Fworkspaces%2Fpersonal%2FREADME.md'));});

test('workspace se recupera desde su descriptor versionable aunque falte el índice local',async t=>{const {kb,local}=setup(t);fs.unlinkSync(path.join(local,'lab-projects.json'));const service=createWorkspaces({root:kb,kb,local,binaries:{},environment:()=>({}),instructions:()=>'',legacyProjects:()=>[],legacySessions:()=>[]});const state=await route(service,'GET','/workspaces');assert.equal(state.value.projects[0].id,'personal');assert.equal(state.value.projects[0].type,'personal');});

test('claude: la narración junto a una consulta no entra al chat; la respuesta sí',()=>{const chat={messages:[]};consumeEvent(chat,{type:'assistant',message:{content:[{type:'text',text:'Now try the CLI'},{type:'tool_use',name:'Bash'}]}},'claude');assert.equal(chat.messages.length,0);assert.equal(chat.activity,'Trabajando');consumeEvent(chat,{type:'assistant',message:{content:[{type:'text',text:'Mi recomendación: esperá.'}]}},'claude');assert.equal(chat.messages.length,0);consumeEvent(chat,{type:'result',is_error:false,result:'Mi recomendación: esperá.'},'claude');assert.deepEqual(chat.messages.map(m=>m.text),['Mi recomendación: esperá.']);});

test('adjuntos y modo Auto: sube a adjuntos/, rechaza rutas ajenas y pasa el permiso al motor',async t=>{
 const {base,kb,local}=setup(t);const calls=[];const {EventEmitter}=require('events');
 fs.mkdirSync(path.join(base,'GaleCore-AI'));fs.writeFileSync(path.join(base,'GaleCore-AI','PRODUCT.md'),'núcleo de test');
 // El contexto va por archivo (D-0014): se lee al lanzar el motor, porque se borra al terminar el turno.
 const codexHome=path.join(base,'codex');fs.mkdirSync(codexHome);const contexts=[];
 const spawnProcess=(bin,args)=>{calls.push(args);const f=args.includes('-p')&&bin==='codex'?path.join(codexHome,args[args.indexOf('-p')+1]+'.config.toml'):args[args.indexOf('--append-system-prompt-file')+1];contexts.push(fs.readFileSync(f,'utf8'));const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin={end(){}};proc.kill=()=>{};setImmediate(()=>proc.emit('close',0));return proc;};
 const service=createWorkspaces({root:path.dirname(kb),kb,local,binaries:{claude:'claude',codex:'codex'},environment:()=>({CODEX_HOME:codexHome}),legacyProjects:()=>[],legacySessions:()=>[],spawnProcess});
 const req=Object.assign(new EventEmitter(),{method:'POST',headers:{'x-file-name':encodeURIComponent('nota ñ.txt')}});
 let up;const pending=service.route(req,{},new URL('http://localhost/workspaces/personal/attachments'),(res,status,value)=>{up={status,value};},async()=>({}));
 setImmediate(()=>{req.emit('data',Buffer.from('hola'));req.emit('end');});await pending;
 assert.equal(up.status,201);assert.match(up.value.path,/^adjuntos\/\d+-nota _\.txt$/);
 assert.equal(fs.readFileSync(path.join(kb,'workspaces/personal',up.value.path),'utf8'),'hola');
 const chat=(await route(service,'POST','/chats',{project:'personal',provider:'claude'})).value;
 await assert.rejects(route(service,'POST','/chats/'+chat.id+'/messages',{text:'mirá',attachments:['../secreto.txt']}),/Adjunto no encontrado/);
 await route(service,'POST','/chats/'+chat.id+'/messages',{text:'mirá esto',attachments:[up.value.path],mode:'auto'});
 const args=calls.at(-1);assert.deepEqual(args.slice(args.indexOf('--permission-mode'),args.indexOf('--permission-mode')+2),['--permission-mode','auto']);assert.ok(!args.includes('--permission-prompts'));
 // WS-0037: Personal también lleva el núcleo del producto, con Claude y con Codex.
 assert.match(contexts.at(-1),/núcleo de test/);
 await new Promise(r=>setTimeout(r,50));
 const cx=(await route(service,'POST','/chats',{project:'personal',provider:'codex'})).value;
 await route(service,'POST','/chats/'+cx.id+'/messages',{text:'hola'});
 const cargs=calls.at(-1);assert.ok(cargs.includes('web_search="live"'));assert.ok(cargs.includes('browser_use'));
 // D-0014: el mismo contexto para los dos motores; nada del contexto en la línea de comando.
 const sameMap=t=>t.replace(/mapa-[0-9a-f]{8}\.md/g,'mapa-<chat>.md');  // la ruta del mapa es de cada conversación
 assert.equal(sameMap(contexts.at(-1)),'developer_instructions = '+JSON.stringify(sameMap(contexts.at(-2)))+'\n');
 assert.ok(!cargs.some(a=>a.includes('núcleo de test')));
 await new Promise(r=>setTimeout(r,50));
 assert.deepEqual(fs.readdirSync(codexHome),[]);  // el perfil del turno se borra al terminar
});
test('mapa de la idea: el Lab anota la página que tocó el turno y la sirve por secciones (WS-0039)',async t=>{
 const {base,kb,local}=setup(t);const {EventEmitter}=require('events');
 fs.mkdirSync(path.join(base,'GaleCore-AI'));fs.writeFileSync(path.join(base,'GaleCore-AI','PRODUCT.md'),'núcleo');
 const mem=path.join(kb,'workspaces/personal/memory');
 fs.mkdirSync(mem,{recursive:true});fs.writeFileSync(path.join(mem,'mapa-vieja.md'),'# Vieja\n## Idea\nno\n');
 const old=new Date(Date.now()-60000);fs.utimesSync(path.join(mem,'mapa-vieja.md'),old,old);
 let write=true;
 const spawnProcess=()=>{const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin={end(){}};proc.kill=()=>{};
  setImmediate(()=>{if(write)fs.writeFileSync(path.join(mem,'mapa-apple-earnings.md'),'# Earnings de Apple\n\n## Idea\nVender prima en el balance\n## Con qué datos\n- ✓ Balance 02/11\n- ✗ Comisiones\n');proc.emit('close',0);});return proc;};
 const service=createWorkspaces({root:base,kb,local,binaries:{claude:'claude'},environment:()=>({}),legacyProjects:()=>[],legacySessions:()=>[],spawnProcess});
 const chat=(await route(service,'POST','/chats',{project:'personal',provider:'claude'})).value;
 assert.deepEqual((await route(service,'GET','/chats/'+chat.id+'/mapa')).value,{mapa:null});
 await route(service,'POST','/chats/'+chat.id+'/messages',{text:'estrategia de earnings de Apple'});
 await new Promise(r=>setTimeout(r,300));
 const m=(await route(service,'GET','/chats/'+chat.id+'/mapa')).value.mapa;
 assert.equal(m.path,'memory/mapa-apple-earnings.md');assert.equal(m.title,'Earnings de Apple');
 assert.deepEqual(m.sections.map(s=>s.heading),['Idea','Con qué datos']);
 assert.deepEqual(m.sections[1].lines,[{mark:'ok',text:'Balance 02/11'},{mark:'missing',text:'Comisiones'}]);
 // Un turno que no toca el mapa conserva el último (la página vieja de otra idea no lo reemplaza).
 write=false;await route(service,'POST','/chats/'+chat.id+'/messages',{text:'gracias'});await new Promise(r=>setTimeout(r,300));
 assert.equal((await route(service,'GET','/chats/'+chat.id+'/mapa')).value.mapa.path,'memory/mapa-apple-earnings.md');
});
test('la actividad dice en palabras del trader qué está haciendo el motor (WS-0039)',()=>{
 const c={messages:[]};
 consumeEvent(c,{type:'assistant',message:{content:[{type:'text',text:'Now fetch'},{type:'tool_use',name:'Bash',input:{command:'python -B -m galecore_ai.adapters.cli galecore get market_data.option_chains --symbol AAPL --out .scratch/c.json'}}]}},'claude');
 assert.equal(c.activity,'Trayendo la cadena de opciones de AAPL');assert.equal(c.messages.length,0);
 consumeEvent(c,{type:'item.started',item:{type:'command_execution',command:'python -B -m galecore_ai.adapters.cli kb search --text AAPL'}},'codex');
 assert.equal(c.activity,'Buscando antecedentes');
 consumeEvent(c,{type:'assistant',message:{content:[{type:'tool_use',name:'Write',input:{file_path:'C:/k/memory/mapa-ab12cd34.md'}}]}},'claude');
 assert.equal(c.activity,'Actualizando el mapa');
});
test('mapa: camino con el tramo actual y tabla de hipótesis (WS-0044)',()=>{
 const {parseMapa}=require('./lab-workspaces');
 const m=parseMapa('# VRP\n## Camino\n- ✓ Idea\n- → Evidencia: falta H2\n- Operar o no\n## Hipótesis\n| | Qué dice | Estado |\n|---|---|---|\n| H1 | La implícita supera a la realizada | Se sostiene |\n');
 assert.deepEqual(m.sections[0].lines.map(l=>l.mark),['ok','now',null]);
 assert.deepEqual(m.sections[1].table,{header:['','Qué dice','Estado'],rows:[['H1','La implícita supera a la realizada','Se sostiene']]});
 assert.deepEqual(m.sections[1].lines,[]);
});
