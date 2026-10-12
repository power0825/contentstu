import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createVideo} from './video.mjs';
import {createAuth} from './auth.mjs';
import {createAdmin} from './admin.mjs';
import {createLibrary} from './library.mjs';
import {createTextStudio} from './text.mjs';
import {createPromptSettings} from './prompts.mjs';
import {createCosts} from './costs.mjs';
import {DEFAULT_CONFIG,RATIOS} from '../shared/defaults.mjs';
class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const text=(v,max,label,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw new AppError(`Check ${label} (maximum ${max.toLocaleString()} characters).`);return v.trim();};
export function createApp({dataDir=join(process.cwd(),'data'),env=process.env,fetcher=fetch}={}){
 mkdirSync(join(dataDir,'images'),{recursive:true});const db=new DatabaseSync(join(dataDir,'studio.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
 const auth=createAuth(db,{secureCookies:env.COOKIE_SECURE==='true',adminIdentifier:env.ADMIN_USERNAME||'admin',adminPassword:env.ADMIN_PASSWORD||'12345678'});
 db.exec(`CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY,name TEXT NOT NULL,rules TEXT NOT NULL,skill TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,mime TEXT NOT NULL,name TEXT NOT NULL,created_at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS assets_user ON assets(user_id);
CREATE TABLE IF NOT EXISTS generations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,prompt TEXT NOT NULL,brief TEXT NOT NULL,ratio TEXT NOT NULL,reference_id TEXT NOT NULL,result_id TEXT,status TEXT NOT NULL,error TEXT,config TEXT NOT NULL,created_at TEXT NOT NULL,session_id TEXT NOT NULL DEFAULT '');CREATE INDEX IF NOT EXISTS history_user ON generations(user_id,created_at);
CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY,count INTEGER NOT NULL DEFAULT 0,prompts INTEGER NOT NULL DEFAULT 0);`);
 if(!new Set(db.prepare('PRAGMA table_info(generations)').all().map(c=>c.name)).has('session_id'))db.exec("ALTER TABLE generations ADD COLUMN session_id TEXT NOT NULL DEFAULT ''");
 const limit=()=>Math.max(1,Math.min(1000,Number(env.DAILY_IMAGE_LIMIT)||20));
 function owned(id,user){const row=db.prepare('SELECT * FROM assets WHERE id=? AND user_id=?').get(id,user);if(!row)throw new AppError('Reference image was not found in your workspace.',404);return row;}
 function dataUrl(id,user){const a=owned(id,user);return `data:${a.mime};base64,${readFileSync(join(dataDir,'images',a.id)).toString('base64')}`;}
 function saveAsset(user,bytes,mime,name){const id=randomUUID(),path=join(dataDir,'images',id);writeFileSync(path,bytes);try{db.prepare('INSERT INTO assets VALUES(?,?,?,?,?)').run(id,user,mime,name,new Date().toISOString());}catch(e){unlinkSync(path);throw e;}return id;}
 function reserve(user,kind){const id=user+':'+new Date().toISOString().slice(0,10);const field=kind==='image'?'count':'prompts';db.prepare('INSERT OR IGNORE INTO usage(id,count,prompts) VALUES(?,0,0)').run(id);if(!db.prepare(`UPDATE usage SET ${field}=${field}+1 WHERE id=? AND ${field}<? RETURNING id`).get(id,kind==='image'?limit():100))throw new AppError(`Your daily ${kind} allowance has been reached.`,429);return id;}
 function refund(id,kind){const field=kind==='image'?'count':'prompts';db.prepare(`UPDATE usage SET ${field}=MAX(0,${field}-1) WHERE id=?`).run(id);}
 async function provider(path,payload,timeout){if(!env.VOLCENGINE_API_KEY)throw new AppError('The instructor has not connected the models yet. You can save your agent configuration now.',503);let r;try{r=await fetcher('https://ark.cn-beijing.volces.com/api/v3/'+path,{method:'POST',headers:{Authorization:'Bearer '+env.VOLCENGINE_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(path==='chat/completions'?{...payload,thinking:{type:'disabled'}}:payload),signal:AbortSignal.timeout(timeout)});}catch(e){console.error('Provider call failed: '+path+' (timeout '+timeout+'ms) '+((e&&e.name)||'')+' '+((e&&e.message)||'')+' '+((e&&e.cause&&(e.cause.code||e.cause.message))||''));throw new AppError('The model did not respond in time. Please try again later.',504);}if(!r.ok){await r.text();throw new AppError(r.status===401||r.status===403?'Model access was rejected. Ask the instructor to check the API key and model permissions.':r.status===429?'The model is busy or its quota is reached. Please try again later.':'The model rejected this request. Check the model ID, reference image and prompt.',502);}return r.json();}
 // Kept for the routes that still read the legacy agent record. It no longer feeds any prompt: every
 // module now takes its rules and Skill from prompt_settings, so a film prompt cannot inherit the
 // writing config and each module can be changed on its own.
 const profileFor=u=>db.prepare('SELECT name,rules,skill FROM profiles WHERE user_id=?').get(u)||DEFAULT_CONFIG;
 const costs=createCosts({db,env});
 const prompts=createPromptSettings(db);
 const video=createVideo({db,dataDir,env,fetcher,owned,dataUrl,saveAsset,provider,reserve,refund,profileFor,costs,prompts});
 const admin=createAdmin({db,dataDir,auth});
 const library=createLibrary({db,dataDir,saveAsset});
 const studio=createTextStudio({db,env,provider,reserve,refund,costs,prompts});
 async function handle(request,ip='local'){
  try{
   const url=new URL(request.url),path=url.pathname;
   if(request.method!=='GET'){const origin=request.headers.get('origin');if(origin&&origin!==url.origin)throw new AppError('Request origin is not allowed.',403);}
   if(path.startsWith('/api/auth/'))return await auth.handle(request,ip);
   const user=await auth.user(request);if(!user)throw new AppError('Sign in to use your workspace.',401);
   if(user.status!=='approved')throw new AppError(user.status==='pending'?'Your account is still waiting for administrator approval.':'Your account request was declined.',403);
   if(path==='/api/admin')return await admin.handle(request,user);
   if(path==='/api/library'||path.startsWith('/api/library/image/'))return await library.handle(request,user);
   if(path==='/api/text')return await studio.handle(request,user);
   if(path==='/api/prompts'){const out=await prompts.handle(request,user);return json(out.body,out.status);}
   if(path==='/api/costs')return await costs.handle(request,user);
   if(path==='/api/video'||path==='/api/video/upload')return json(await video.handle(request,user.id));
   if(path==='/api/studio'&&request.method==='GET'){
    const profile=db.prepare('SELECT name,rules,skill FROM profiles WHERE user_id=?').get(user.id)||DEFAULT_CONFIG;
    const history=db.prepare('SELECT id,prompt,brief,ratio,reference_id,result_id,status,error,created_at FROM generations WHERE user_id=? ORDER BY created_at DESC LIMIT 60').all(user.id);
    const usage=db.prepare('SELECT count FROM usage WHERE id=?').get(user.id+':'+new Date().toISOString().slice(0,10));
    return json({profile,history,connection:{text:!!(env.VOLCENGINE_API_KEY&&env.VOLCENGINE_TEXT_MODEL),image:!!env.VOLCENGINE_API_KEY,video:!!env.BAILIAN_API_KEY},remaining:Math.max(0,limit()-(usage?.count||0)),limit:limit()});
   }
   if(path.startsWith('/api/assets/')&&request.method==='GET'){
    const a=owned(path.slice(12),user.id);const bytes=readFileSync(join(dataDir,'images',a.id));const headers={'Content-Type':a.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes',...(url.searchParams.has('download')?{'Content-Disposition':`attachment; filename="${a.mime==='video/mp4'?'video.mp4':a.mime==='audio/mpeg'?'music.mp3':a.mime==='audio/wav'?'music.wav':a.mime==='image/png'?'image.png':a.mime==='image/webp'?'image.webp':'image.jpg'}"`}:{})};
    const range=request.headers.get('range');if(range&&(a.mime.startsWith('video/')||a.mime.startsWith('audio/'))){const match=/^bytes=(\d*)-(\d*)$/.exec(range);let start,end;if(match&&(match[1]||match[2])){if(match[1]){start=Number(match[1]);end=match[2]?Number(match[2]):bytes.length-1;}else{start=Math.max(0,bytes.length-Number(match[2]));end=bytes.length-1;}}if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=bytes.length||end<start)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${bytes.length}`}});end=Math.min(end,bytes.length-1);return new Response(bytes.subarray(start,end+1),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}});}
    return new Response(bytes,{headers:{...headers,'Content-Length':String(bytes.length)}});
   }
   if(path==='/api/upload'&&request.method==='POST'){
    const f=(await request.formData()).get('file');if(!(f instanceof File)||!f.size||f.size>8*1024*1024)throw new AppError('Upload a JPG, PNG or WebP image under 8 MB.');const bytes=Buffer.from(await f.arrayBuffer());let mime='';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')mime='image/webp';if(!mime)throw new AppError('Only JPG, PNG and WebP images are supported.');return json({id:saveAsset(user.id,bytes,mime,f.name.slice(0,180))});
   }
   if(path!=='/api/studio'||request.method!=='POST')throw new AppError('Not found.',404);
   const b=await request.json();if(b.action==='settings'){
    db.prepare('INSERT INTO profiles VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,rules=excluded.rules,skill=excluded.skill,updated_at=excluded.updated_at').run(user.id,text(b.name,80,'agent name',true),text(b.rules,12000,'instructions'),text(b.skill,20000,'skill'),new Date().toISOString());return json({ok:true});
   }
   if(!['prepare','generate'].includes(b.action))throw new AppError('Unknown action.');const ref=text(b.referenceId,100,'reference',true);owned(ref,user.id);const ratio=text(b.ratio,10,'ratio',true);if(!RATIOS[ratio])throw new AppError('Choose a supported image ratio.');
   // Recorded with the generation, so it has to be the config that was actually used: the image module's
   // own rules and Skill from prompt_settings, not the old shared profiles row.
   const values=prompts.values(user.id);const profile={name:DEFAULT_CONFIG.name,rules:values.raw('image.agentRules'),skill:values.raw('image.agentSkill')};
   // One session spans "prepare prompt" and "generate image" so both costs land in the same group.
   const session=text(b.sessionId||randomUUID(),80,'session')||randomUUID();
   if(b.action==='prepare'){
    if(!env.VOLCENGINE_TEXT_MODEL)throw new AppError('The instructor needs to configure the language model ID before prompt preparation.',503);
    const brief=text(b.brief,4000,'creative brief',true),application=text(b.application||'',200,'application'),presentation=text(b.presentation||'',100,'presentation'),previous=text(b.previousPrompt||'',12000,'previous prompt');const quota=reserve(user.id,'prompt');
    try{const out=await provider('chat/completions',{model:env.VOLCENGINE_TEXT_MODEL,messages:[{role:'system',content:values.module('image.prepare')},{role:'user',content:[{type:'text',text:`Application: ${application}\nPresentation: ${presentation}\nAspect ratio: ${ratio}\nBrief or revision: ${brief}\nPrevious prompt: ${previous||'None'}\nUse the reference for product identity, color and texture.`},{type:'image_url',image_url:{url:dataUrl(ref,user.id)}}]}],max_tokens:1800},90000);const prompt=out.choices?.[0]?.message?.content;if(typeof prompt!=='string'||!prompt.trim())throw new AppError('No usable prompt was returned.',502);costs.recordText({userId:user.id,stage:'Prompt preparation',model:env.VOLCENGINE_TEXT_MODEL,groupId:session,groupKind:'image',groupLabel:brief,usage:out.usage,chars:prompt.length});return json({prompt:prompt.trim(),sessionId:session});}catch(e){refund(quota,'prompt');throw e;}
   }
   const prompt=text(b.prompt,12000,'image prompt',true),brief=text(b.brief||'',4000,'brief');const quota=reserve(user.id,'image');const id=randomUUID();let recorded=false;
   try{db.prepare('INSERT INTO generations(id,user_id,prompt,brief,ratio,reference_id,status,config,created_at,session_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,user.id,prompt,brief,ratio,ref,'generating',JSON.stringify(profile),new Date().toISOString(),session);recorded=true;const images=[dataUrl(ref,user.id)];if(b.originalReferenceId&&b.originalReferenceId!==ref)images.push(dataUrl(text(b.originalReferenceId,100,'original reference',true),user.id));const out=await provider('images/generations',{model:env.VOLCENGINE_IMAGE_MODEL||'doubao-seedream-4-5-251128',prompt,image:images.length===1?images[0]:images,size:RATIOS[ratio],response_format:'b64_json',stream:false,watermark:true,sequential_image_generation:'disabled'},180000);const encoded=out.data?.[0]?.b64_json;if(typeof encoded!=='string'||!encoded||encoded.length>40000000)throw new AppError('The model did not return a usable image.',502);const bytes=Buffer.from(encoded,'base64');const mime=bytes[0]===137?'image/png':'image/jpeg';const resultId=saveAsset(user.id,bytes,mime,'generated-'+id);db.prepare("UPDATE generations SET status='complete',result_id=? WHERE id=? AND user_id=?").run(resultId,id,user.id);costs.recordImage({userId:user.id,stage:'Image generation',model:env.VOLCENGINE_IMAGE_MODEL||'doubao-seedream-4-5-251128',groupId:session,groupKind:'image',groupLabel:brief||prompt.slice(0,120),size:RATIOS[ratio]});return json({id,resultId,sessionId:session});}catch(e){refund(quota,'image');if(recorded)db.prepare("UPDATE generations SET status='failed',error=? WHERE id=? AND user_id=?").run(e instanceof AppError?e.message:'Generation failed. Please try again.',id,user.id);throw e;}
  }catch(e){if(e instanceof AppError||Number.isInteger(e.status))return json({error:e.message},e.status);if(e instanceof SyntaxError)return json({error:'The request could not be read.'},400);console.error('Studio request failed:',e.name);return json({error:'Something went wrong. Your inputs are still here. Please try again.'},500);}
 }
 return {handle,close:()=>{video.close();db.close();}};
}
