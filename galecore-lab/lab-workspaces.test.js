const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const os=require('os');const {createWorkspaces,safeFile,consumeEvent,codexLimits}=require('./lab-workspaces');
function setup(t){const base=fs.mkdtempSync(path.join(os.tmpdir(),'gc-lab-test-'));t.after(()=>{assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep+'gc-lab-test-'));fs.rmSync(base,{recursive:true,force:true});});const kb=path.join(base,'knowledge'),local=path.join(base,'local');fs.mkdirSync(kb);fs.mkdirSync(local);const service=createWorkspaces({root:base,kb,local,binaries:{codex:null,claude:null},environment:()=>({}),instructions:()=>'',legacyProjects:()=>[],legacySessions:()=>[]});return{base,kb,local,service};}
async function route(service,method,url,body){let answer;await service.route({method},{},new URL(url,'http://localhost'),(res,status,value)=>{answer={status,value};},async()=>body);return answer;}

test('Archivos decodifica texto UTF-8 y UTF-16 de PowerShell sin BOM ni nulos',async t=>{
 const {kb,service}=setup(t);await route(service,'GET','/workspaces');
 const text=JSON.stringify({titulo:'Datos de GaleCore al 30/10',dato:'Variación −12,64 %'});
 const dir=path.join(kb,'workspaces/personal');
 for(const [name,bytes] of [['utf8.json',Buffer.from(text,'utf8')],['bom.json',Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(text,'utf8')])],['powershell.json',Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(text,'utf16le')])]]){
  fs.writeFileSync(path.join(dir,name),bytes);
  const response=await route(service,'GET','/workspaces/personal/files?path='+name);
  assert.equal(response.status,200);assert.equal(response.value.text,text);assert.equal(response.value.text.includes('\u0000'),false);
 }
});
test('proyectos personales tienen archivos propios; no crea propuesta ni aprobación',async t=>{const {kb,service}=setup(t);const state=await route(service,'GET','/workspaces');assert.equal(state.value.projects[0].type,undefined);assert.ok(fs.existsSync(path.join(kb,'workspaces/personal/AGENTS.md')));const p=await route(service,'POST','/workspaces',{label:'Estrategia SPY',type:'strategy'});assert.ok(p.value.strategies.includes('estrategia_spy'));assert.ok(fs.existsSync(path.join(kb,'strategies/estrategia_spy/README.md')));assert.equal(fs.existsSync(path.join(kb,'strategies/estrategia_spy/approval.json')),false);await assert.rejects(()=>route(service,'POST','/workspaces',{label:'Estrategia SPY',type:'strategy'}));});
test('Files limita lectura al proyecto y excluye archivos secretos',async t=>{const {kb,service}=setup(t);const dir=path.join(kb,'workspaces/personal');fs.writeFileSync(path.join(kb,'outside.md'),'otro proyecto');fs.writeFileSync(path.join(dir,'.env'),'secreto de test');assert.throws(()=>safeFile(dir,'../../outside.md'));assert.throws(()=>safeFile(dir,'.env'));const files=await route(service,'GET','/workspaces/personal/files');assert.ok(files.value.tree.some(f=>f.name==='AGENTS.md'));assert.equal(files.value.tree.some(f=>f.name==='.env'),false);const content=await route(service,'GET','/workspaces/personal/files?path=README.md');assert.match(content.value.text,/Personal/);});
test('historial local separado por proyecto; motor ausente no inventa respuesta',async t=>{const {service}=setup(t);const p=await route(service,'POST','/workspaces',{label:'Análisis',type:'analysis'});const a=await route(service,'POST','/chats',{project:'personal',provider:'codex'}),b=await route(service,'POST','/chats',{project:p.value.id,provider:'claude'});assert.notEqual(a.value.id,b.value.id);await assert.rejects(()=>route(service,'POST','/chats/'+a.value.id+'/messages',{text:'hola'}),/no está instalado/);const loaded=await route(service,'GET','/chats/'+a.value.id);assert.deepEqual(loaded.value.messages,[]);const state=await route(service,'GET','/workspaces');assert.equal(state.value.chats.length,2);assert.equal('messages' in state.value.chats[0],false);});
test('eventos reales de CLI preservan identidad y texto; no muestran razonamiento ni salida de herramientas',()=>{const c={messages:[]};consumeEvent(c,{type:'thread.started',thread_id:'id'},'codex');consumeEvent(c,{type:'item.completed',item:{type:'reasoning',text:'interno'}},'codex');consumeEvent(c,{type:'item.completed',item:{type:'command_execution',aggregated_output:'salida'}},'codex');consumeEvent(c,{type:'item.completed',item:{type:'agent_message',text:'Respuesta'}},'codex');assert.equal(c.nativeId,'id');assert.equal(c.messages.length,1);assert.equal(c.messages[0].text,'Respuesta');consumeEvent(c,{type:'assistant',session_id:'claude-id',message:{content:[{type:'thinking',thinking:'interno'},{type:'text',text:'Otra respuesta'}]}},'claude');consumeEvent(c,{type:'result',is_error:false,result:'Otra respuesta'},'claude');assert.equal(c.nativeId,'claude-id');assert.equal(c.messages.length,2);consumeEvent(c,{type:'result',permission_denials:[{tool_name:'Bash',tool_use_id:'t1',tool_input:{command:'mkdir -p .scratch'}}]},'claude');assert.ok(!c.error);assert.match(c.notice,/sin hacer porque el Lab no lo permite \(«mkdir -p \.scratch»\); siguió/);c.notice=null;c.refused=['t2'];consumeEvent(c,{type:'result',permission_denials:[{tool_name:'Write',tool_use_id:'t2'}]},'claude');assert.ok(!c.error);assert.ok(!c.notice);consumeEvent(c,{type:'rate_limit_event',rate_limit_info:{status:'rejected',resetsAt:Math.floor(Date.now()/1000)+3600}},'claude');consumeEvent(c,{type:'result',is_error:true,result:"You've hit your session limit"},'claude');assert.match(c.error,/límite de uso de Claude\. Vuelve (a las|el)/);const d={messages:[]};consumeEvent(d,{type:'result',is_error:true,result:"You've hit your session limit · resets 3pm"},'claude');assert.match(d.error,/límite de uso/);});

test('Cartera tiene su carpeta, ve sólo sus archivos y no se elimina',async t=>{const {kb,local}=setup(t);const dir=path.join(kb,'workspaces/portfolio');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'README.md'),'cartera');const service=createWorkspaces({root:kb,kb,local,binaries:{},environment:()=>({}),instructions:()=>'',legacyProjects:()=>[{id:'portfolio',label:'Cartera',dir,relative:'workspaces/portfolio'}],legacySessions:()=>[]});const files=await route(service,'GET','/workspaces/portfolio/files');assert.equal(files.value.folder,'workspaces/portfolio');assert.ok(files.value.tree.some(f=>f.name==='README.md'));assert.equal(files.value.tree.some(f=>f.name==='personal'),false);await assert.rejects(()=>route(service,'GET','/workspaces/portfolio/files?path=..%2Fpersonal%2FREADME.md'));await assert.rejects(()=>route(service,'POST','/workspaces/portfolio/archive'),/Cartera no se elimina/);});

test('workspace se recupera desde su descriptor versionable aunque falte el índice local',async t=>{const {kb,local}=setup(t);fs.unlinkSync(path.join(local,'lab-projects.json'));const service=createWorkspaces({root:kb,kb,local,binaries:{},environment:()=>({}),instructions:()=>'',legacyProjects:()=>[],legacySessions:()=>[]});const state=await route(service,'GET','/workspaces');assert.equal(state.value.projects[0].id,'personal');assert.equal(state.value.projects[0].type,undefined);});

test('claude: la narración junto a una consulta no entra al chat; la respuesta sí',()=>{const chat={messages:[]};consumeEvent(chat,{type:'assistant',message:{content:[{type:'text',text:'Now try the CLI'},{type:'tool_use',name:'Bash'}]}},'claude');assert.equal(chat.messages.length,0);assert.equal(chat.activity,'Trabajando');consumeEvent(chat,{type:'assistant',message:{content:[{type:'text',text:'Mi recomendación: esperá.'}]}},'claude');assert.equal(chat.messages.length,0);consumeEvent(chat,{type:'result',is_error:false,result:'Mi recomendación: esperá.'},'claude');assert.deepEqual(chat.messages.map(m=>m.text),['Mi recomendación: esperá.']);});

