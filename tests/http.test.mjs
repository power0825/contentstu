import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
test('npm run dev serves the frontend and independent login API on one port',async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'studio-http-'));const port=5279,base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server/start.mjs'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:dataDir},stdio:['ignore','pipe','pipe']});
 let logs='';const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timed out: '+logs)),30000);child.stdout.on('data',chunk=>{logs+=chunk;if(logs.includes('is ready at')){clearTimeout(timer);resolve();}});child.stderr.on('data',chunk=>logs+=chunk);child.on('exit',code=>{clearTimeout(timer);reject(new Error('Server exited: '+code+' '+logs));});});
 try{await ready;
 let r=await fetch(base+'/');assert.equal(r.status,200);assert.match(await r.text(),/src\/main.tsx/);
 r=await fetch(base+'/src/main.tsx');assert.equal(r.status,200);assert.match(await r.text(),/Create your account/);
 r=await fetch(base+'/src/styles.css');assert.equal(r.status,200);
 r=await fetch(base+'/api/auth/me');assert.equal(r.status,200);assert.equal((await r.json()).user,null);
 r=await fetch(base+'/api/studio',{headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'forged@test.invalid'}});assert.equal(r.status,401);
 r=await fetch(base+'/data/studio.sqlite');assert.equal(r.status,403,'Development server must not serve the database');
 r=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email:'http-'+Date.now()+'@example.com',password:'Classroom123!'})});assert.equal(r.status,201);const cookie=r.headers.get('set-cookie').split(';')[0];
 r=await fetch(base+'/api/studio',{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.equal((await r.json()).profile.name,'Fabric Application Agent');
 }finally{child.kill('SIGTERM');await once(child,'exit');rmSync(dataDir,{recursive:true,force:true});}
});
