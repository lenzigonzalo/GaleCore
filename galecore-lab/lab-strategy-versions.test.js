const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');const os=require('os');
const {createWorkspaces}=require('./lab-workspaces');
function setup(t,handler){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'gc-ver-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const kb=path.join(base,'knowledge'),local=path.join(base,'local');fs.mkdirSync(kb);fs.mkdirSync(local);
  const calls=[];
  const execute=(bin,args,opts,cb)=>{calls.push({bin,args,opts});handler(args,cb);};
  const service=createWorkspaces({root:base,kb,local,binaries:{},environment:()=>({}),instructions:()=>'',legacyProjects:()=>[],legacySessions:()=>[],execute});
  const call=async(method,url,body)=>{let out;await service.route({method},{},new URL(url,'http://localhost'),(res,status,v)=>{out={status,v};},async()=>body||{});return out;};
  return {calls,call,service};
}
const ok=data=>(args,cb)=>cb(null,JSON.stringify(data));
const fail=(code,data)=>(args,cb)=>cb(Object.assign(new Error('x'),{code}),JSON.stringify(data));
const PRE=['-B','-m','galecore_ai.adapters.cli','strategy'];

test('GET versions: argv exacto y JSON sin cambios; valida nombre antes de ejecutar',async t=>{
  const {calls,call}=setup(t,ok({versions:[{version:'1.0.0'}]}));
  const r=await call('GET','/strategies/spy_ic/versions');
  assert.equal(r.status,200);assert.deepEqual(r.v,{versions:[{version:'1.0.0'}]});
  assert.equal(calls[0].bin,'python');assert.deepEqual(calls[0].args,[...PRE,'versions','--name','spy_ic']);
  for(const bad of ['..%2Fx','a%20b','A','x%22y','']){
    const n=calls.length;const q=await call('GET','/strategies/'+bad+'/versions');
    assert.ok(q===undefined||q.status===400,bad);assert.equal(calls.length,n);
  }
});
test('approve ya no es una ruta de la ficha: se activa o no se hace nada',async t=>{
  const {calls,call}=setup(t,ok({approved:true}));
  const r=await call('POST','/strategies/spy_ic/versions/1.3.2/approve',{user:'gonza'});
  assert.ok(r===undefined||r.status!==200);assert.equal(calls.length,0);
});
test('errores del harness: los conocidos en castellano, lo desconocido genérico con el detalle',async t=>{
  let mode=1;const {call}=setup(t,(a,cb)=>mode===1?fail(1,{error:'strategy:x/1.0.0: an INVALID proposal cannot be approved'})(a,cb):mode===2?fail(2,{error:'argumento raro'})(a,cb):cb(new Error('boom'),'no json'));
  let r=await call('POST','/strategies/spy_ic/versions/1.0.0/revise',{user:'g',changes:{'risk_limits/max_bet_pct':5}});assert.equal(r.status,409);assert.match(r.v.error,/INVALID/);assert.match(r.v.detail,/an INVALID proposal/);
  mode=2;r=await call('POST','/strategies/spy_ic/versions/1.0.0/revise',{user:'g',changes:{'risk_limits/max_bet_pct':5}});assert.equal(r.status,400);assert.equal(r.v.error,'El harness rechazó la operación.');assert.equal(r.v.detail,'argumento raro');
  mode=3;r=await call('POST','/strategies/spy_ic/versions/1.0.0/revise',{user:'g',changes:{'risk_limits/max_bet_pct':5}});assert.equal(r.status,500);assert.ok(!JSON.stringify(r.v).includes('boom'));
});
test('editable: argv exacto y valida antes de ejecutar',async t=>{
  const {calls,call}=setup(t,ok({fields:[]}));
  const r=await call('GET','/strategies/spy_ic/versions/1.3.2/editable');
  assert.equal(r.status,200);assert.deepEqual(calls[0].args,[...PRE,'editable','--ref','strategy:spy_ic/1.3.2']);
  for(const u of ['/strategies/..%2Fx/versions/1.3.2/editable','/strategies/spy_ic/versions/1.3/editable']){const n=calls.length;const q=await call('GET',u);assert.equal(q.status,400,u);assert.equal(calls.length,n);}
});
test('revise: argv exacto y validación del cuerpo antes de ejecutar',async t=>{
  const {calls,call}=setup(t,ok({status:'RECORDED',ref:'strategy:spy_ic/1.3.3'}));
  const u='/strategies/spy_ic/versions/1.3.2/revise';
  const r=await call('POST',u,{user:'gonza',changes:{'risk_limits/max_loss_per_trade_usd':240,'operational/entry_window/start':'13:45'},reason:'menos riesgo'});
  assert.equal(r.status,200);assert.equal(r.v.ref,'strategy:spy_ic/1.3.3');
  assert.deepEqual(calls[0].args,[...PRE,'revise','--ref','strategy:spy_ic/1.3.2','--set','risk_limits/max_loss_per_trade_usd=240','--set','operational/entry_window/start=13:45','--reason','menos riesgo','--host-provider','monitor','--host-model','ficha']);
  const n=calls.length;
  for(const b of [{user:'gonza'},{user:'gonza',changes:{}},{user:'gonza',changes:[1]},{user:'gonza',changes:{'A/b':1}},{user:'gonza',changes:{'a/b':'mucho'}},{user:'gonza',changes:{'a/b':null}},{user:'gonza',changes:{'a/b':'25:00'}},{user:'a b',changes:{'a/b':1}},{user:'gonza',changes:{'a/b':1},reason:5}]){
    const q=await call('POST',u,b);assert.equal(q.status,400,JSON.stringify(b));
  }
  assert.equal(calls.length,n);
  assert.equal((await call('POST','/strategies/spy_ic/versions/1.3/revise',{user:'g',changes:{'a/b':1}})).status,400);
});
const versionsOf=approved=>({versions:[{version:'1.3.1',approved:true},{version:'1.3.2',approved}]});
const router=(approved,failOn)=>(args,cb)=>{
  const c=args[4];
  if(c==='versions')return cb(null,JSON.stringify(versionsOf(approved)));
  if(c===failOn)return fail(1,{error:'GaleCore no devolvió la instancia desplegada'})(args,cb);
  if(c==='approve')return cb(null,JSON.stringify({status:'APPROVED'}));
  cb(null,JSON.stringify({status:'DEPLOYED',instance_id:'i-9',existing:false,replaced_hash:'sha256:a'}));
};
test('activate sin aprobación previa: approve sin crítica y después deploy sin crítica',async t=>{
  const {calls,call}=setup(t,router(false));
  const r=await call('POST','/strategies/spy_ic/versions/1.3.2/activate',{user:'gonza'});
  assert.equal(r.status,200);assert.equal(r.v.instance_id,'i-9');assert.equal(r.v.existing,false);assert.equal(r.v.replaced_hash,'sha256:a');
  assert.deepEqual(calls.map(c=>c.args[4]),['versions','approve','deploy']);
  assert.deepEqual(calls[1].args,[...PRE,'approve','--without-critique','--ref','strategy:spy_ic/1.3.2','--owner-words','Activada desde la ficha por gonza, con confirmación en pantalla: spy_ic 1.3.2 en SHADOW','--host-provider','monitor','--host-model','ficha']);
  assert.deepEqual(calls[2].args,[...PRE,'deploy','--without-critique','--ref','strategy:spy_ic/1.3.2']);
});
test('activate con la versión ya aprobada: sólo deploy',async t=>{
  const {calls,call}=setup(t,router(true));
  const r=await call('POST','/strategies/spy_ic/versions/1.3.2/activate',{user:'gonza'});
  assert.equal(r.status,200);assert.deepEqual(calls.map(c=>c.args[4]),['versions','deploy']);
});
test('activate: si el deploy falla tras aprobar, lo dice; valida entradas y versión inexistente',async t=>{
  const {calls,call}=setup(t,router(false,'deploy'));
  let r=await call('POST','/strategies/spy_ic/versions/1.3.2/activate',{user:'gonza'});
  assert.equal(r.status,409);assert.match(r.v.error,/quedó aprobada pero no activa/);assert.match(r.v.error,/GaleCore no devolvió la instancia/);
  const n=calls.length;
  for(const [u,b] of [['/strategies/..%2Fx/versions/1.3.2/activate',{user:'g'}],['/strategies/spy_ic/versions/1.3/activate',{user:'g'}],['/strategies/spy_ic/versions/1.3.2/activate',{user:'a b'}],['/strategies/spy_ic/versions/1.3.2/activate',{}]]){const q=await call('POST',u,b);assert.equal(q.status,400,u);}
  assert.equal(calls.length,n);
  r=await call('POST','/strategies/spy_ic/versions/9.9.9/activate',{user:'g'});assert.equal(r.status,404);
});
test('duplicate: argv, crea el proyecto solo si el CLI anda, y rechaza entradas invalidas',async t=>{
  const {calls,call,service}=setup(t,ok({ref:'strategy:spy_ic_b/1.0.0',duplicatedFrom:'strategy:spy_ic/1.3.2'}));
  const r=await call('POST','/strategies/spy_ic/duplicate',{version:'1.3.2',newName:'spy_ic_b',user:'gonza'});
  assert.equal(r.status,200);assert.deepEqual(r.v,{ref:'strategy:spy_ic_b/1.0.0',duplicatedFrom:'strategy:spy_ic/1.3.2',projectId:'spy_ic_b'});
  assert.deepEqual(calls[0].args,[...PRE,'duplicate','--ref','strategy:spy_ic/1.3.2','--as','spy_ic_b','--host-provider','monitor','--host-model','ficha']);
  assert.ok(service.listProjects().some(p=>p.id==='spy_ic_b'));
  const base={version:'1.3.2',newName:'otra_mas',user:'gonza'};
  for(const b of [{...base,newName:'../x'},{...base,newName:'Ab c'},{...base,newName:'ab'},{...base,newName:'a__bc'},{...base,newName:'abc_'},{...base,version:'1'},{...base,user:'a b'},{...base,user:"a'b"}]){
    const n=calls.length;const q=await call('POST','/strategies/spy_ic/duplicate',b);assert.equal(q.status,400,JSON.stringify(b));assert.equal(calls.length,n);
  }
  const q=await call('POST','/strategies/..%2Fx/duplicate',base);assert.equal(q.status,400);
  assert.ok(!service.listProjects().some(p=>p.id==='otra_mas'));
});
test('duplicate: si el CLI rechaza, 409 y no se crea proyecto',async t=>{
  const {call,service}=setup(t,fail(1,{error:'strategy spy_ic_b already has versions; a duplicate needs a new name'}));
  const r=await call('POST','/strategies/spy_ic/duplicate',{version:'1.3.2',newName:'tomada',user:'g'});
  assert.equal(r.status,409);assert.match(r.v.error,/nombre ya está tomado/);
  assert.ok(!service.listProjects().some(p=>p.id==='tomada'));
});