test('adjuntos y modo Auto: sube a adjuntos/, rechaza rutas ajenas y pasa el permiso al motor',async t=>{
 const {base,kb,local}=setup(t);const calls=[];let hold=false;const inputs=[];const {EventEmitter}=require('events');
 fs.mkdirSync(path.join(base,'galecore-ai'));fs.writeFileSync(path.join(base,'galecore-ai','PRODUCT.md'),'núcleo de test');
 // El contexto va por archivo (D-0014): se lee al lanzar el motor, porque se borra al terminar el turno.
 const codexHome=path.join(base,'codex');fs.mkdirSync(codexHome);const contexts=[];
 const spawnProcess=(bin,args)=>{calls.push(args);const f=args.includes('-p')&&bin==='codex'?path.join(codexHome,args[args.indexOf('-p')+1]+'.config.toml'):args[args.indexOf('--append-system-prompt-file')+1];contexts.push(fs.readFileSync(f,'utf8'));const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin={write(value){inputs.push(value);},end(value){if(value)inputs.push(value);}};proc.kill=()=>{};setImmediate(()=>proc.emit('close',0));return proc;};
 const service=createWorkspaces({root:path.dirname(kb),kb,local,binaries:{claude:'claude',codex:'codex'},environment:()=>({CODEX_HOME:codexHome}),legacyProjects:()=>[],legacySessions:()=>[],spawnProcess});
 const req=Object.assign(new EventEmitter(),{method:'POST',headers:{'x-file-name':encodeURIComponent('nota ñ.txt')}});
 let up;const pending=service.route(req,{},new URL('http://localhost/workspaces/personal/attachments'),(res,status,value)=>{up={status,value};},async()=>({}));
 setImmediate(()=>{req.emit('data',Buffer.from('hola'));req.emit('end');});await pending;
 assert.equal(up.status,201);assert.match(up.value.path,/^adjuntos\/\d+-nota _\.txt$/);
 assert.equal(fs.readFileSync(path.join(kb,'workspaces/personal',up.value.path),'utf8'),'hola');
 const binaryRes={writeHead(status,headers){this.status=status;this.headers=headers;},end(value){this.bytes=value;}};
 await service.route({method:'GET'},binaryRes,new URL('http://localhost/workspaces/personal/attachments?path='+encodeURIComponent(up.value.path)),()=>{},async()=>({}));
 assert.equal(binaryRes.status,200);assert.equal(binaryRes.bytes.toString(),'hola');
 assert.equal(binaryRes.headers['Content-Disposition'].startsWith('attachment'),true);
 await assert.rejects(route(service,'GET','/workspaces/personal/attachments?path=../secreto.txt'),/Adjunto no encontrado/);
 await assert.rejects(route(service,'GET','/workspaces/personal/attachments?path=adjuntos/ausente.png'),/Adjunto no encontrado/);
 const png='adjuntos/1-captura.png';fs.writeFileSync(path.join(kb,'workspaces/personal',png),Buffer.from([137,80,78,71]));
 await service.route({method:'GET'},binaryRes,new URL('http://localhost/workspaces/personal/attachments?path='+png),()=>{},async()=>({}));
 assert.equal(binaryRes.headers['Content-Type'],'image/png');assert.deepEqual(binaryRes.bytes,Buffer.from([137,80,78,71]));

 const chat=(await route(service,'POST','/chats',{project:'personal',provider:'claude'})).value;
 await assert.rejects(route(service,'POST','/chats/'+chat.id+'/messages',{text:'mirá',attachments:['../secreto.txt']}),/Adjunto no encontrado/);
 await route(service,'POST','/chats/'+chat.id+'/messages',{text:'mirá esto',attachments:[up.value.path],mode:'auto'});
 const args=calls.at(-1);assert.deepEqual(args.slice(args.indexOf('--permission-mode'),args.indexOf('--permission-mode')+2),['--permission-mode','auto']);assert.deepEqual(args.slice(args.indexOf('--permission-prompt-tool'),args.indexOf('--permission-prompt-tool')+2),['--permission-prompt-tool','stdio']);assert.ok(!args.includes('--permission-prompts'));
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
 // Codex 0.164 rechaza --approve-for-me junto con --sandbox: en Manual va el sandbox; en Auto, sólo --approve-for-me.
 assert.ok(cargs.includes('--sandbox')&&!cargs.includes('--approve-for-me'));
 await new Promise(r=>setTimeout(r,50));
 const ca=(await route(service,'POST','/chats',{project:'personal',provider:'codex'})).value;
 await route(service,'POST','/chats/'+ca.id+'/messages',{text:'hola',mode:'auto'});
 const aargs=calls.at(-1);assert.ok(aargs.includes('--approve-for-me')&&!aargs.includes('--sandbox'));
 await new Promise(r=>setTimeout(r,50));

 const imageChat=(await route(service,'POST','/chats',{project:'personal',provider:'claude'})).value;
 await route(service,'POST','/chats/'+imageChat.id+'/messages',{text:'',attachments:[png]});
 await new Promise(r=>setTimeout(r,50));
 const restarted=createWorkspaces({root:base,kb,local,binaries:{},environment:()=>({}),legacyProjects:()=>[],legacySessions:()=>[]});
 const saved=(await route(restarted,'GET','/chats/'+imageChat.id)).value;
 assert.equal(saved.messages[0].text,'');assert.deepEqual(saved.messages[0].attachments,[png]);assert.equal(saved.title,'captura.png');
 assert.ok(inputs.some(value=>value.includes(png)));
 assert.deepEqual(fs.readdirSync(codexHome),[]);  // el perfil del turno se borra al terminar
});
test('mapa de la idea: el Lab anota la página que tocó el turno y la sirve por secciones (WS-0039)',async t=>{
 const {base,kb,local}=setup(t);const {EventEmitter}=require('events');
 fs.mkdirSync(path.join(base,'galecore-ai'));fs.writeFileSync(path.join(base,'galecore-ai','PRODUCT.md'),'núcleo');
 const mem=path.join(kb,'workspaces/personal/memory');
 fs.mkdirSync(mem,{recursive:true});fs.writeFileSync(path.join(mem,'mapa-vieja.md'),'# Vieja\n## Idea\nno\n');
 const old=new Date(Date.now()-60000);fs.utimesSync(path.join(mem,'mapa-vieja.md'),old,old);
 let write=true;
 const spawnProcess=()=>{const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin={write(){},end(){}};proc.kill=()=>{};
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
test('mapa como tablero: dónde estamos, números y gráfico con su fuente (WS-0044)',()=>{
 const {parseMapa}=require('./lab-workspaces');
 const m=parseMapa('# VRP\nEstamos: probando si se cobra\nFalta: 30 operaciones\n## Números\n- 84 % · días con prima\n## Implícita vs realizada\n```grafico\n{"fuente":"GaleCore","series":[{"nombre":"VIX","puntos":[["2020-01-31",14.1]]}]}\n```\n## Roto\n```grafico\n{no\n```\n');
 assert.deepEqual(m.intro,['Estamos: probando si se cobra','Falta: 30 operaciones']);
 assert.deepEqual(m.sections[0].lines,[{mark:null,text:'84 % · días con prima'}]);
 assert.equal(m.sections[1].chart.fuente,'GaleCore');assert.deepEqual(m.sections[1].lines,[]);
 assert.equal(m.sections[2].chart,undefined);
});
test('proyecto de estrategia: una conversación nueva ve el último mapa del proyecto (WS-0044)',async t=>{
 const {kb,service}=setup(t);const p=(await route(service,'POST','/workspaces',{label:'VRP',type:'strategy'})).value;
 const mem=path.join(kb,'strategies',p.strategies[0],'memory');fs.mkdirSync(mem,{recursive:true});fs.writeFileSync(path.join(mem,'mapa-vrp.md'),'# VRP\nEstamos: midiendo\n');
 const chat=(await route(service,'POST','/chats',{project:p.id,provider:'claude'})).value;
 const m=(await route(service,'GET','/chats/'+chat.id+'/mapa')).value.mapa;
 assert.equal(m.path,'memory/mapa-vrp.md');assert.deepEqual(m.intro,['Estamos: midiendo']);
 const personal=(await route(service,'POST','/chats',{project:'personal',provider:'claude'})).value;
 assert.equal((await route(service,'GET','/chats/'+personal.id+'/mapa')).value.mapa,null);
});
test('Archivos como explorador: crea, edita, renombra y borra dentro del proyecto; los JSON no se tocan (owner 17/10)',async t=>{
 const {kb,service}=setup(t);const dir=path.join(kb,'workspaces/personal');
 await route(service,'POST','/workspaces/personal/files/mkdir',{path:'notas'});
 await route(service,'POST','/workspaces/personal/files/write',{path:'notas/idea.md',text:'hola',create:true});
 await assert.rejects(route(service,'POST','/workspaces/personal/files/write',{path:'notas/idea.md',text:'x',create:true}),/Ya existe/);
 await route(service,'POST','/workspaces/personal/files/write',{path:'notas/idea.md',text:'chau'});
 assert.equal(fs.readFileSync(path.join(dir,'notas/idea.md'),'utf8'),'chau');
 await route(service,'POST','/workspaces/personal/files/rename',{from:'notas/idea.md',to:'notas/tesis.md'});
 assert.ok(fs.existsSync(path.join(dir,'notas/tesis.md')));
 await assert.rejects(route(service,'POST','/workspaces/personal/files/write',{path:'../afuera.md',text:'x',create:true}),/no válida|fuera/);
 await assert.rejects(route(service,'POST','/workspaces/personal/files/write',{path:'workspace.json',text:'{}'}),/harness/);
 await assert.rejects(route(service,'POST','/workspaces/personal/files/delete',{path:'workspace.json'}),/harness/);
 await route(service,'POST','/workspaces/personal/files/delete',{path:'notas'});
 assert.equal(fs.existsSync(path.join(dir,'notas')),false);
});
test('proyectos y conversaciones: renombrar, eliminar y ocultar las de prueba',async t=>{
 const {kb,service}=setup(t);const p=(await route(service,'POST','/workspaces',{label:'Idea',type:'analysis'})).value;
 await route(service,'POST','/workspaces/'+p.id+'/rename',{label:'Idea nueva'});
 let state=(await route(service,'GET','/workspaces')).value;assert.equal(state.projects.find(x=>x.id===p.id).label,'Idea nueva');
 const a=(await route(service,'POST','/chats',{project:p.id,provider:'claude'})).value;
 await route(service,'POST','/chats',{project:p.id,provider:'claude',origin:'prueba'});
 await route(service,'POST','/chats/'+a.id+'/rename',{title:'Mi charla'});
 state=(await route(service,'GET','/workspaces')).value;assert.deepEqual(state.chats.map(c=>c.title),['Mi charla']);
 await route(service,'POST','/chats/'+a.id+'/delete',{});
 state=(await route(service,'GET','/workspaces')).value;assert.equal(state.chats.length,0);
 await assert.rejects(route(service,'POST','/workspaces/personal/archive',{}),/no se elimina/);
 fs.mkdirSync(path.join(kb,'followups',p.id),{recursive:true});fs.writeFileSync(path.join(kb,'followups',p.id,'a.json'),'{}');
 fs.mkdirSync(path.join(kb,'research'),{recursive:true});fs.writeFileSync(path.join(kb,'research','2026-10-26-'+p.id+'.md'),'x');fs.writeFileSync(path.join(kb,'research','otra.md'),'x');
 const b=(await route(service,'POST','/chats',{project:p.id,provider:'claude'})).value;
 const r=await route(service,'POST','/workspaces/'+p.id+'/archive',{});assert.equal(r.value.deleted,true);
 state=(await route(service,'GET','/workspaces')).value;assert.equal(state.projects.some(x=>x.id===p.id),false);
 assert.equal(fs.existsSync(path.join(kb,'workspaces',p.id)),false);  // WS-0063: se borra de verdad con lo que cuelga
 assert.equal(fs.existsSync(path.join(kb,'followups',p.id)),false);assert.equal(fs.existsSync(path.join(kb,'research','2026-10-26-'+p.id+'.md')),false);assert.ok(fs.existsSync(path.join(kb,'research','otra.md')));
 assert.equal(state.chats.some(c=>c.id===b.id),false);
});
test('mapa como diseño: secciones con tablas de reglas y datos, gráfico en Evidencia (owner 17/10)',()=>{
 const {parseMapa}=require('./lab-workspaces');
 const m=parseMapa('# Prima SPY\n## Hipótesis\nLa implícita supera a la realizada.\n## Entrada\n| Concepto | Condición | Umbral | Acción |\n|---|---|---|---|\n| VIX menos realizada | > | 2 puntos | Abrir |\n## Salida\n## Evidencia\n- 83 % · días con VIX arriba\n```grafico\n{"series":[{"nombre":"x","puntos":[["2026-01-01",1]]}]}\n```\n');
 assert.equal(m.title,'Prima SPY');assert.deepEqual(m.sections.map(s=>s.heading),['Hipótesis','Entrada','Salida','Evidencia']);
 assert.deepEqual(m.sections[1].table,{head:['Concepto','Condición','Umbral','Acción'],rows:[['VIX menos realizada','>','2 puntos','Abrir']]});
 assert.equal(m.sections[2].lines.length,0);assert.ok(m.sections[3].chart);assert.equal(m.sections[3].lines[0].text,'83 % · días con VIX arriba');
});
test('pasos como Claude Code: cada herramienta con su detalle y la narración entre medio; leer el mapa no es actualizarlo (owner 19/10)',()=>{const chat={messages:[]};consumeEvent(chat,{type:'assistant',message:{content:[{type:'text',text:'Primero miro el mapa.'},{type:'tool_use',name:'Read',input:{file_path:'C:\\kb\\memory\\mapa-vrp.md'}}]}},'claude');consumeEvent(chat,{type:'assistant',message:{content:[{type:'tool_use',name:'Bash',input:{command:'cd "C:/kb" && python -B -m galecore_ai.adapters.cli galecore get market.gex_analysis --symbol SPY 2>&1'}}]}},'claude');consumeEvent(chat,{type:'assistant',message:{content:[{type:'tool_use',name:'Bash',input:{command:'echo hola'}}]}},'claude');assert.deepEqual(chat.steps.map(s=>[s.label,s.detail]),[['Primero miro el mapa.',''],['Leyendo el mapa','memory/mapa-vrp.md'],['Trayendo el GEX de SPY','galecore-ai galecore get market.gex_analysis --symbol SPY 2>&1'],['Trabajando','echo hola']]);assert.equal(chat.steps[0].kind,'note');assert.equal(chat.messages.length,0);});
test('proyecto sin tipo: se crea sólo con nombre y pasa a estrategia cuando el trader dice sí (owner 19/10)',async t=>{const {kb,service}=setup(t);const p=(await route(service,'POST','/workspaces',{label:'Idea QQQ'})).value;assert.equal(p.type,undefined);assert.equal(p.strategyName,undefined);const dir=path.join(kb,'workspaces','idea_qqq');const out=require('child_process').execFileSync('python',[path.join(__dirname,'mark_strategy.py')],{cwd:dir,encoding:'utf8'});assert.equal(JSON.parse(out).ok,true);const again=(await route(service,'GET','/workspaces')).value.projects.find(x=>x.id==='idea_qqq');assert.equal(again.type,undefined);assert.ok(again.strategies.includes('idea_qqq'));assert.equal(again.relative,'workspaces/idea_qqq');assert.equal(fs.existsSync(path.join(kb,'strategies','idea_qqq')),false);});
test('codex: la narración intermedia pasa a los pasos; en el chat queda sólo la respuesta del turno (owner 19/10)',()=>{const chat={messages:[{id:'a',role:'assistant',text:'Respuesta de antes',turn:1}],turnStartedAt:2};for(const text of ['Voy a comparar las cinco.','MSFT es la candidata.','**MSFT es la mejor candidata.**'])consumeEvent(chat,{type:'item.completed',item:{type:'agent_message',text}},'codex');assert.deepEqual(chat.messages.map(m=>m.text),['Respuesta de antes','**MSFT es la mejor candidata.**']);assert.deepEqual(chat.steps.map(s=>s.label),['Voy a comparar las cinco.','MSFT es la candidata.']);});
test('el detalle de un paso no guarda secretos (revisión 19/10)',()=>{const c={messages:[]};consumeEvent(c,{type:'assistant',message:{content:[{type:'tool_use',name:'Bash',input:{command:'curl -H "Authorization: Bearer abc123" http://x?token=zzz'}}]}},'claude');assert.doesNotMatch(c.steps[0].detail,/abc123|zzz/);});

test('varias conversaciones a la vez: el mismo proyecto y Cartera no se bloquean; el tope global y la propia conversación sí (WS-0057 J)',async t=>{
 const {base,kb,local}=setup(t);const {EventEmitter}=require('events');const procs=[];
 fs.mkdirSync(path.join(base,'galecore-ai'));fs.writeFileSync(path.join(base,'galecore-ai','PRODUCT.md'),'núcleo de test');
 const spawnProcess=()=>{const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin={write(){},end(){}};proc.kill=()=>{};procs.push(proc);return proc;};
 const service=createWorkspaces({root:path.dirname(kb),kb,local,binaries:{claude:'claude'},environment:()=>({}),legacyProjects:()=>[{id:'portfolio',label:'Cartera',dir:kb,relative:'.'}],legacySessions:()=>[{id:'s',state:'running',project:'portfolio'}],spawnProcess});
 const mk=async project=>(await route(service,'POST','/chats',{project,provider:'claude'})).value;
 const [a,b,c,d,e]=[await mk('personal'),await mk('personal'),await mk('portfolio'),await mk('personal'),await mk('personal')];
 const say=ch=>route(service,'POST','/chats/'+ch.id+'/messages',{text:'hola'});
 await say(a);await say(b);await say(c);          // dos del mismo proyecto y una de Cartera, todas corriendo
 await assert.rejects(say(a),/está respondiendo/);   // la propia conversación sigue protegida
 await say(d);
 await assert.rejects(say(e),/cuatro conversaciones/); // tope global
 for(const p of procs)p.emit('close',0);
});

test('WS-0059: el contexto común conserva bloques útiles y avisa fallos sin copiar stderr',async t=>{
 const {base,kb,local}=setup(t);const {EventEmitter}=require('events');
 fs.mkdirSync(path.join(base,'galecore-ai'));fs.writeFileSync(path.join(base,'galecore-ai/PRODUCT.md'),'núcleo único');
 const dir=path.join(base,'galecore-lab/context');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'session_context.py'),"import sys\nprint('[reloj] fixture')\nprint('private-token', file=sys.stderr)\nsys.exit(1)\n");
 fs.writeFileSync(path.join(dir,'match_request.py'),"print('[method] fixture')\n");
 const contexts=[];
 const service=createWorkspaces({root:base,kb,local,binaries:{claude:'fixture'},environment:()=>({}),legacyProjects:()=>[],legacySessions:()=>[],spawnProcess:(_,args)=>{
  contexts.push(fs.readFileSync(args[args.indexOf('--append-system-prompt-file')+1],'utf8'));
  const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin={write(){},end(){}};proc.kill=()=>{};setImmediate(()=>proc.emit('close',0));return proc;
 }});
 const chat=(await route(service,'POST','/chats',{project:'personal',provider:'claude'})).value;
 const send=async()=>{
  await route(service,'POST','/chats/'+chat.id+'/messages',{text:'consulta fixture'});
  for(let i=0;i<100;i++){
   const c=(await route(service,'GET','/chats/'+chat.id)).value;
   if(c.state==='idle')return contexts.at(-1);
   await new Promise(r=>setTimeout(r,20));
  }
  assert.fail('no terminó el turno fixture');
 };
 const failed=await send();
 assert.match(failed,/\[reloj\] fixture/);assert.match(failed,/\[method\] fixture/);
 assert.match(failed,/\[hechos del momento\] contexto no disponible/);assert.doesNotMatch(failed,/private-token/);
 assert.equal(failed.split('núcleo único').length-1,1);
 fs.writeFileSync(path.join(dir,'session_context.py'),'');
 const empty=await send();assert.doesNotMatch(empty,/contexto no disponible/);assert.match(empty,/\[method\] fixture/);
 fs.unlinkSync(path.join(dir,'match_request.py'));
 const missing=await send();assert.match(missing,/\[capacidad del pedido\] contexto no disponible/);
});

test('permisos en el chat como en el CLI: el pedido queda a la vista, el trader responde y puede pasar a Auto en medio (owner 24/10)',async t=>{
 const {base,kb,local}=setup(t);const {EventEmitter}=require('events');let proc;const sent=[];
 fs.mkdirSync(path.join(base,'galecore-ai'));fs.writeFileSync(path.join(base,'galecore-ai','PRODUCT.md'),'núcleo de test');
 let engineArgs;
 const spawnProcess=(_,args)=>{engineArgs=args;proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin={write(l){sent.push(JSON.parse(l));},end(){this.writableEnded=true;}};proc.kill=()=>{};return proc;};
 const service=createWorkspaces({root:path.dirname(kb),kb,local,binaries:{claude:'claude'},environment:()=>({}),legacyProjects:()=>[],legacySessions:()=>[],spawnProcess});
 const chat=(await route(service,'POST','/chats',{project:'personal',provider:'claude'})).value;
 await route(service,'POST','/chats/'+chat.id+'/messages',{text:'guardá la investigación'});
 await new Promise(r=>setTimeout(r,300));
 assert.deepEqual(engineArgs.slice(engineArgs.indexOf('--permission-mode'),engineArgs.indexOf('--permission-mode')+2),['--permission-mode','default']);
 assert.deepEqual(engineArgs.slice(engineArgs.indexOf('--permission-prompt-tool'),engineArgs.indexOf('--permission-prompt-tool')+2),['--permission-prompt-tool','stdio']);
 assert.ok(!engineArgs.includes('bypassPermissions')&&!engineArgs.includes('--permission-prompts'));
 assert.equal(sent[0].request.subtype,'initialize');assert.equal(sent[1].message.content,'guardá la investigación');
 const ask=(id,file)=>proc.stdout.emit('data',Buffer.from(JSON.stringify({type:'control_request',request_id:id,request:{subtype:'can_use_tool',tool_name:'Write',input:{file_path:file,content:'x'},permission_suggestions:[{type:'setMode',mode:'acceptEdits',destination:'session'}],tool_use_id:'u-'+id}})+'\n'));
 ask('r1','C:/k/files/research.json');
 let c=(await route(service,'GET','/chats/'+chat.id)).value;
 assert.equal(c.permission.id,'r1');assert.equal(c.permission.label,'Guardando research.json');assert.equal(c.permission.always,true);assert.equal(c.activity,'Esperando tu permiso');
 await route(service,'POST','/chats/'+chat.id+'/permission',{id:'r1',decision:'always'});
 assert.deepEqual(sent.at(-1).response.response,{behavior:'allow',updatedInput:{file_path:'C:/k/files/research.json',content:'x'},updatedPermissions:[{type:'setMode',mode:'acceptEdits',destination:'session'}]});
 assert.equal((await route(service,'GET','/chats/'+chat.id)).value.permission,null);
 await assert.rejects(route(service,'POST','/chats/'+chat.id+'/permission',{id:'r1',decision:'allow'}),/ya no está activo/);
 ask('r2','C:/k/files/otra.json');await route(service,'POST','/chats/'+chat.id+'/permission',{id:'r2',decision:'deny'});
 assert.equal(sent.at(-1).response.response.behavior,'deny');
 // Auto en medio de la respuesta: el motor recibe el modo nuevo.
 await route(service,'POST','/chats/'+chat.id+'/mode',{mode:'auto'});assert.deepEqual(sent.at(-1).request,{subtype:'set_permission_mode',mode:'auto'});
 await route(service,'POST','/chats/'+chat.id+'/mode',{mode:'manual'});assert.deepEqual(sent.at(-1).request,{subtype:'set_permission_mode',mode:'default'});
 await route(service,'POST','/chats/'+chat.id+'/mode',{mode:'auto'});
 // Lo que el trader negó no se muestra como error; al terminar el turno se cierra la entrada del motor.
 proc.stdout.emit('data',Buffer.from(JSON.stringify({type:'result',is_error:false,result:'Listo sin guardar otra.json',permission_denials:[{tool_name:'Write',tool_use_id:'u-r2'}]})+'\n'));
 assert.ok(proc.stdin.writableEnded);proc.emit('close',0);
 c=(await route(service,'GET','/chats/'+chat.id)).value;assert.equal(c.error,null);assert.equal(c.state,'idle');assert.equal(c.mode,'auto');
});

test('el contexto no lleva el mapa existente (es a pedido) y sí la skill de diseño y la del mapa de galecore-ai/config',async t=>{
 const {base,kb,local}=setup(t);const {EventEmitter}=require('events');
 fs.mkdirSync(path.join(base,'galecore-ai'));fs.writeFileSync(path.join(base,'galecore-ai','PRODUCT.md'),'núcleo');
 const p0=path.join(kb,'workspaces/personal');fs.mkdirSync(path.join(p0,'memory'),{recursive:true});
 const contexts=[];
 const spawnProcess=(bin,args)=>{const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin={write(){},end(){}};proc.kill=()=>{};
  const f=args[args.indexOf('--append-system-prompt-file')+1];contexts.push(fs.readFileSync(f,'utf8'));setImmediate(()=>proc.emit('close',0));return proc;};
 const service=createWorkspaces({root:base,kb,local,binaries:{claude:'claude'},environment:()=>({}),legacyProjects:()=>[],legacySessions:()=>[],spawnProcess});
 const chat=(await route(service,'POST','/chats',{project:'personal',provider:'claude'})).value;
 fs.writeFileSync(path.join(p0,'memory','mapa-19cfc2d9.md'),'# Mapa\n');
 await route(service,'POST','/chats/'+chat.id+'/messages',{text:'seguimos con la idea'});
 await new Promise(r=>setTimeout(r,300));
 const ctx=contexts.at(-1);
 assert.ok(ctx.includes(path.join(base,'galecore-ai','config','skills','strategy-design','SKILL.md')));
 assert.ok(!ctx.includes('mapa-19cfc2d9.md'));assert.ok(ctx.includes(path.join(base,'galecore-lab','skills','mapa','SKILL.md')));   // WS-0071 AC-4: el mapa es a pedido, el turno no lleva su ruta
 assert.ok(!ctx.includes('.worktrees'));
});

test('un proyecto puede declarar su estrategia con otro nombre y mark_strategy conserva el vínculo (owner 26/10)',async t=>{const {kb,service}=setup(t);await route(service,'POST','/workspaces',{label:'Sandwich SPY',type:'strategy'});const dir=path.join(kb,'strategies','sandwich_spy'),file=path.join(dir,'workspace.json');const meta=JSON.parse(fs.readFileSync(file,'utf8'));fs.writeFileSync(file,JSON.stringify({id:meta.id,label:meta.label,type:'strategy',strategyName:'sandwich_spx_0dte_1345'}));const linked=(await route(service,'GET','/workspaces')).value.projects.find(x=>x.id==='sandwich_spy');assert.ok(linked.strategies.includes('sandwich_spx_0dte_1345'));require('child_process').execFileSync('python',[path.join(__dirname,'mark_strategy.py')],{cwd:dir,encoding:'utf8'});assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).strategies,['sandwich_spx_0dte_1345']);fs.writeFileSync(file,JSON.stringify({id:meta.id,label:meta.label,type:'strategy',strategyName:'../fuera'}));assert.deepEqual((await route(service,'GET','/workspaces')).value.projects.find(x=>x.id==='sandwich_spy').strategies,['sandwich_spy']);});

