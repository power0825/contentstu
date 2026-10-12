import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createApp} from '../server/app.mjs';
test('standalone profiles and images remain private and survive reopening',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'image-studio-'));let app=createApp({dataDir:dir,env:{}});
 const request=(path,body,cookie)=>new Request('http://localhost:5173'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const register=async email=>{const r=await app.handle(request('/api/auth/register',{email,password:'Classroom123!'}));assert.equal(r.status,201);return r.headers.get('set-cookie').split(';')[0];};
 try{
 assert.equal((await app.handle(request('/api/studio'))).status,401);const a=await register('a@example.com'),b=await register('b@example.com');
 let r=await app.handle(request('/api/studio',{action:'settings',name:'Furniture Agent',rules:'Keep product shape.',skill:'# Interior scenes'},a));assert.equal(r.status,200);
 assert.equal((await (await app.handle(request('/api/studio',null,a))).json()).profile.name,'Furniture Agent');assert.notEqual((await (await app.handle(request('/api/studio',null,b))).json()).profile.name,'Furniture Agent');
 const form=new FormData();form.append('file',new File([Uint8Array.from([137,80,78,71,13,10,26,10])],'sample.png',{type:'image/png'}));r=await app.handle(new Request('http://localhost:5173/api/upload',{method:'POST',headers:{Cookie:a},body:form}));assert.equal(r.status,200);const id=(await r.json()).id;
 assert.equal((await app.handle(request('/api/assets/'+id,null,a))).status,200);assert.equal((await app.handle(request('/api/assets/'+id,null,b))).status,404);
 r=await app.handle(request('/api/studio',{action:'generate',referenceId:id,ratio:'1:1',prompt:'A chair',brief:'QA'},a));assert.equal(r.status,503);const state=await (await app.handle(request('/api/studio',null,a))).json();assert.equal(state.remaining,state.limit);assert.equal(state.history[0].status,'failed');
 app.close();app=createApp({dataDir:dir,env:{}});assert.equal((await (await app.handle(request('/api/studio',null,a))).json()).profile.name,'Furniture Agent');
 }finally{app.close();rmSync(dir,{recursive:true,force:true});}
});

test('model preparation and image revisions use the signed-in profile and references',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'image-studio-provider-'));const calls=[];const bytes=Buffer.from([137,80,78,71,13,10,26,10]);
 const app=createApp({dataDir:dir,env:{VOLCENGINE_API_KEY:'test-only',VOLCENGINE_TEXT_MODEL:'text-test',VOLCENGINE_IMAGE_MODEL:'image-test'},fetcher:async(url,options)=>{calls.push({url,payload:JSON.parse(options.body)});return Response.json(url.endsWith('chat/completions')?{choices:[{message:{content:'A chair in a bright living room.'}}]}:{data:[{b64_json:bytes.toString('base64')}]});// Simulated provider only; no remote call.
 }});
 const req=(body,cookie)=>new Request('http://localhost:5173/api/studio',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
 try{
 let r=await app.handle(new Request('http://localhost:5173/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'model@example.com',password:'Classroom123!'})}));const cookie=r.headers.get('set-cookie').split(';')[0];
 await app.handle(req({action:'settings',name:'Furniture Agent',rules:'Keep furniture shape.',skill:'# Furniture scenes'},cookie));const form=new FormData();form.append('file',new File([bytes],'ref.png',{type:'image/png'}));r=await app.handle(new Request('http://localhost:5173/api/upload',{method:'POST',headers:{Cookie:cookie},body:form}));const ref=(await r.json()).id;
 r=await app.handle(req({action:'prepare',referenceId:ref,ratio:'16:9',brief:'Chair in living room',application:'Chair',presentation:'Lifestyle scene'},cookie));assert.equal(r.status,200);const prompt=(await r.json()).prompt;assert.match(calls[0].payload.messages[0].content,/Furniture scenes/);
 r=await app.handle(req({action:'generate',referenceId:ref,ratio:'16:9',brief:'Chair',prompt},cookie));assert.equal(r.status,200);const generated=(await r.json()).resultId;assert.equal(calls[1].payload.size,'2560x1440');assert.ok(generated);
 r=await app.handle(req({action:'generate',referenceId:generated,originalReferenceId:ref,ratio:'1:1',brief:'Change background',prompt:'Change the background only'},cookie));assert.equal(r.status,200);assert.equal(calls[2].payload.image.length,2);
 }finally{app.close();rmSync(dir,{recursive:true,force:true});}
});
