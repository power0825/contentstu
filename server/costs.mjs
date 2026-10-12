import {randomUUID} from 'node:crypto';
import {priceBook,textCost,imageCost,videoCost} from '../shared/pricing.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const clean=(v,max=160)=>String(v??'').slice(0,max);
const round=n=>Math.round(n*1e6)/1e6;
// Every model call that can cost money writes one row here. Costs are snapshotted at
// call time so a later price change never rewrites history; the unit counts stay on the
// row so the total can be recomputed against current prices if needed.
export function createCosts({db,env}){
 db.exec(`CREATE TABLE IF NOT EXISTS cost_events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,created_at TEXT NOT NULL,kind TEXT NOT NULL,stage TEXT NOT NULL,model TEXT NOT NULL,group_id TEXT NOT NULL,group_kind TEXT NOT NULL,group_label TEXT NOT NULL,units REAL NOT NULL,unit_label TEXT NOT NULL,unit_price REAL NOT NULL,cost REAL NOT NULL,detail TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS cost_events_user ON cost_events(user_id,created_at);
 CREATE INDEX IF NOT EXISTS cost_events_group ON cost_events(group_id);`);
 const book=priceBook(env);
 function record(entry){
  const id=randomUUID();
  db.prepare('INSERT INTO cost_events(id,user_id,created_at,kind,stage,model,group_id,group_kind,group_label,units,unit_label,unit_price,cost,detail) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(id,entry.userId,new Date().toISOString(),entry.kind,clean(entry.stage,80),clean(entry.model,80),clean(entry.groupId,80),clean(entry.groupKind,20),clean(entry.groupLabel,160),Number(entry.units)||0,clean(entry.unitLabel,24),Number(entry.unitPrice)||0,round(Number(entry.cost)||0),JSON.stringify(entry.detail||{}));
  return id;
 }
 // Token counts come from the provider response. `estimated` marks the fallback used when
 // a response carries no usage block, so the reporter can point at the soft numbers.
 function recordText({userId,stage,model,groupId,groupKind,groupLabel,usage,chars=0}){
  let input=Number(usage?.prompt_tokens)||0,output=Number(usage?.completion_tokens)||0,cached=Number(usage?.prompt_tokens_details?.cached_tokens)||0,estimated=false;
  if(!input&&!output&&chars){input=Math.round(chars/4);estimated=true;}
  const {cost,units,detail}=textCost(book,{input,output,cached});
  return record({userId,stage,model,groupId,groupKind,groupLabel,units,unitLabel:'tokens',unitPrice:book.text.input,cost,kind:'text',detail:{...detail,estimated,price:{input:book.text.input,output:book.text.output,cached:book.text.cached},unit:book.text.unit}});
 }
 function recordImage({userId,stage,model,groupId,groupKind,groupLabel,count=1,size=''}){
  const {cost,units,detail,unitPrice}=imageCost(book,count);
  return record({userId,stage,model,groupId,groupKind,groupLabel,units,unitLabel:'image',unitPrice,cost,kind:'image',detail:{...detail,size,price:unitPrice,unit:book.image.unit}});
 }
 function recordVideo({userId,stage,model,groupId,groupKind,groupLabel,resolution='720P',seconds=0}){
  const {cost,units,detail,unitPrice}=videoCost(book,resolution,seconds);
  return record({userId,stage,model,groupId,groupKind,groupLabel,units,unitLabel:'second',unitPrice,cost,kind:'video',detail:{...detail,price:unitPrice,unit:book.video.unit}});
 }
 const RANGES={all:0,today:1,'7d':7,'30d':30};
 async function handle(request,user){
  const url=new URL(request.url);
  if(url.pathname!=='/api/costs')fail('Not found.',404);
  if(request.method!=='GET')fail('Method not allowed.',405);
  const scope=url.searchParams.get('scope')==='all'&&user.role==='admin'?'all':'mine';
  const kind=['text','image','video'].includes(url.searchParams.get('kind')||'')?url.searchParams.get('kind'):'';
  const range=Object.prototype.hasOwnProperty.call(RANGES,url.searchParams.get('range')||'')?url.searchParams.get('range'):'all';
  const where=['1=1'],params=[];
  if(scope==='mine'){where.push('user_id=?');params.push(user.id);}
  if(kind){where.push('kind=?');params.push(kind);}
  if(RANGES[range]){const since=new Date(Date.now()-(RANGES[range]-1)*86400000);since.setHours(0,0,0,0);where.push('created_at>=?');params.push(since.toISOString());}
  const rows=db.prepare(`SELECT * FROM cost_events WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 2000`).all(...params);
  const emails={};if(scope==='all')for(const u of db.prepare('SELECT id,email FROM users').all())emails[u.id]=u.email;
  const groups=new Map();
  const totals={all:0,text:0,image:0,video:0,events:rows.length,units:{tokens:0,image:0,second:0}};
  for(const row of rows){
   totals.all+=row.cost;totals[row.kind]=(totals[row.kind]||0)+row.cost;
   totals.units[row.unit_label==='tokens'?'tokens':row.unit_label==='image'?'image':'second']+=row.units;
   const key=row.group_id||row.id;
   if(!groups.has(key))groups.set(key,{id:key,kind:row.group_kind||row.kind,label:row.group_label||'Untitled',created_at:row.created_at,total:0,items:[]});
   const group=groups.get(key);
   group.total+=row.cost;
   if(row.created_at>group.created_at)group.created_at=row.created_at;
   group.items.push({id:row.id,stage:row.stage,kind:row.kind,model:row.model,units:row.units,unitLabel:row.unit_label,unitPrice:row.unit_price,cost:row.cost,detail:JSON.parse(row.detail||'{}'),created_at:row.created_at,...(scope==='all'?{user:emails[row.user_id]||'—'}:{})});
  }
  const ordered=[...groups.values()].sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(g=>({...g,total:round(g.total),items:g.items.sort((a,b)=>a.created_at.localeCompare(b.created_at))}));
  totals.all=round(totals.all);totals.text=round(totals.text);totals.image=round(totals.image);totals.video=round(totals.video);
  const daily=new Map();
  for(const row of rows){const day=row.created_at.slice(0,10);daily.set(day,round((daily.get(day)||0)+row.cost));}
  return json({
   scope,kind,range,totals,
   groups:ordered,
   daily:[...daily.entries()].map(([day,cost])=>({day,cost})).sort((a,b)=>b.day.localeCompare(a.day)).slice(0,30),
   pricing:{...book,models:{text:env.VOLCENGINE_TEXT_MODEL||'',image:env.VOLCENGINE_IMAGE_MODEL||'',video:env.BAILIAN_VIDEO_MODEL||''}}
  });
 }
 return {recordText,recordImage,recordVideo,handle,pricing:book};
}