test('la carpeta de una estrategia no abre un proyecto aparte si otro proyecto ya la declara (owner 26/10)',async t=>{const {base,kb,local}=setup(t);const make=legacy=>createWorkspaces({root:base,kb,local,binaries:{codex:null,claude:null},environment:()=>({}),instructions:()=>'',legacyProjects:()=>legacy,legacySessions:()=>[]});const legacy=[{id:'sandwich_spx',label:'sandwich spx',relative:'strategies/sandwich_spx'}];const solo=make(legacy);assert.ok((await route(solo,'GET','/workspaces')).value.projects.some(x=>x.id==='sandwich_spx'));await route(solo,'POST','/workspaces',{label:'Sandwich SPY',type:'strategy'});const file=path.join(kb,'strategies','sandwich_spy','workspace.json');const m=JSON.parse(fs.readFileSync(file,'utf8'));fs.writeFileSync(file,JSON.stringify({id:m.id,label:m.label,type:'strategy',strategyName:'sandwich_spx'}));const ids=(await route(make(legacy),'GET','/workspaces')).value.projects.filter(x=>x.strategies.includes('sandwich_spx')).map(x=>x.id);assert.deepEqual(ids,['sandwich_spy']);});

test('el mapa del proyecto se lee sin conversación: el último de memory/, o vacío (owner 26/10)',async t=>{const {kb,service}=setup(t);const p=(await route(service,'POST','/workspaces',{label:'Sandwich SPY',type:'strategy'})).value;assert.equal((await route(service,'GET','/workspaces/'+p.id+'/mapa')).value.mapa,null);const mem=path.join(kb,'strategies',p.id,'memory');fs.mkdirSync(mem,{recursive:true});fs.writeFileSync(path.join(mem,'mapa-viejo.md'),'# Viejo\n');await new Promise(r=>setTimeout(r,20));fs.writeFileSync(path.join(mem,'mapa-nuevo.md'),'# Sandwich SPX\n');const mapa=(await route(service,'GET','/workspaces/'+p.id+'/mapa')).value.mapa;assert.equal(mapa.path,'memory/mapa-nuevo.md');assert.equal(mapa.title,'Sandwich SPX');});

