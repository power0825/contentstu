import {RATIOS} from '../shared/defaults.mjs';
import {extractJson} from './jsonish.mjs';
import {officialBlock,companyBlock} from './facts.mjs';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
export function runProcess(bin,args,opts={}){return new Promise((ok,no)=>{const p=spawn(bin,args,{...opts,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>{err=(err+d).slice(-6000);});p.on('error',()=>no(new Error('FFmpeg is unavailable. Install FFmpeg and set FFMPEG_PATH / FFPROBE_PATH.')));const timer=setTimeout(()=>{p.kill();no(new Error('Media processing timed out.'));},180000);p.on('close',c=>{clearTimeout(timer);c===0?ok(out):no(new Error('Media processing failed. Check the uploaded video/audio and FFmpeg installation. '+err.slice(-400)));});});}
const dimensions={'16:9':[1280,720],'9:16':[720,1280],'1:1':[720,720]};
const captionPresets={
 fine:{font:'Segoe UI Semibold',size:4.7,weight:-1,spacing:0.6,outline:2.2,shadow:1.2,mv:7.5,box:0},
 box:{font:'Segoe UI Semibold',size:4.2,weight:-1,spacing:0.4,outline:13,shadow:0,mv:6.4,box:1,boxColor:'&H88000000'},
 editorial:{font:'Segoe UI',size:3.8,weight:-1,spacing:4.5,outline:2.4,shadow:0.8,mv:8.6,box:0,upper:true},
 serif:{font:'Georgia',size:4.6,weight:0,spacing:0.8,outline:1.8,shadow:1.4,mv:7.8,box:0}
};
const assColor=v=>{const m=/^#?([0-9a-fA-F]{6})$/.exec(String(v||'').trim());return m?`&H00${m[1].slice(4,6)}${m[1].slice(2,4)}${m[1].slice(0,2)}`.toUpperCase():'';};
const assTime=t=>{const cs=Math.max(0,Math.round(t*100)),pad=n=>String(n).padStart(2,'0');return `${Math.floor(cs/360000)}:${pad(Math.floor(cs/6000)%60)}:${pad(Math.floor(cs/100)%60)}.${pad(cs%100)}`;};
const assText=t=>String(t||'').replace(/[\\{}]/g,'').replace(/\r?\n/g,'\\N').trim();
function assScript(w,h,env,items,styleKey){
 if(!items.length)return '';
 const p={...captionPresets[(limited(styleKey,20)||limited(env.CAPTION_STYLE,20)).toLowerCase()]||captionPresets.fine};
 const positive=(v,d)=>{const n=Number(v);return Number.isFinite(n)&&n>0?n:d;};
 const switchOn=(v,d)=>v===undefined||v===''?d:/^(1|true|yes|on)$/i.test(String(v).trim());
 // Chinese captions need a font that actually has the glyphs. The Latin presets above are chosen
 // for shape, and none of them carries CJK, so the moment a caption contains Chinese characters
 // the style switches to the CJK family. See the font install in the Dockerfile.
 const cjk=/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/.test(items.map(c=>String(c.text||'')).join(''));
 const font=limited(cjk?env.CAPTION_FONT_CJK:env.CAPTION_FONT,60)||(cjk?'Noto Sans CJK SC':p.font);
 const scale=h/720,margin=Math.round(w*0.055);
 const size=Math.round(h*positive(env.CAPTION_SIZE,p.size)/100),mv=Math.round(h*positive(env.CAPTION_BOTTOM,p.mv)/100);
 const outline=p.box?Math.max(6,Math.round(p.outline*scale)):Math.max(1,+(p.outline*scale).toFixed(2));
 const shadow=p.box?0:Math.max(0,+(p.shadow*scale).toFixed(2));
 const colour=assColor(env.CAPTION_COLOR)||'&H00FFFFFF',boxColour=p.box?p.boxColor:'&H00000000';
 const upper=switchOn(env.CAPTION_UPPERCASE,!!p.upper);
 const lines=items.map(c=>{const text=assText(c.text);return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,,0,0,0,,{\\fad(200,200)}${upper?text.toUpperCase():text}`;}).join('\n');
 return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Cap,${font},${size},${colour},${colour},${boxColour},${boxColour},${p.weight},0,0,0,100,100,${p.spacing},0,${p.box?3:1},${outline},${shadow},2,${margin},${margin},${mv},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines}\n`;
}
const limited=(v,n=4000)=>typeof v==='string'?v.trim().slice(0,n):'';
const fail=(m,s=400)=>{const e=new Error(m);e.status=s;throw e;};
const safe=(v)=>limited(v,100);
const active=s=>['submitting','pending','running','downloading'].includes(s);
export function createVideo({db,dataDir,env,fetcher,owned,dataUrl,saveAsset,provider,credsFor,languageFor,reserve,refund,profileFor,costs,prompts}){
 db.exec(`CREATE TABLE IF NOT EXISTS video_projects(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,document TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS video_jobs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,project_id TEXT NOT NULL,shot_id TEXT NOT NULL,task_id TEXT,status TEXT NOT NULL,asset_id TEXT,error TEXT,created_at TEXT NOT NULL,last_poll INTEGER DEFAULT 0,costed INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS video_usage(id TEXT PRIMARY KEY,count INTEGER DEFAULT 0);`);
 if(!new Set(db.prepare('PRAGMA table_info(video_jobs)').all().map(c=>c.name)).has('costed'))db.exec('ALTER TABLE video_jobs ADD COLUMN costed INTEGER NOT NULL DEFAULT 0');
 db.prepare("UPDATE video_jobs SET status='failed',error='Submission interrupted. Check your provider console before retrying.' WHERE status='submitting'").run();
 const locked=new Set(),polling=new Set(),exports=new Set();let closed=false;
 const now=()=>new Date().toISOString();
 const base=(env.BAILIAN_BASE_URL||'https://llm-zox3pv2a4xrvokvg.cn-beijing.maas.aliyuncs.com/api/v1').replace(/\/$/,'');
 function get(id,u){const row=db.prepare('SELECT document FROM video_projects WHERE id=? AND user_id=?').get(id,u);if(!row)fail('Video project not found.',404);return JSON.parse(row.document);}
 function put(p,u){db.prepare('INSERT INTO video_projects VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,updated_at=excluded.updated_at').run(p.id,u,JSON.stringify(p),now());}
 function decorate(p,u){return {...p,shots:p.shots.map(s=>{const j=db.prepare('SELECT * FROM video_jobs WHERE project_id=? AND shot_id=? AND user_id=? ORDER BY rowid DESC LIMIT 1').get(p.id,s.id,u);return {...s,status:j?.status||'draft',clipId:j?.asset_id||'',error:j?.error||'',taskId:j?.task_id||''};})};}
 function sanitize(raw,old,u){if(!raw||typeof raw!=='object')fail('Invalid project.');if(!Array.isArray(raw.shots)||raw.shots.length<1||raw.shots.length>6)fail('Use 1–6 shots.');const ids=new Set();let total=0;const shots=raw.shots.map(s=>{const id=safe(s.id);if(!old.shots.some(a=>a.id===id)||ids.has(id))fail('Invalid shot ID.');ids.add(id);const duration=Number(s.duration),trimStart=Number(s.trimStart||0);if(!Number.isInteger(duration)||duration<2||duration>15||!Number.isFinite(trimStart)||trimStart<0||trimStart>120)fail('Use 2–15 seconds per shot and a valid trim start.');total+=duration;
 for(const field of ['firstFrameId','lastFrameId'])if(s[field]){const a=owned(safe(s[field]),u);if(!a.mime.startsWith('image/'))fail('Choose an image for the frame.');}
 if(s.lastFrameId&&!s.firstFrameId)fail('A last frame requires a first frame.');return {id,title:limited(s.title,120),duration,trimStart,script:limited(s.script),imagePrompt:limited(s.imagePrompt,12000),lastImagePrompt:limited(s.lastImagePrompt,12000),videoPrompt:limited(s.videoPrompt,12000),caption:limited(s.caption,180),firstFrameId:safe(s.firstFrameId),lastFrameId:safe(s.lastFrameId)};});if(total>60)fail('Keep the timeline under 60 seconds.');
 const ratio=dimensions[raw.ratio]?raw.ratio:'16:9';for(const [field,type] of [['logoId','image/'],['musicId','audio/']])if(raw[field]&&!owned(safe(raw[field]),u).mime.startsWith(type))fail('Invalid '+field);
 // The attached product has to exist in the shared library, since it is where every fact the
 // film quotes comes from.
 const productId=safe(raw.productId);if(productId&&!db.prepare('SELECT id FROM products WHERE id=?').get(productId))fail('That product is not in the shared library.',404);
 return {...old,title:limited(raw.title,120),brief:limited(raw.brief,6000),productId,ratio,resolution:['480P','720P','1080P'].includes(raw.resolution)?raw.resolution:'720P',shots,brand:limited(raw.brand,100),endLine:limited(raw.endLine,180),music:['none','ambient','upload'].includes(raw.music)?raw.music:'none',musicId:safe(raw.musicId),logoId:safe(raw.logoId),transition:raw.transition==='fade'?'fade':'cut',subtitles:!!raw.subtitles,captionStyle:captionPresets[String(raw.captionStyle||'').toLowerCase()]?String(raw.captionStyle).toLowerCase():'',exportId:'',exportStatus:'idle',exportError:''};}
 async function bailian(path,body,creds){const key=(creds&&creds.key)||'';if(!key)fail('Connect your Bailian API key first, in Model settings.',503);const root=((creds&&creds.dashUrl)||base).replace(/\/+$/,'');let r;try{r=await fetcher(root+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json','X-DashScope-Async':'enable'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});}catch{fail('Bailian did not respond. Try checking the task status later.',504);}let d;try{d=await r.json();}catch{fail('Bailian returned an unreadable response.',502);}if(!r.ok||d.code)fail('Bailian: '+limited(d.message||d.code||`HTTP ${r.status}`,300),502);return d;}
 async function download(url){const x=new URL(url);if(x.protocol!=='https:'||!(/(^|\.)aliyuncs\.com$/.test(x.hostname)||/(^|\.)alibabacloud\.com$/.test(x.hostname)))fail('The provider returned an unsupported download host.',502);const r=await fetcher(url,{signal:AbortSignal.timeout(120000),redirect:'error'});if(!r.ok)fail('Could not download the completed video. Check status to retry.',502);if(Number(r.headers.get('content-length'))>150*1024*1024)fail('Generated video exceeds 150 MB.',502);const chunks=[];let n=0;for await(const chunk of r.body){n+=chunk.length;if(n>150*1024*1024)fail('Generated video exceeds 150 MB.',502);chunks.push(Buffer.from(chunk));}const b=Buffer.concat(chunks);if(b.subarray(4,8).toString()!=='ftyp')fail('Provider result was not an MP4.',502);return b;}
 async function pollJob(j,force=false){if(closed||polling.has(j.id)||!j.task_id||!active(j.status)||(!force&&Date.now()-j.last_poll<15000))return;polling.add(j.id);try{db.prepare('UPDATE video_jobs SET last_poll=? WHERE id=?').run(Date.now(),j.id);const creds=credsFor(j.user_id);const out=(await bailian('/tasks/'+encodeURIComponent(j.task_id),null,creds)).output;if(closed)return;if(!out?.task_status)fail('Invalid task response.',502);const status=out.task_status;
 if(status==='SUCCEEDED'){db.prepare("UPDATE video_jobs SET status='downloading' WHERE id=?").run(j.id);const bytes=await download(out.video_url);if(!closed){const asset=saveAsset(j.user_id,bytes,'video/mp4','wan-clip.mp4');db.prepare("UPDATE video_jobs SET status='complete',asset_id=?,error=NULL WHERE id=?").run(asset,j.id);if(!j.costed){let project=null;try{project=JSON.parse(db.prepare('SELECT document FROM video_projects WHERE id=?').get(j.project_id)?.document||'null');}catch{}const shot=project?.shots?.find(s=>s.id===j.shot_id);costs?.recordVideo({userId:j.user_id,stage:`Video clip — ${shot?.title||'shot'}`,model:creds.videoModel||'wan3.0-video',groupId:j.project_id,groupKind:'video',groupLabel:project?.title||'Video project',resolution:project?.resolution||'720P',seconds:Number(shot?.duration)||0});db.prepare('UPDATE video_jobs SET costed=1 WHERE id=?').run(j.id);}}}
 else if(['FAILED','CANCELED','UNKNOWN'].includes(status))db.prepare("UPDATE video_jobs SET status='failed',error=? WHERE id=?").run(limited(out.message||'Video task '+status,500),j.id);
 else db.prepare('UPDATE video_jobs SET status=?,error=NULL WHERE id=?').run(status==='RUNNING'?'running':'pending',j.id);
 }catch(e){if(!closed)db.prepare('UPDATE video_jobs SET error=? WHERE id=?').run(limited(e.message,500),j.id);}finally{polling.delete(j.id);}}
 const timer=setInterval(async()=>{if(closed)return;const jobs=db.prepare("SELECT * FROM video_jobs WHERE status IN ('pending','running','downloading') ORDER BY last_poll LIMIT 8").all();for(const j of jobs){if(closed)break;await pollJob(j);}},15000);timer.unref();
 db.prepare("SELECT id,user_id,document FROM video_projects").all().forEach(r=>{const p=JSON.parse(r.document);if(p.exportStatus==='rendering'){p.exportStatus='failed';p.exportError='Export was interrupted. Export again.';put(p,r.user_id);}});
 async function render(p,u){const work=join(dataDir,'render',randomUUID());mkdirSync(work,{recursive:true});const ff=env.FFMPEG_PATH||'ffmpeg',probe=env.FFPROBE_PATH||'ffprobe';const [w,h]=dimensions[p.ratio];let elapsed=0;const assCues=[];const stamp=t=>{const ms=Math.round(t*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
 try{for(let i=0;i<p.shots.length;i++){const s=p.shots[i];const file=join(dataDir,'images',owned(s.clipId,u).id);const meta=JSON.parse(await runProcess(probe,['-v','error','-show_format','-show_streams','-of','json',file]));const actual=Number(meta.format?.duration);if(!meta.streams?.some(x=>x.codec_type==='video')||!Number.isFinite(actual)||s.trimStart>=actual)fail(`Shot ${i+1}: trim start exceeds clip length.`);
 const filters=[`scale=${w}:${h}:force_original_aspect_ratio=decrease`,`pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`,'setsar=1','fps=30','format=yuv420p',`tpad=stop_mode=clone:stop_duration=${s.duration}`];if(p.transition==='fade')filters.push('fade=t=in:st=0:d=0.15',`fade=t=out:st=${s.duration-0.15}:d=0.15`);
 await runProcess(ff,['-y','-v','error','-ss',String(s.trimStart),'-i',file,'-vf',filters.join(','),'-t',String(s.duration),'-an','-c:v','libx264','-preset','fast','-crf','20',join(work,`shot${i}.mp4`)]);
 if(p.subtitles&&s.caption)assCues.push({start:elapsed,end:elapsed+s.duration,text:s.caption.replace(/[\r\n]+/g,' ')});elapsed+=s.duration;}
 if(p.brand||p.endLine){const endText=[p.brand,p.endLine].filter(Boolean).join('\n'),cut=Math.max(0,elapsed-2),last=assCues[assCues.length-1];if(last&&last.end>cut)last.end=Math.max(last.start+0.5,cut);assCues.push({start:cut,end:elapsed,text:endText});}
 writeFileSync(join(work,'list.txt'),p.shots.map((_,i)=>`file 'shot${i}.mp4'`).join('\n'));if(assCues.length){writeFileSync(join(work,'titles.srt'),assCues.map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.replace(/\r?\n/g,' ')}\n`).join('\n'));writeFileSync(join(work,'titles.ass'),assScript(w,h,env,assCues,p.captionStyle));}
 const args=['-y','-v','error','-f','concat','-safe','1','-i','list.txt'];let musicIndex=-1,logoIndex=-1,next=1;
 if(p.music==='upload'&&p.musicId){musicIndex=next++;args.push('-stream_loop','-1','-i',resolve(dataDir,'images',owned(p.musicId,u).id));}
 if(p.music==='ambient'){musicIndex=next++;args.push('-f','lavfi','-i','aevalsrc=0.035*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t))*(0.65+0.35*sin(2*PI*0.5*t)):s=44100');}
 if(p.logoId){logoIndex=next++;args.push('-loop','1','-i',resolve(dataDir,'images',owned(p.logoId,u).id));}
 let chain='[0:v]null[v0]',v='v0';if(assCues.length){chain+=`;[${v}]subtitles=filename=titles.ass[v1]`;v='v1';}
 if(logoIndex>=0){chain+=`;[${logoIndex}:v]scale=140:-1[logo];[${v}][logo]overlay=W-w-28:28:enable='gte(t,${Math.max(0,elapsed-2)})'[v2]`;v='v2';}
 if(musicIndex>=0)chain+=`;[${musicIndex}:a]volume=0.6,afade=t=in:d=0.4,afade=t=out:st=${Math.max(0,elapsed-0.8)}:d=0.8[a]`;
 args.push('-filter_complex',chain,'-map',`[${v}]`);if(musicIndex>=0)args.push('-map','[a]','-c:a','aac');else args.push('-an');args.push('-t',String(elapsed),'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart','final.mp4');
 await runProcess(ff,args,{cwd:work});if(!closed){const current=get(p.id,u);if(current.exportToken===p.exportToken){current.exportId=saveAsset(u,readFileSync(join(work,'final.mp4')),'video/mp4','final-film.mp4');current.exportStatus='complete';current.exportError='';put(current,u);}}
 }catch(e){if(!closed){const current=get(p.id,u);if(current.exportToken===p.exportToken){current.exportStatus='failed';current.exportError=limited(e.message,700);put(current,u);}}}finally{exports.delete(p.id);rmSync(work,{recursive:true,force:true});}}
 async function handle(request,u){const url=new URL(request.url);if(url.pathname==='/api/video/upload'&&request.method==='POST'){const f=(await request.formData()).get('file');if(!(f instanceof File)||!f.size||f.size>100*1024*1024)fail('Upload MP4, MP3 or WAV under 100 MB.');const b=Buffer.from(await f.arrayBuffer());let mime='';if(b.subarray(4,8).toString()==='ftyp')mime='video/mp4';if(b.subarray(0,3).toString()==='ID3'||(b[0]===255&&(b[1]&224)===224))mime='audio/mpeg';if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WAVE')mime='audio/wav';if(!mime)fail('Use an MP4 video, MP3 or WAV audio file.');return {id:saveAsset(u,b,mime,f.name.slice(0,180)),mime};}
 if(request.method==='GET'){const projects=db.prepare('SELECT document FROM video_projects WHERE user_id=? ORDER BY updated_at DESC').all(u).map(r=>decorate(JSON.parse(r.document),u));const c=credsFor(u,true);return {projects,connection:!!c.key};}
 if(request.method!=='POST')fail('Method not allowed.',405);let b;try{b=await request.json();}catch{fail('The request could not be read.',400);}const creds=credsFor(u);
  // A new film starts blank on purpose. The facts belong to the chosen product and the words
 // belong to the author, so pre-filling either would be the studio writing the film for them.
 // Only the four shot slots and the film settings are prepared.
 if(b.action==='create'){const p={id:randomUUID(),title:limited(b.title,120),brief:'',productId:safe(b.productId),ratio:'16:9',resolution:'720P',brand:'EVERKNIT',endLine:'',music:'ambient',musicId:'',logoId:'',transition:'cut',subtitles:true,exportId:'',exportStatus:'idle',exportError:'',shots:[3,4,3,5].map(duration=>({id:randomUUID(),title:'',duration,script:'',imagePrompt:'',lastImagePrompt:'',videoPrompt:'',caption:'',trimStart:0,firstFrameId:'',lastFrameId:''}))};put(p,u);return {project:decorate(p,u)};}
 const id=safe(b.projectId||b.project?.id),p=get(id,u);if(exports.has(id))fail('Wait for the export to finish before editing.',409);
 if(b.action==='save'){if(locked.has(id))fail('Wait for the current operation.',409);const clean=sanitize(b.project,p,u);if(decorate(p,u).shots.some(s=>active(s.status)))fail('Wait for active clips before editing the project.',409);put(clean,u);return {project:decorate(clean,u)};}
 if(b.action==='poll'){for(const j of db.prepare("SELECT * FROM video_jobs WHERE project_id=? AND user_id=? AND status IN ('pending','running','downloading')").all(id,u))await pollJob(j);return {project:decorate(get(id,u),u)};}
 if(locked.has(id))fail('Another project operation is in progress.',409);locked.add(id);
 try{
 if(b.action==='storyboard'){
  if(!creds.textModel)fail('Configure the language model first.',503);
  // No product, no storyboard. Without the specification table the model has nothing to work
  // from and would have to invent the garment, the fibre and the numbers.
  const facts=officialBlock(db,p.productId);
  if(!facts)fail('Choose a product from the shared library first.',400);
  if(decorate(p,u).shots.some(s=>active(s.status)))fail('Wait for active clips.',409);
  const quota=reserve(u,'prompt');
  // The reply goes through extractJson instead of a bare JSON.parse. A model often opens with a
  // sentence or closes with a remark, and JSON.parse threw a SyntaxError on those - which the
  // request handler then reported as "the request could not be read", pointing at the wrong
  // place entirely. Three tries also cover a reply that parses but carries the wrong shape.
  try{
   const system=prompts.values(u.id).module('video.storyboard'),durations=[3,4,3,5];
   // JSON keys stay as they are - the code reads them - but the words inside are written in the
   // account's language.
   const inChinese=languageFor(u)==='zh';
   // Everything the film is allowed to say, in one block: the film settings, the specification
   // table and the company facts are official; the brief is direction only and cannot add facts.
   const direction=['Film settings: '+p.ratio+' aspect ratio, '+p.resolution+'.','',facts.text,'','Company facts (official, quote only what is listed):',companyBlock(db),'','Author brief (creative direction only - it must not be read as product facts):',p.brief||'None supplied.'].concat(inChinese?['','Language: write every value - title, script, imagePrompt, lastImagePrompt, videoPrompt and caption - in Simplified Chinese. Leave the JSON keys exactly as specified.']:[]).join('\n');
   let parsed=null,truncated=false;
   for(let attempt=0;attempt<3&&!parsed;attempt++){
    const o=await provider('chat/completions',{model:creds.textModel,messages:[{role:'system',content:system},{role:'user',content:direction}],max_tokens:4000},120000,creds);
    const choice=o.choices?.[0],message=choice?.message||{};
    const str=String(message.content||'');
    // Recorded on every call, so a retry never hides the tokens it spent.
    costs?.recordText({userId:u,stage:'Storyboard, script & captions',model:creds.textModel,groupId:p.id,groupKind:'video',groupLabel:p.title||p.brief,usage:o.usage,chars:str.length});
    const candidate=extractJson(str);
    if(candidate&&Array.isArray(candidate.shots)&&candidate.shots.length===4){parsed=candidate;break;}
    // A thinking model that spent its whole budget on the trace answers 200 with an empty
    // content. Logging the shape tells that apart from prose wrapping, and there is no point
    // retrying a reply that ran out of room.
    truncated=choice?.finish_reason==='length';
    console.error('Storyboard reply unusable (attempt '+(attempt+1)+', '+str.length+' chars, finish='+(choice?.finish_reason||'?')+', completion_tokens='+((o.usage&&o.usage.completion_tokens)||'?')+', reasoning_chars='+String(message.reasoning_content||'').length+') head: '+str.slice(0,200)+' | tail: '+str.slice(-200));
    if(truncated)break;
   }
   if(!parsed)fail(truncated?'The model ran out of output space before finishing the storyboard. Try again.':'The model did not return a usable four-shot storyboard. Try again.',502);
   const raw={...p,shots:parsed.shots.map((s,i)=>({...s,id:randomUUID(),duration:durations[i],trimStart:0,firstFrameId:'',lastFrameId:''}))};
   const old={...p,shots:raw.shots};
   const next=sanitize(raw,old,u);put(next,u);
   return {project:decorate(next,u)};
  }catch(e){refund(quota,'prompt');throw e;}
 }
 const shot=p.shots.find(s=>s.id===b.shotId);
 if(['image','prompt','generate','attach'].includes(b.action)&&!shot)fail('Shot not found.',404);
 if(b.action==='image'){const last=b.frame==='last',prompt=last?shot.lastImagePrompt:shot.imagePrompt;if(!prompt)fail('Write an image prompt first.');// With nothing chosen, the frame is anchored to the library photo of the film's product.
  const reference=safe(b.referenceId||shot.firstFrameId||(officialBlock(db,p.productId)||{}).product?.imageId);if(!reference)fail('Upload or select a product reference image.');if(!owned(reference,u).mime.startsWith('image/'))fail('Choose an image.');const quota=reserve(u,'image');try{const out=await provider('images/generations',{model:creds.imageModel,prompt,image:dataUrl(reference,u),size:(RATIOS[p.ratio]||'1024x1024'),response_format:'b64_json',stream:false,watermark:true,sequential_image_generation:'disabled'},180000,creds);const item=out.data?.[0]||{};let bytes;if(typeof item.b64_json==='string'&&item.b64_json&&item.b64_json.length<=40000000){bytes=Buffer.from(item.b64_json,'base64');}else if(typeof item.url==='string'&&/^https:\/\/[\w.-]*aliyuncs\.com\//.test(item.url)){const dr=await fetcher(item.url,{signal:AbortSignal.timeout(120000)});if(!dr.ok)fail('Could not download the generated image.',502);bytes=Buffer.from(await dr.arrayBuffer());}else{fail('No usable image returned.',502);}shot[last?'lastFrameId':'firstFrameId']=saveAsset(u,bytes,bytes[0]===137?'image/png':'image/jpeg','video-keyframe');p.exportId='';put(p,u);costs?.recordImage({userId:u,stage:`${last?'Last':'First'}-frame keyframe`,model:creds.imageModel,groupId:p.id,groupKind:'video',groupLabel:`${p.title} · ${shot.title}`,size:p.ratio});return {project:decorate(p,u)};}catch(e){refund(quota,'image');throw e;}}
 if(b.action==='prompt'){if(!creds.textModel)fail('Configure the language model first.',503);
  // The motion prompt quotes the same table, so a shot cannot introduce a claim the film's
  // specification does not make.
  const facts=officialBlock(db,p.productId);if(!facts)fail('Choose a product from the shared library first.',400);
  const quota=reserve(u,'prompt');try{const content=[{type:'text',text:`${facts.text}\n\nFilm brief: ${p.brief}\nShot: ${shot.script}\nDuration: ${shot.duration}\nRatio: ${p.ratio}\nHas last frame: ${!!shot.lastFrameId}\nCurrent prompt: ${shot.videoPrompt}${languageFor(u)==='zh'?'\nWrite the resulting prompt in Simplified Chinese.':''}`}];if(shot.firstFrameId)content.push({type:'image_url',image_url:{url:dataUrl(shot.firstFrameId,u)}});if(shot.lastFrameId)content.push({type:'image_url',image_url:{url:dataUrl(shot.lastFrameId,u)}});const out=await provider('chat/completions',{model:creds.textModel,messages:[{role:'system',content:prompts.values(u.id).module('video.shot')},{role:'user',content}],max_tokens:1400},90000,creds);shot.videoPrompt=limited(out.choices?.[0]?.message?.content,12000);if(!shot.videoPrompt)fail('No prompt returned.',502);put(p,u);costs?.recordText({userId:u,stage:'Shot video prompt',model:creds.textModel,groupId:p.id,groupKind:'video',groupLabel:`${p.title} · ${shot.title}`,usage:out.usage,chars:shot.videoPrompt.length});return {project:decorate(p,u)};}catch(e){refund(quota,'prompt');throw e;}}
 if(b.action==='attach'){const asset=owned(safe(b.assetId),u);if(asset.mime!=='video/mp4')fail('Choose an MP4 clip.');if(active(decorate(p,u).shots.find(s=>s.id===shot.id).status))fail('Wait for this clip generation.',409);db.prepare('INSERT INTO video_jobs(id,user_id,project_id,shot_id,status,asset_id,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),u,id,shot.id,'complete',asset.id,now());p.exportId='';p.exportStatus='idle';put(p,u);return {project:decorate(p,u)};}
 if(b.action==='generate'){if(!shot.firstFrameId||!shot.videoPrompt)fail('Add a first frame and video prompt before generation.');if(active(decorate(p,u).shots.find(s=>s.id===shot.id).status))fail('This shot is already generating.',409);if(!creds.key)fail('Connect your Bailian API key first, in Model settings.',503);const quota=u+':'+now().slice(0,10);db.prepare('INSERT OR IGNORE INTO video_usage(id,count) VALUES(?,0)').run(quota);db.prepare('UPDATE video_usage SET count=count+1 WHERE id=?').run(quota);
 const job=randomUUID();db.prepare('INSERT INTO video_jobs(id,user_id,project_id,shot_id,status,created_at) VALUES(?,?,?,?,?,?)').run(job,u,id,shot.id,'submitting',now());try{const media=[{type:'first_frame',url:dataUrl(shot.firstFrameId,u)}];if(shot.lastFrameId)media.push({type:'last_frame',url:dataUrl(shot.lastFrameId,u)});const result=await bailian('/services/aigc/video-generation/video-synthesis',{model:creds.videoModel||'wan3.0-video',input:{prompt:shot.videoPrompt,media},parameters:{resolution:p.resolution,ratio:p.ratio,duration:shot.duration,prompt_extend:false,audio:false}},creds);if(!result.output?.task_id)fail('Bailian returned no task ID. Check the provider console before retrying.',502);db.prepare("UPDATE video_jobs SET task_id=?,status='pending' WHERE id=?").run(result.output.task_id,job);p.exportId='';p.exportStatus='idle';put(p,u);return {project:decorate(p,u)};}catch(e){db.prepare("UPDATE video_jobs SET status='failed',error=? WHERE id=?").run(limited(e.message,500),job);throw e;}}
 if(b.action==='export'){const decorated=decorate(p,u);if(decorated.shots.some(s=>s.status!=='complete'||!s.clipId))fail('Finish or upload every clip before export.');p.exportToken=randomUUID();p.exportStatus='rendering';p.exportError='';p.exportId='';put(p,u);exports.add(id);void render({...decorated,exportToken:p.exportToken},u);return {project:decorate(p,u)};}
 fail('Unknown video action.');
 }finally{locked.delete(id);}}
 return {handle,close(){closed=true;clearInterval(timer);}};
}
