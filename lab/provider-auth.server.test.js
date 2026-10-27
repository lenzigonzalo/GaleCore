const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const vm=require('vm');const path=require('path');const http=require('http');const {once}=require('events');const {WebSocket}=require('ws');const auth=require('./provider-auth');
test('HTTP and PTY enforce local origin and fixed authentication commands; simulated login only',async()=>{
 const launches=[];let killed=0;
 const fakePty={spawn:(binary,args,options)=>{launches.push({binary,args,cwd:options.cwd});return{pid:1,onData:()=>{},onExit:()=>{},write:()=>{},resize:()=>{},kill:()=>{killed++;}};}};
 const fakeAuth={...auth,providerBinary:id=>'/fixed/'+id,authStatus:async id=>({id,status:'signed-out'})};
 const sandbox={require:id=>id==='@lydell/node-pty'?fakePty:id==='./provider-auth'?fakeAuth:require(id),__dirname:__dirname,process:{...process,env:{...process.env,GALECORE_TERMINAL_PORT:'18770'}},console:{log:()=>{}},URL};
 const code=fs.readFileSync(path.join(__dirname,'server.js'),'utf8').replace(/server\.listen\(PORT,[\s\S]*$/,'server.listen(0, "127.0.0.1"); globalThis.server=server;');
 vm.runInNewContext(code,sandbox);await once(sandbox.server,'listening');const port=sandbox.server.address().port;
 const get=(origin,host='127.0.0.1:18770')=>new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path:'/auth/status',headers:{Host:host,...(origin?{Origin:origin}:{})}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);});
 const sockets=[];
 try{
  assert.equal((await get()).status,403);assert.equal((await get('https://other.invalid')).status,403);assert.equal((await get('http://localhost:3039','remote.invalid')).status,403);
  const status=await get('http://localhost:3039');assert.equal(status.status,200);assert.deepEqual(JSON.parse(status.body),{providers:[{id:'claude',status:'signed-out'},{id:'codex',status:'signed-out'}]});
  const connect=params=>{const socket=new WebSocket(`ws://127.0.0.1:${port}/pty?${params}`,{headers:{Host:'127.0.0.1:18770',Origin:'http://localhost:3039'}});sockets.push(socket);return socket;};
  const invalid=connect('auth=codex%3Bcmd');const [invalidCode]=await once(invalid,'close');assert.equal(invalidCode,4000);assert.equal(launches.length,0);
  const first=connect('auth=codex&prompt=run-unrelated-command');await once(first,'open');assert.equal(launches.length,1);assert.deepEqual(Array.from(launches[0].args),['login']);assert.equal(launches[0].binary,'/fixed/codex');
  const second=connect('auth=codex');const [duplicateCode]=await once(second,'close');assert.equal(duplicateCode,4009);assert.equal(launches.length,1);
  first.close();await once(first,'close');await new Promise(resolve=>setTimeout(resolve,10));assert.equal(killed,1);
  const claude=connect('auth=claude');await once(claude,'open');assert.deepEqual(Array.from(launches[1].args),['auth','login']);claude.close();await once(claude,'close');
 }finally{for(const socket of sockets)socket.terminate();await new Promise(resolve=>sandbox.server.close(resolve));}
});