test('investigaciones del proyecto: carpeta de sólo lectura con las anotadas con su id; cuerpo legible; borrar el proyecto las borra (WS-0066)',async t=>{
 const {kb,service}=setup(t);const p=(await route(service,'POST','/workspaces',{label:'Empresas test',type:'analysis'})).value;const other=(await route(service,'POST','/workspaces',{label:'Otro test',type:'analysis'})).value;
 const research=path.join(kb,'research');fs.mkdirSync(research,{recursive:true});
 const doc=(project,title)=>'---\nschema_version: "1"\ncreated_at: \'2026-10-27T10:00:00Z\'\n'+(project?'project: '+project+'\n':'')+'kind: research\nrevisions: []\n---\n\n# '+title+'\n\nHallazgo legible.\n';
 fs.writeFileSync(path.join(research,'2026-10-27-mia.md'),doc(p.id,'Mia'));
 fs.writeFileSync(path.join(research,'2026-10-27-ajena.md'),doc(other.id,'Ajena'));
 fs.writeFileSync(path.join(research,'2026-10-27-comun.md'),doc(null,'Comun'));
 fs.writeFileSync(path.join(research,'2026-10-27-crlf.md'),doc('"'+p.id+'"','Crlf').replace(/\n/g,'\r\n'));
 const files=(await route(service,'GET','/workspaces/'+p.id+'/files')).value;
 const folder=files.tree.find(n=>n.name==='investigaciones');assert.equal(folder.kind,'folder');
 assert.deepEqual(folder.children.map(c=>c.path).sort(),['investigaciones/2026-10-27-crlf.md','investigaciones/2026-10-27-mia.md']);
 const mine=(await route(service,'GET','/workspaces/'+p.id+'/files?path=investigaciones/2026-10-27-mia.md')).value;
 assert.match(mine.text,/^# Mia/);assert.match(mine.text,/Hallazgo legible/);assert.doesNotMatch(mine.text,/schema_version|project:/);
 assert.match((await route(service,'GET','/workspaces/'+p.id+'/files?path=investigaciones/2026-10-27-crlf.md')).value.text,/^# Crlf/);
 await assert.rejects(route(service,'GET','/workspaces/'+p.id+'/files?path=investigaciones/2026-10-27-ajena.md'),/no encontrado/);
 await assert.rejects(route(service,'GET','/workspaces/'+p.id+'/files?path=investigaciones/2026-10-27-comun.md'),/no encontrado/);
 assert.equal((await route(service,'GET','/workspaces/'+other.id+'/files')).value.tree.find(n=>n.name==='investigaciones').children.length,1);
 fs.writeFileSync(path.join(kb,'workspaces',p.id,'notas.md'),'n');
 for(const [op,body] of [['write',{path:'investigaciones/x.md',text:'x',create:true}],['write',{path:'investigaciones/2026-10-27-mia.md',text:'x'}],['mkdir',{path:'investigaciones/sub'}],['rename',{from:'investigaciones/2026-10-27-mia.md',to:'otra.md'}],['rename',{from:'notas.md',to:'investigaciones/z.md'}],['delete',{path:'investigaciones/2026-10-27-mia.md'}]])
  await assert.rejects(route(service,'POST','/workspaces/'+p.id+'/files/'+op,body),/sólo de lectura/);
 assert.ok(fs.existsSync(path.join(research,'2026-10-27-mia.md')));
 const r=await route(service,'POST','/workspaces/'+p.id+'/archive',{});assert.equal(r.value.deleted,true);
 assert.equal(fs.existsSync(path.join(research,'2026-10-27-mia.md')),false);assert.equal(fs.existsSync(path.join(research,'2026-10-27-crlf.md')),false);
 assert.ok(fs.existsSync(path.join(research,'2026-10-27-ajena.md')));assert.ok(fs.existsSync(path.join(research,'2026-10-27-comun.md')));
});
test('editar el último mensaje saca el pedido y su respuesta y le avisa al motor (WS-0067)',async t=>{
 const {EventEmitter}=require('events');const {base,kb,local}=setup(t);fs.mkdirSync(path.join(base,'galecore-ai'),{recursive:true});fs.writeFileSync(path.join(base,'galecore-ai','PRODUCT.md'),'núcleo');
 const sent=[];const spawnProcess=()=>{const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin={write(v){sent.push(String(v));},end(v){if(v)sent.push(String(v));}};proc.kill=()=>{};setImmediate(()=>proc.emit('close',0));return proc;};
 const service=createWorkspaces({root:base,kb,local,binaries:{claude:'claude',codex:'codex'},environment:()=>({}),instructions:()=>'',legacyProjects:()=>[],legacySessions:()=>[],spawnProcess});
 const chat=(await route(service,'POST','/chats',{project:'personal',provider:'claude'})).value;
 await route(service,'POST','/chats/'+chat.id+'/messages',{text:'primero'});await new Promise(r=>setTimeout(r,100));
 const before=(await route(service,'GET','/chats/'+chat.id)).value.messages.length;
 await route(service,'POST','/chats/'+chat.id+'/messages',{text:'segundo mejor',replace:true});
 const after=(await route(service,'GET','/chats/'+chat.id)).value.messages;
 assert.equal(before,1);assert.deepEqual(after.map(m=>m.text),['segundo mejor']);   // sólo el texto nuevo queda a la vista
 assert.ok(sent.some(s=>s.includes('reemplaza al pedido anterior')&&s.includes('primero')&&s.includes('segundo mejor')));
 await new Promise(r=>setTimeout(r,300));
});
test('mandar ya: tras cortar el turno, el envío siguiente espera a que cierre el proceso y no da 409 (WS-0067)',async t=>{
 const {EventEmitter}=require('events');const {base,kb,local}=setup(t);fs.mkdirSync(path.join(base,'galecore-ai'),{recursive:true});fs.writeFileSync(path.join(base,'galecore-ai','PRODUCT.md'),'núcleo');
 const procs=[];const spawnProcess=()=>{const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin={write(){},end(){}};
  proc.kill=()=>setTimeout(()=>proc.emit('close',1),150);procs.push(proc);if(procs.length>1)setImmediate(()=>proc.emit('close',0));return proc;};   // el primero sólo cierra al cortarlo
 const service=createWorkspaces({root:base,kb,local,binaries:{claude:'claude',codex:'codex'},environment:()=>({}),instructions:()=>'',legacyProjects:()=>[],legacySessions:()=>[],spawnProcess});
 const chat=(await route(service,'POST','/chats',{project:'personal',provider:'claude'})).value;
 await route(service,'POST','/chats/'+chat.id+'/messages',{text:'largo'});await new Promise(r=>setTimeout(r,100));
 await route(service,'POST','/chats/'+chat.id+'/stop',{});
 await route(service,'POST','/chats/'+chat.id+'/messages',{text:'ya'});   // sin esperar: antes daba 409
 await new Promise(r=>setTimeout(r,300));
 assert.equal(procs.length,2);
});
test('uso: se guarda lo que informan Claude y Codex en eventos reales, sin estimar (WS-0067)',()=>{
 const read=f=>fs.readFileSync(path.join(__dirname,'fixtures',f),'utf8').trim().split('\n').map(l=>JSON.parse(l));
 const claude={messages:[],turnStartedAt:1};read('eventos-reales-claude.jsonl').forEach(e=>consumeEvent(claude,e,'claude'));
 assert.equal(claude.usage.turns.length,1);
 const t=claude.usage.turns[0];assert.ok(t.input>=14763&&t.output===4&&t.cached===13813);assert.equal(typeof t.costUsd,'number');
 assert.ok(claude.usage.context.window>=200000&&claude.usage.context.used>0);
 assert.equal(claude.usage.limit.status,'allowed_warning');assert.equal(typeof claude.usage.limit.windows.five_hour.utilization,'number');
 const previousHome=process.env.CODEX_HOME;process.env.CODEX_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'codex-empty-'));   // sin sesiones: el test no depende del ~/.codex de quien lo corre
 const codex={messages:[],turnStartedAt:1};read('eventos-reales-codex.jsonl').forEach(e=>consumeEvent(codex,e,'codex'));
 if(previousHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previousHome;
 assert.deepEqual(codex.usage.turns.map(({at,...x})=>x),[{input:17340,cached:13440,output:5}]);
 assert.equal(codex.usage.context,undefined);assert.equal(codex.usage.limit,undefined);   // no lo informa: no se inventa
});
test('/skill y @agente: el Lab le indica al motor leer la pieza con space show, igual en Claude y Codex (WS-0067)',async t=>{
 const {EventEmitter}=require('events');const {base,kb,local}=setup(t);fs.mkdirSync(path.join(base,'galecore-ai'),{recursive:true});fs.writeFileSync(path.join(base,'galecore-ai','PRODUCT.md'),'núcleo');
 const sent=[];const spawnProcess=()=>{const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin={write(v){sent.push(String(v));},end(v){if(v)sent.push(String(v));}};proc.kill=()=>{};setImmediate(()=>proc.emit('close',0));return proc;};
 const service=createWorkspaces({root:base,kb,local,binaries:{claude:'claude',codex:'codex'},environment:()=>({}),instructions:()=>'',legacyProjects:()=>[],legacySessions:()=>[],spawnProcess});
 const mentions=[{kind:'skill',key:'valuar-empresa',title:'Valuar empresa'},{kind:'agent',key:'oportunidades',title:'Oportunidades'},{kind:'skill',key:'../malo',title:'x'},{kind:'data',key:'otro',title:'y'}];
 for(const provider of ['claude','codex']){
  sent.length=0;const chat=(await route(service,'POST','/chats',{project:'personal',provider})).value;
  await route(service,'POST','/chats/'+chat.id+'/messages',{text:'/valuar-empresa de AAPL con @oportunidades',mentions});await new Promise(r=>setTimeout(r,100));
  const prompt=sent.join('\n');
  assert.match(prompt,/aplicá la skill «Valuar empresa» \(leela con `space show skill\/valuar-empresa`/);
  assert.match(prompt,/trabajá con el agente «Oportunidades» \(leela con `space show agent\/oportunidades`/);
  assert.ok(!prompt.includes('malo')&&!prompt.includes('otro'));                       // sólo skills y agentes, con clave válida
  assert.equal((await route(service,'GET','/chats/'+chat.id)).value.messages[0].text,'/valuar-empresa de AAPL con @oportunidades');   // el chat conserva lo que escribió
 }
});
test('segundo plano: subagentes y comandos en segundo plano salen de los eventos reales y los pasos del subagente no se mezclan (WS-0067)',()=>{
 const events=fs.readFileSync(path.join(__dirname,'fixtures','eventos-reales-segundo-plano.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
 const chat={messages:[],steps:[],tasks:[],turnStartedAt:1};const seen=[];
 for(const e of events){consumeEvent(chat,e,'claude');seen.push(chat.tasks.map(t=>t.id.slice(0,4)+':'+t.status).join(','));}
 const agent=chat.tasks.find(t=>t.kind==='agent'),cmd=chat.tasks.find(t=>t.kind==='command');
 assert.equal(chat.tasks.length,2);                                   // la tarea interna del subagente (owned_by_subagent) no se muestra
 assert.deepEqual([agent.label,agent.agentType,agent.status],['Contar archivos del directorio','Explore','completed']);
 assert.equal(cmd.label,'Sleep 4 seconds in background');assert.equal(cmd.status,'completed');
 assert.ok(agent.tools>=3&&agent.tokens>20000&&agent.last);            // progreso del subagente
 assert.match(agent.summary,/720/);
 assert.ok(seen.some(s=>/ab4e:running/.test(s)&&/bpmv:running/.test(s)));   // los dos corrieron a la vez
 assert.ok(!(chat.steps||[]).some(s=>/find |PowerShell|Measure-Object/.test(s.detail||'')));   // los pasos internos del subagente no van a los pasos del chat
});
test('Codex: los límites de 5 h y semanal salen del archivo de su sesión (lo último que escribió el motor)',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'codex-home-')),id='01a18486-73cd-7261-9074-8400c2ef0a40',dir=path.join(home,'sessions','2026','10','28');
 fs.mkdirSync(dir,{recursive:true});
 const line=(p,s)=>JSON.stringify({type:'event_msg',payload:{type:'token_count',rate_limits:{primary:{used_percent:p,window_minutes:300,resets_at:1793242588},secondary:{used_percent:s,window_minutes:10080,resets_at:1793801859}}}});
 fs.writeFileSync(path.join(dir,'rollout-2026-10-28T18-59-26-'+id+'.jsonl'),[line(3,5),JSON.stringify({type:'x'}),line(7,6)].join('\n')+'\n');
 const l=codexLimits(id,home);
 assert.deepEqual(l,{windows:{five_hour:{utilization:0.07,resetsAt:1793242588},seven_day:{utilization:0.06,resetsAt:1793801859}}});
 assert.equal(codexLimits('no-existe',home),undefined);assert.equal(codexLimits('../x',home),undefined);
 fs.rmSync(home,{recursive:true,force:true});
});


test('Codex: abrir un chat existente recupera contexto y cuotas de su sesión, sin sumar tokens de todo el turno',async t=>{
 const {base,local,service}=setup(t),home=path.join(base,'codex'),id='01a18486-73cd-7261-9074-8400c2ef0a40';
 const previous=process.env.CODEX_HOME;process.env.CODEX_HOME=home;
 t.after(()=>{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;});
 const dir=path.join(home,'sessions','2025','01','01');fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'rollout-'+id+'.jsonl');
 const token=payload=>JSON.stringify({type:'event_msg',payload:{type:'token_count',...payload}});
 const limits={primary:{used_percent:9,window_minutes:300},secondary:{used_percent:7,window_minutes:10080}};
 fs.writeFileSync(file,[token({rate_limits:limits}),token({info:{last_token_usage:{total_tokens:52912},total_token_usage:{total_tokens:226710},model_context_window:475000},rate_limits:null}),'partial'].join('\n'));
 const created=await route(service,'POST','/chats',{project:'personal',provider:'codex'});
 const chat={...created.value,nativeId:id,usage:{turns:[{at:'2026-10-28T19:00:00Z',input:1,cached:1,output:1}]}};
 fs.writeFileSync(path.join(local,'chats',chat.id+'.json'),JSON.stringify(chat));
 const loaded=(await route(service,'GET','/chats/'+chat.id)).value;
 assert.deepEqual(loaded.usage.context,{used:52912,window:475000});
 assert.equal(loaded.usage.limit.windows.five_hour.utilization,.09);
 assert.equal(loaded.usage.limit.windows.seven_day.utilization,.07);
 assert.equal(loaded.usage.turns.length,1);
 const {codexTelemetry}=require('./lab-workspaces');
 fs.appendFileSync(file,'\n'+token({info:{last_token_usage:{total_tokens:0},model_context_window:475000},rate_limits:{primary:{used_percent:0,window_minutes:300}}}));
 assert.deepEqual(codexTelemetry(id,home).context,{used:0,window:475000});
 assert.equal(codexLimits(id,home).windows.five_hour.utilization,0);
 assert.equal(codexTelemetry('../outside',home),undefined);
 fs.writeFileSync(file,token({info:{last_token_usage:{total_tokens:100},model_context_window:0},rate_limits:{primary:{used_percent:10,window_minutes:60}}}));
 assert.equal(codexTelemetry(id,home),undefined);
});

test('Claude: chats anteriores recuperan caché con su fecha original y no pisan métricas ya guardadas',async t=>{
 const {base,local,service}=setup(t),home=path.join(base,'claude'),nativeId='2a0b42dd-5afa-4872-835a-8fb3d7974ddb';
 const previous=process.env.CLAUDE_CONFIG_DIR;process.env.CLAUDE_CONFIG_DIR=home;
 t.after(()=>{if(previous===undefined)delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=previous;});
 const dir=path.join(home,'projects','project');fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,nativeId+'.jsonl'),at='2026-10-27T17:57:05.962Z';
 const event={type:'assistant',sessionId:nativeId,timestamp:at,message:{usage:{input_tokens:2,cache_creation_input_tokens:2318,cache_read_input_tokens:45137,output_tokens:1091}}};
 fs.writeFileSync(file,[JSON.stringify(event),JSON.stringify({...event,isSidechain:true,message:{usage:{input_tokens:999,cache_read_input_tokens:999}}}),'partial'].join('\n'));
 const chat=(await route(service,'POST','/chats',{project:'personal',provider:'claude'})).value;
 chat.nativeId=nativeId;
 const saved=path.join(local,'chats',chat.id+'.json');fs.writeFileSync(saved,JSON.stringify(chat));
 const loaded=(await route(service,'GET','/chats/'+chat.id)).value;
 assert.deepEqual(loaded.usage.turns,[{at,input:47457,cached:45137,output:1091}]);
 assert.equal(loaded.usage.context,undefined);assert.equal(loaded.usage.limit,undefined);
 assert.equal(JSON.parse(fs.readFileSync(saved,'utf8')).usage,undefined); // GET no migra ni duplica turnos.
 assert.deepEqual((await route(service,'GET','/chats/'+chat.id)).value.usage,loaded.usage);
 chat.usage={turns:[{at:'2026-10-28T20:00:00Z',input:200,cached:100,output:10}],context:{used:200,window:1000},limit:{windows:{}}};
 fs.writeFileSync(saved,JSON.stringify(chat));
 assert.deepEqual((await route(service,'GET','/chats/'+chat.id)).value.usage,chat.usage);
 const {claudeLastUsage}=require('./lab-workspaces');
 assert.equal(claudeLastUsage('../outside',home),undefined);
 fs.writeFileSync(file,JSON.stringify({...event,timestamp:'bad'}));assert.equal(claudeLastUsage(nativeId,home),undefined);
 fs.writeFileSync(file,JSON.stringify({...event,sessionId:'another-session'}));assert.equal(claudeLastUsage(nativeId,home),undefined);
 fs.unlinkSync(file);assert.equal(claudeLastUsage(nativeId,home),undefined);
});

