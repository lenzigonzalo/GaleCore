const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');const os=require('os');
const {createWorkspaces}=require('./lab-workspaces');
function setup(t,execute){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'gc-design-'));
  t.after(()=>{assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep+'gc-design-'));fs.rmSync(base,{recursive:true,force:true});});
  const kb=path.join(base,'knowledge'),local=path.join(base,'local');fs.mkdirSync(kb);fs.mkdirSync(local);
  const service=createWorkspaces({root:base,kb,local,binaries:{},environment:()=>({}),instructions:()=>'',legacyProjects:()=>[],legacySessions:()=>[],execute});
  const get=async url=>{let value;await service.route({method:'GET'},{},new URL(url,'http://localhost'),(res,status,v)=>{value=v;},async()=>({}));return value;};
  const create=async label=>{let value;await service.route({method:'POST'},{},new URL('/workspaces','http://localhost'),(res,status,v)=>{value=v;},async()=>({label,type:'strategy'}));return value;};
  return {kb,get,create};
}
test('design reuses verified result, coalesces reads and invalidates by file bytes',async t=>{
  let calls=0,complete;
  const {kb,get,create}=setup(t,(bin,args,opts,cb)=>{calls++;assert.equal(bin,'python');assert.equal(args[4],'design');complete=cb;});
  const p=await create('SPY design');
  const file=path.join(kb,'strategies',p.id,'1.0.0.proposal.json');fs.writeFileSync(file,'first');
  const first=get('/workspaces/'+p.id+'/strategy?view=design'),second=get('/workspaces/'+p.id+'/strategy?view=design');
  assert.equal(calls,1);complete(null,JSON.stringify({current:{ref:'first'},integrity_failed:[]}));
  assert.deepEqual(await first,await second);
  assert.equal((await get('/workspaces/'+p.id+'/strategy?view=design')).current.ref,'first');assert.equal(calls,1);
  const stat=fs.statSync(file);fs.writeFileSync(file,'other');fs.utimesSync(file,stat.atime,stat.mtime);
  const changed=get('/workspaces/'+p.id+'/strategy?view=design');assert.equal(calls,2);
  complete(Object.assign(new Error('integrity'),{code:3}),JSON.stringify({current:null,integrity_failed:['tampered']}));
  assert.deepEqual((await changed).integrity_failed,['tampered']);
  const approval=path.join(kb,'strategies',p.id,'1.0.0.approval.json');fs.writeFileSync(approval,'new approval');
  const fresh=get('/workspaces/'+p.id+'/strategy?view=design');assert.equal(calls,3);complete(null,JSON.stringify({current:{ref:'new approval'},integrity_failed:[]}));await fresh;
});
test('read failures retry; editing while reading never caches the previous design',async t=>{
  let complete,calls=0;
  const {kb,get,create}=setup(t,(bin,args,opts,cb)=>{calls++;complete=cb;});const p=await create('IWM design');
  const url='/workspaces/'+p.id+'/strategy?view=design';
  const failed=get(url);complete(new Error('failure'),'bad json');await assert.rejects(failed,/harness/);
  const changed=get(url);const file=path.join(kb,'strategies',p.id,'1.0.0.proposal.json');fs.writeFileSync(file,'saved while reading');
  complete(null,JSON.stringify({current:{ref:'old'},integrity_failed:[]}));await assert.rejects(changed,/cambió/);
  const retry=get(url);assert.equal(calls,3);complete(null,JSON.stringify({current:{ref:'new'},integrity_failed:[]}));assert.equal((await retry).current.ref,'new');
  fs.unlinkSync(file);const deleted=get(url);assert.equal(calls,4);complete(null,JSON.stringify({current:null,integrity_failed:[]}));assert.equal((await deleted).current,null);
});
test('different projects do not share cached results; SHADOW uses original project reader',async t=>{
  const argsSeen=[];const {get,create}=setup(t,(bin,args,opts,cb)=>{argsSeen.push(args);cb(null,JSON.stringify({current:{ref:args[5]},integrity_failed:[]}));});
  const a=await create('SPY design'),b=await create('IWM design');
  assert.notEqual((await get('/workspaces/'+a.id+'/strategy?view=design')).current.ref,(await get('/workspaces/'+b.id+'/strategy?view=design')).current.ref);
  await get('/workspaces/'+a.id+'/strategy');assert.equal(argsSeen[2][4],'show');
});
