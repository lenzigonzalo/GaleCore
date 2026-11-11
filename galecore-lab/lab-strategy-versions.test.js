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
test('approve: argv exacto, validaciones y mapeo de fallas',async t=>{
  const {calls,call}=setup(t,ok({approved:true}));
  const r=await call('POST','/strategies/spy_ic/versions/1.3.2/approve',{user:'gonza'});
  assert.equal(r.status,200);assert.deepEqual(r.v,{approved:true});
  assert.deepEqual(calls[0].args,[...PRE,'approve','--ref','strategy:spy_ic/1.3.2','--owner-words','Aprobada desde la ficha por gonza, con confirmación en pantalla: spy_ic 1.3.2 en SHADOW','--host-provider','monitor','--host-model','ficha']);
  const cases=[['/strategies/..%2Fx/versions/1.3.2/approve',{user:'gonza'}],['/strategies/spy_ic/versions/1.3/approve',{user:'gonza'}],['/strategies/spy_ic/versions/1.3.2/approve',{user:'a b'}],['/strategies/spy_ic/versions/1.3.2/approve',{user:'a"b'}],['/strategies/spy_ic/versions/1.3.2/approve',{}]];
  for(const [u,b] of cases){const n=calls.length;const q=await call('POST',u,b);assert.equal(q.status,400,u);assert.equal(calls.length,n);}
});
test('approve: CLI con error devuelve 409 con su JSON; argumento inválido 400; salida ilegible 500',async t=>{
  let mode=1;const {call}=setup(t,(a,cb)=>mode===1?fail(1,{error:'ya aprobada'})(a,cb):mode===2?fail(2,{error:'argumento'})(a,cb):cb(new Error('boom'),'no json'));
  let r=await call('POST','/strategies/spy_ic/versions/1.0.0/approve',{user:'g'});assert.equal(r.status,409);assert.equal(r.v.error,'ya aprobada');
  mode=2;r=await call('POST','/strategies/spy_ic/versions/1.0.0/approve',{user:'g'});assert.equal(r.status,400);
  mode=3;r=await call('POST','/strategies/spy_ic/versions/1.0.0/approve',{user:'g'});assert.equal(r.status,500);assert.ok(!JSON.stringify(r.v).includes('boom'));
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
  const {call,service}=setup(t,fail(1,{error:'el nombre ya existe'}));
  const r=await call('POST','/strategies/spy_ic/duplicate',{version:'1.3.2',newName:'tomada',user:'g'});
  assert.equal(r.status,409);assert.equal(r.v.error,'el nombre ya existe');
  assert.ok(!service.listProjects().some(p=>p.id==='tomada'));
});