test('WS-0071 AC-1: workspace.json sin tipo lleva strategies; los formatos viejos se migran al leer sin reescribirse',async t=>{const {kb,service}=setup(t);const a=(await route(service,'POST','/workspaces',{label:'Argentina'})).value;assert.deepEqual(a.strategies,[]);assert.equal(a.strategyName,undefined);const file=path.join(kb,'workspaces','argentina','workspace.json');const saved=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal('type' in saved,false);assert.deepEqual(saved.strategies,[]);
 fs.writeFileSync(file,JSON.stringify({id:'argentina',label:'Argentina',type:'strategy',strategyName:'bonos_ar'}));const before=fs.readFileSync(file,'utf8');const migrated=(await route(service,'GET','/workspaces')).value.projects.find(x=>x.id==='argentina');assert.deepEqual(migrated.strategies,['bonos_ar']);assert.ok(migrated.strategies.includes('bonos_ar'));assert.equal(fs.readFileSync(file,'utf8'),before);
 fs.writeFileSync(file,JSON.stringify({id:'argentina',label:'Argentina',type:'analysis'}));assert.deepEqual((await route(service,'GET','/workspaces')).value.projects.find(x=>x.id==='argentina').strategies,[]);
 const s=(await route(service,'POST','/workspaces',{label:'VRP',type:'strategy'})).value;assert.deepEqual(s.strategies,['vrp']);assert.equal(s.relative,'strategies/vrp');});
