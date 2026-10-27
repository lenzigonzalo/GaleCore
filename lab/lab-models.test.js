const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { modelOptions, selection, modelFlags } = require('./lab-models');
const { createWorkspaces } = require('./lab-workspaces');

function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-lab-models-'));
  t.after(() => { assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'gc-lab-models-')); fs.rmSync(dir, { recursive:true, force:true }); });
  fs.mkdirSync(path.join(dir, 'GaleCore-AI')); fs.writeFileSync(path.join(dir, 'GaleCore-AI', 'PRODUCT.md'), 'núcleo de test');
  return dir;
}
async function route(service, method, url, body) {
  let result;
  await service.route({ method }, {}, new URL(url, 'http://localhost'), (_, status, value) => { result={status,value}; }, async () => body);
  return result;
}
test('model catalogue comes from visible CLI cache entries; no credentials are exposed', t => {
  const dir=folder(t); fs.mkdirSync(path.join(dir,'.codex'));
  fs.writeFileSync(path.join(dir,'.codex','models_cache.json'), JSON.stringify({ identity:'private-fixture', models:[
    {slug:'visible-model',visibility:'list',supported_reasoning_levels:[{effort:'high'}]},
    {slug:'internal-model',visibility:'hide'},
  ]}));
  const options=modelOptions(dir);
  assert.deepEqual(options.codex.models,['visible-model']);
  assert.deepEqual(options.codex.modelEfforts['visible-model'],['high']);
  assert.equal(JSON.stringify(options).includes('private-fixture'),false);
  assert.deepEqual(modelOptions(path.join(dir,'missing')).codex.models,[]);
});
test('provider-specific native CLI flags preserve the selected model and effort', () => {
  assert.deepEqual(modelFlags({provider:'claude',model:'opus',effort:'high'}),['--model','opus','--effort','high']);
  assert.deepEqual(modelFlags({provider:'codex',model:'chosen-model',effort:'high'}),['--model','chosen-model','-c','model_reasoning_effort="high"']);
  assert.deepEqual(modelFlags({provider:'claude',model:'haiku',effort:'medium'}),['--model','haiku']);
  assert.throws(()=>selection('claude',{model:'--bad'}),/inválido/);
  assert.throws(()=>selection('claude',{model:{}}),/inválido/);
  assert.throws(()=>selection('codex',{model:'valid',effort:'bad'}),/inválido/);
});
test('new chats reject cross-provider models and unsupported model efforts', () => {
  const catalog={claude:{models:['opus','haiku'],efforts:['medium','high'],modelEfforts:{haiku:[]}},codex:{models:['gpt-fixture'],efforts:['high'],modelEfforts:{'gpt-fixture':['high']}}};
  assert.throws(()=>selection('codex',{model:'opus'},catalog),/proveedor/);
  assert.throws(()=>selection('claude',{model:'gpt-fixture'},catalog),/proveedor/);
  assert.throws(()=>selection('codex',{model:'gpt-fixture',effort:'ultra'},catalog),/Esfuerzo/);
  assert.throws(()=>selection('claude',{model:'haiku',effort:'high'},catalog),/Esfuerzo/);
  assert.deepEqual(selection('codex',{model:'gpt-fixture',effort:'high'},catalog),{model:'gpt-fixture',effort:'high'});
});
test('legacy fallback is persisted once and survives environment default changes', async t => {
  const dir=folder(t),kb=path.join(dir,'knowledge'),local=path.join(dir,'local');fs.mkdirSync(kb);fs.mkdirSync(local);
  const original=process.env.GALECORE_LAB_MODEL;
  t.after(()=>{if(original===undefined)delete process.env.GALECORE_LAB_MODEL;else process.env.GALECORE_LAB_MODEL=original;});
  const children=[],models=[];
  const service=createWorkspaces({root:dir,kb,local,binaries:{claude:'fixture'},environment:()=>({}),instructions:()=>'',legacyProjects:()=>[],legacySessions:()=>[],spawnProcess:(_,args)=>{models.push(args[args.indexOf('--model')+1]);const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin={end:()=>{}};c.kill=()=>{};children.push(c);return c;}});
  const id='11111111-1111-1111-1111-111111111111';
  fs.writeFileSync(path.join(local,'chats',id+'.json'),JSON.stringify({id,project:'personal',provider:'claude',title:'Legacy',state:'idle',messages:[]}));
  process.env.GALECORE_LAB_MODEL='sonnet';
  await route(service,'POST','/chats/'+id+'/messages',{text:'first'});children[0].emit('close',0);
  process.env.GALECORE_LAB_MODEL='opus';
  await route(service,'POST','/chats/'+id+'/messages',{text:'second'});children[1].emit('close',0);
  assert.deepEqual(models,['sonnet','sonnet']);
  assert.equal((await route(service,'GET','/chats/'+id)).value.selectionSource,'legacy-fallback');
});
test('chat selection persists, reaches the spawned process, and cannot be changed by message payload', async t => {
  const dir=folder(t),kb=path.join(dir,'knowledge'),local=path.join(dir,'local'); fs.mkdirSync(kb);fs.mkdirSync(local);
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={end:()=>{}};child.kill=()=>{};
  let captured;
  const service=createWorkspaces({root:dir,kb,local,binaries:{claude:'fixture'},environment:()=>({}),instructions:()=>'',legacyProjects:()=>[],legacySessions:()=>[],spawnProcess:(bin,args)=>{captured=args;return child;}});
  const created=await route(service,'POST','/chats',{project:'personal',provider:'claude',model:'opus',effort:'high'});
  assert.equal(created.value.model,'opus');
  await route(service,'POST','/chats/'+created.value.id+'/messages',{text:'fixture',model:'haiku'});
  assert.equal(captured[captured.indexOf('--model')+1],'opus');
  assert.equal(captured[captured.indexOf('--effort')+1],'high');
  assert.ok(captured.includes('--strict-mcp-config'));
  child.emit('close',0);
  const loaded=await route(service,'GET','/chats/'+created.value.id);
  assert.equal(loaded.value.model,'opus');
  assert.equal(loaded.value.effort,'high');
});