test('duplicate: el CLI real deja la carpeta de la estrategia (y el Lab la lista como legada): el proyecto se crea igual, sin tocar sus archivos',async t=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'gc-dup-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const kb=path.join(base,'knowledge'),local=path.join(base,'local');fs.mkdirSync(kb);fs.mkdirSync(local);
  const dir=path.join(kb,'strategies','spy_ic_b');
  const execute=(bin,args,opts,cb)=>{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'1.0.0.proposal.json'),'{}');cb(null,JSON.stringify({ref:'strategy:spy_ic_b/1.0.0'}));};
  const service=createWorkspaces({root:base,kb,local,binaries:{},environment:()=>({}),instructions:()=>'',legacyProjects:()=>fs.existsSync(dir)?[{id:'spy_ic_b',label:'spy_ic_b'}]:[],legacySessions:()=>[],execute});
  let out;await service.route({method:'POST'},{},new URL('/strategies/spy_ic/duplicate','http://localhost'),(res,status,v)=>{out={status,v};},async()=>({version:'1.3.2',newName:'spy_ic_b',user:'gonza'}));
  assert.equal(out.status,200,JSON.stringify(out.v));assert.equal(out.v.projectId,'spy_ic_b');
  assert.equal(fs.readFileSync(path.join(dir,'1.0.0.proposal.json'),'utf8'),'{}');
  assert.ok(fs.existsSync(path.join(dir,'workspace.json')));
});
test('el motivo que el harness repite en problems no se duplica en el mensaje',async t=>{
  const {call}=setup(t,fail(1,{error:'Para desplegar hace falta tu sesión de GaleCore: no credentials',problems:['no credentials']}));
  const r=await call('POST','/strategies/spy_ic/versions/1.0.0/revise',{user:'g',changes:{'a/b':1}});
  assert.equal(r.v.error,'Para desplegar hace falta tu sesión de GaleCore: no credentials');
});