test('WS-0071 AC-2: mark_strategy agrega varias estrategias al mismo proyecto, es idempotente y rechaza la de otro proyecto',async t=>{const {kb,service}=setup(t);await route(service,'POST','/workspaces',{label:'Argentina'});await route(service,'POST','/workspaces',{label:'Brasil'});
 const run=(project,name)=>{try{return JSON.parse(require('child_process').execFileSync('python',[path.join(__dirname,'mark_strategy.py'),name],{cwd:path.join(kb,'workspaces',project),encoding:'utf8'}));}catch(e){return JSON.parse(e.stdout);}};
 assert.equal(run('argentina','bonos_ar').ok,true);assert.equal(run('argentina','evento_ar').ok,true);assert.equal(run('argentina','bonos_ar').changed,false);
 const rejected=run('brasil','bonos_ar');assert.equal(rejected.ok,false);assert.match(rejected.error,/argentina/);
 const list=(await route(service,'GET','/workspaces')).value.projects;assert.deepEqual(list.find(x=>x.id==='argentina').strategies,['bonos_ar','evento_ar']);assert.deepEqual(list.find(x=>x.id==='brasil').strategies,[]);});
test('WS-0071 AC-2: mark_strategy rechaza la estrategia de un proyecto viejo cuya carpeta se llama igual',async t=>{const {kb,service}=setup(t);await route(service,'POST','/workspaces',{label:'Argentina'});
 const old=path.join(kb,'workspaces','bonos_ar');fs.mkdirSync(old,{recursive:true});fs.writeFileSync(path.join(old,'workspace.json'),JSON.stringify({id:'bonos_ar',label:'bonos_ar',type:'strategy',strategyName:'bonos_ar'}));
 let r;try{r=JSON.parse(require('child_process').execFileSync('python',[path.join(__dirname,'mark_strategy.py'),'bonos_ar'],{cwd:path.join(kb,'workspaces','argentina'),encoding:'utf8'}));}catch(e){r=JSON.parse(e.stdout);}
 assert.equal(r.ok,false);assert.match(r.error,/bonos_ar/);
 assert.deepEqual((await route(service,'GET','/workspaces')).value.projects.find(x=>x.id==='argentina').strategies,[]);});
