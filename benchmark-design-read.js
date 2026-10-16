// Read-only benchmark against a copy of canonical local files. No server/model/market call.
const fs=require('fs'),path=require('path'),{execFile}=require('child_process');
const {createWorkspaces}=require('./lab-workspaces');
async function main(){
  const root=process.cwd(),name='iwm_prima_condor_30_45d';
  const base=path.join(root,'.tmp','design-read-benchmark'),kb=path.join(base,'knowledge'),local=path.join(base,'local');
  const source=path.join(root,'knowledge','strategies',name),dest=path.join(kb,'strategies',name);
  fs.mkdirSync(dest,{recursive:true});fs.mkdirSync(local,{recursive:true});
  for(const file of fs.readdirSync(source).filter(f=>/\.(proposal|approval|critique)\.json$/.test(f)))fs.copyFileSync(path.join(source,file),path.join(dest,file));
  let calls=0;
  const service=createWorkspaces({root,kb,local,binaries:{},legacySessions:()=>[],
    legacyProjects:()=>[{id:name,label:'IWM snapshot',dir:dest,relative:'strategies/'+name}],
    environment:()=>({...process.env,PYTHONPATH:path.join(root,'.worktrees','galecore-ai','WS-0028-design','src'),GALECORE_KNOWLEDGE_DIR:kb,GALECORE_BASE_URL:'http://127.0.0.1:1'}),
    execute:(...args)=>{calls++;return execFile(...args);}});
  const timings=[];let current;
  for(let i=0;i<3;i++){
    const start=performance.now();await service.route({method:'GET'},{},new URL('/workspaces/'+name+'/strategy?view=design','http://localhost'),(r,s,value)=>{current=value;},async()=>({}));
    timings.push(Math.round((performance.now()-start)*1000)/1000);
  }
  if(!current.current||current.integrity_failed.length||calls!==1)throw new Error('Unexpected read result');
  const result={timings_ms:timings,python_processes:calls,ref:current.current.ref,scope:'Service route against copied real canonical files, unavailable market API; no HTTP authentication/E2E.'};
  fs.writeFileSync(path.join(root,'.tmp','design-read-after.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