test('WS-0071 AC-3: el contexto del turno lista las estrategias del proyecto y pregunta «¿nueva o una de las que ya tiene?», sin tipos',async t=>{
 const {base,kb,local}=setup(t);const {EventEmitter}=require('events');
 fs.mkdirSync(path.join(base,'galecore-ai'));fs.writeFileSync(path.join(base,'galecore-ai','PRODUCT.md'),'núcleo de test');
 const contexts=[];
 const spawnProcess=(bin,args)=>{contexts.push(fs.readFileSync(args[args.indexOf('--append-system-prompt-file')+1],'utf8'));const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin={write(){},end(){}};proc.kill=()=>{};setImmediate(()=>proc.emit('close',0));return proc;};
 const service=createWorkspaces({root:path.dirname(kb),kb,local,binaries:{claude:'claude'},environment:()=>({}),legacyProjects:()=>[],legacySessions:()=>[],spawnProcess});
 const say=async project=>{const chat=(await route(service,'POST','/chats',{project,provider:'claude'})).value;await route(service,'POST','/chats/'+chat.id+'/messages',{text:'hola'});await new Promise(r=>setTimeout(r,50));return contexts.at(-1);};
 await route(service,'POST','/workspaces',{label:'Argentina'});await route(service,'POST','/workspaces',{label:'Brasil'});
 fs.writeFileSync(path.join(kb,'workspaces','argentina','workspace.json'),JSON.stringify({id:'argentina',label:'Argentina',strategies:['bonos_ar','evento_ar']}));
 const withTwo=await say('argentina');
 assert.match(withTwo,/Estrategias de este proyecto: bonos_ar, evento_ar\./);
 assert.match(withTwo,/«¿es una estrategia nueva de este proyecto o una de las que ya tiene \(bonos_ar, evento_ar\)\?»/);
 assert.match(withTwo,/mark_strategy\.py" <nombre>/);assert.doesNotMatch(withTwo,/\((analysis|strategy|personal)\)/);
 assert.doesNotMatch(withTwo,/reescribí/);assert.match(withTwo,/armame el mapa de/);assert.ok(withTwo.includes(path.join(base,'galecore-lab','skills','mapa','SKILL.md')));   // AC-4: el mapa es a pedido, no por turno
 const none=await say('brasil');assert.match(none,/Estrategias de este proyecto: ninguna todavía\./);assert.doesNotMatch(none,/o una de las que ya tiene/);
 assert.doesNotMatch(await say('personal'),/Estrategias de este proyecto/);
});

test('modos de permisos por motor (WS-0083): cada modo se traduce a su bandera; lo desconocido cae al seguro',async t=>{
 const {permissionMode}=require('./lab-workspaces');
 for(const m of ['default','acceptEdits','auto','plan'])assert.equal(permissionMode('claude',m),m);
 for(const m of ['read-only','workspace-write','auto'])assert.equal(permissionMode('codex',m),m);
 // compatibilidad ('manual') y nunca se saltea: lo ajeno al motor o inventado cae a default / workspace-write
 for(const bad of ['manual',undefined,'bypassPermissions','danger-full-access','dontAsk','read-only','--x'])assert.equal(permissionMode('claude',bad),'default');
 for(const bad of ['manual',undefined,'bypassPermissions','danger-full-access','plan','acceptEdits','default'])assert.equal(permissionMode('codex',bad),'workspace-write');
 const {base,kb,local}=setup(t);const calls=[];let hold=false;
 fs.mkdirSync(path.join(base,'galecore-ai'));fs.writeFileSync(path.join(base,'galecore-ai','PRODUCT.md'),'núcleo de test');
 const {EventEmitter}=require('events');
 const spawnProcess=(_,args)=>{calls.push(args);const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin={write(){},end(){this.writableEnded=true;}};proc.kill=()=>{};if(!hold)setTimeout(()=>proc.emit('close',0),30);return proc;};
 const service=createWorkspaces({root:path.dirname(kb),kb,local,binaries:{claude:'claude',codex:'codex'},environment:()=>({CODEX_HOME:path.join(base,'codex')}),legacyProjects:()=>[],legacySessions:()=>[],spawnProcess});
 fs.mkdirSync(path.join(base,'codex'),{recursive:true});
 const after=(a,flag)=>a[a.indexOf(flag)+1];
 const turn=async(provider,mode,nativeId)=>{
  const c=(await route(service,'POST','/chats',{project:'personal',provider})).value;
  if(nativeId){const f=path.join(local,'chats',c.id+'.json');const j=JSON.parse(fs.readFileSync(f,'utf8'));j.nativeId=nativeId;fs.writeFileSync(f,JSON.stringify(j));}
  await route(service,'POST','/chats/'+c.id+'/messages',{text:'hola',...(mode?{mode}:{})});
  await new Promise(r=>setTimeout(r,100));
  return {args:calls.at(-1),chat:(await route(service,'GET','/chats/'+c.id)).value};
 };
 for(const [sent,want] of [[undefined,'default'],['manual','default'],['acceptEdits','acceptEdits'],['auto','auto'],['plan','plan'],['bypassPermissions','default']]){
  const {args,chat}=await turn('claude',sent);assert.equal(after(args,'--permission-mode'),want);assert.equal(chat.mode,want);assert.ok(!args.includes('bypassPermissions'));
 }
 // Codex nuevo: --sandbox <modo> (Auto: sólo --approve-for-me)
 for(const [sent,want] of [[undefined,'workspace-write'],['manual','workspace-write'],['read-only','read-only'],['danger-full-access','workspace-write']]){
  const {args}=await turn('codex',sent);assert.equal(after(args,'--sandbox'),want);assert.ok(!args.includes('--approve-for-me')&&!args.includes('danger-full-access'));
 }
 const auto=await turn('codex','auto');assert.ok(auto.args.includes('--approve-for-me')&&!auto.args.includes('--sandbox'));
 // Codex retomando: `exec resume` no tiene --sandbox; read-only va como -c antes de `resume`
 const resumed=await turn('codex','read-only','thread-1');
 assert.ok(!resumed.args.includes('--sandbox'));assert.ok(resumed.args.includes('sandbox_mode="read-only"'));assert.ok(resumed.args.indexOf('sandbox_mode="read-only"')<resumed.args.indexOf('resume'));
 const resumedAuto=await turn('codex','auto','thread-2');assert.ok(resumedAuto.args.includes('--approve-for-me')&&!resumedAuto.args.some(a=>a.startsWith('sandbox_mode')));
 // El modo en medio del turno también se valida
 hold=true;const live=(await route(service,'POST','/chats',{project:'personal',provider:'claude'})).value;
 await route(service,'POST','/chats/'+live.id+'/messages',{text:'hola'});await new Promise(r=>setTimeout(r,100));
 assert.equal((await route(service,'POST','/chats/'+live.id+'/mode',{mode:'bypassPermissions'})).value.mode,'default');
 assert.equal((await route(service,'POST','/chats/'+live.id+'/mode',{mode:'plan'})).value.mode,'plan');
});

test('conectores del chat (WS-0083): GaleCore fijo, interruptor de brókers escribe broker-queries.json y rechaza lo que no es booleano',async t=>{
 const {local,service}=setup(t);
 let r=await route(service,'GET','/connectors');assert.deepEqual([r.value.galecore,r.value.brokers],[{enabled:true},{enabled:false,engines:['codex','claude']}]);
 r=await route(service,'POST','/connectors/brokers',{enabled:true});assert.equal(r.value.brokers.enabled,true);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(local,'broker-queries.json'),'utf8')),{enabled:true});
 assert.ok(require('./lab-brokers').brokerQueries(local));   // lo que lee el turno de Codex
 assert.equal((await route(service,'GET','/connectors')).value.brokers.enabled,true);
 for(const bad of ['true',1,undefined,null])await assert.rejects(route(service,'POST','/connectors/brokers',{enabled:bad}),/prender o apagar/);
 assert.equal((await route(service,'POST','/connectors/brokers',{enabled:false})).value.brokers.enabled,false);
 assert.equal(require('./lab-brokers').brokerQueries(local),null);
 fs.writeFileSync(path.join(local,'broker-queries.json'),'{');assert.equal((await route(service,'GET','/connectors')).value.brokers.enabled,false);   // ilegible = apagado
});

test('permisos de Claude Code (WS-0083): reglas del producto fijas, las del usuario se validan y llegan al --settings del turno',async t=>{
 const {kb,local,service}=setup(t);
 fs.mkdirSync(path.join(kb,'.claude'));
 fs.writeFileSync(path.join(kb,'.claude','settings.json'),JSON.stringify({permissions:{defaultMode:'acceptEdits',allow:['Read'],deny:['Bash(git push:*)']},autoMemoryEnabled:false}));
 let r=await route(service,'GET','/permissions/claude');
 assert.deepEqual(r.value,{product:{allow:['Read'],ask:[],deny:['Bash(git push:*)']},user:{allow:[],ask:[],deny:[]}});
 r=await route(service,'POST','/permissions/claude',{allow:['Bash(git status:*)',' WebFetch(domain:cnn.com) ','Bash(git status:*)'],ask:['Write']});
 assert.deepEqual(r.value.user,{allow:['Bash(git status:*)','WebFetch(domain:cnn.com)'],ask:['Write'],deny:[]});
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(local,'claude-permissions.json'),'utf8')).ask,['Write']);
 for(const bad of [{allow:['']},{allow:[3]},{allow:'Bash'},{deny:['hola mundo']},{ask:['Bash()']},{allow:['bypassPermissions']}])
  await assert.rejects(route(service,'POST','/permissions/claude',bad),/inválida|lista/);
 const merged=require('./lab-permissions').mergedSettings(kb,local);
 assert.deepEqual(merged.permissions.allow,['Read','Bash(git status:*)','WebFetch(domain:cnn.com)']);
 assert.equal(merged.permissions.defaultMode,'acceptEdits');assert.deepEqual(merged.permissions.deny,['Bash(git push:*)']);assert.equal(merged.autoMemoryEnabled,false);
 assert.equal(JSON.stringify(merged).includes('bypassPermissions'),false);
});
