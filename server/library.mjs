import {readXlsx} from './xlsx.mjs';
import {randomUUID} from 'node:crypto';
import {readFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const clean=v=>String(v??'').replace(/\s+/g,' ').trim().slice(0,600);
const slug=label=>String(label||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,40)||'field';
const IMAGE_TYPES=[['image/jpeg',[255,216,255]],['image/png',[137,80,78,71,13,10,26,10]],['image/webp',[82,73,70,70]]];
const imageType=bytes=>IMAGE_TYPES.find(([,magic])=>magic.every((byte,i)=>bytes[i]===byte))?.[0]||'';
// Columns the studio never keeps: they are for the seller's own records, not for content generation.
const IGNORED_COLUMN=/^(internal|private|confidential|do_not_share)/;
// Header row = the row with the most filled cells among the first 12 lines of a sheet.
function parseSheet(sheet){
 const rows=sheet.rows.map(cells=>{const out=cells.map(clean);while(out.length&&!out[out.length-1])out.pop();return out;});
 let header=-1,score=0;
 for(let i=0;i<Math.min(rows.length,12);i++){const n=rows[i].filter(Boolean).length;if(n>score){score=n;header=i;}}
 if(header<0||score<2)return null;
 const headers=rows[header];
 const keep=headers.map((label,i)=>({label,i})).filter(({label})=>label&&!IGNORED_COLUMN.test(slug(label)));
 const columns=keep.map(({label},i)=>({key:slug(label),label:label.slice(0,80),source:keep[i].i}));
 const body=[];
 for(let i=header+1;i<rows.length;i++){
  const row=rows[i];
  if(!row.filter(Boolean).length)continue;
  if(row.filter(Boolean).length<=1)continue; // trailing classroom note
  const record={};
  let filled=0;
  columns.forEach(c=>{const v=row[c.source]||'';if(v){record[c.key]=v.slice(0,1200);filled++;}});
  if(filled)body.push(record);
 }
 return {title:sheet.name,columns:columns.map(({key,label})=>({key,label})),rows:body};
}
// A sheet describing the company rather than the product line: columns named field / value.
const isFactsSheet=sheet=>{const keys=sheet.columns.map(c=>c.key);return keys.some(k=>/^(field|topic|item)$/.test(k))&&keys.some(k=>/(value|information|detail|content)/.test(k));};
function parseWorkbook(buffer){
 let sheets;
 try{sheets=readXlsx(buffer).map(parseSheet).filter(Boolean).filter(s=>s.rows.length);}
 catch{fail('That file could not be read as an Excel workbook. Save it as .xlsx and try again.');}
 if(!sheets.length)fail('No table with a header row and at least one data row was found in that workbook.');
 const facts=sheets.find(isFactsSheet)||null;
 const table=sheets.find(s=>s!==facts)||null;
 if(!table)fail('The workbook has company facts but no product table.');
 const keys=table.columns.map(c=>c.key);
 if(new Set(keys).size!==keys.length)fail('Two columns in that sheet share the same name. Rename one of them and import again.');
 const company=facts?facts.rows.map(r=>({field:clean(r[facts.columns[0].key]),value:clean(r[facts.columns[1]?.key])||clean(Object.values(r)[1]),note:clean(r[facts.columns[2]?.key])||''})).filter(f=>f.field):[];
 return {columns:table.columns,rows:table.rows,company};
}
export function createLibrary({db,dataDir='data',saveAsset}){
 db.exec(`CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,position INTEGER NOT NULL,label TEXT NOT NULL,data TEXT NOT NULL,image_id TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,updated_by TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS library_columns(key TEXT PRIMARY KEY,label TEXT NOT NULL,position INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS library_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);`);
 const productColumns=new Set(db.prepare('PRAGMA table_info(products)').all().map(c=>c.name));
 if(!productColumns.has('image_id'))db.exec("ALTER TABLE products ADD COLUMN image_id TEXT NOT NULL DEFAULT ''");
 // One-off tidy-up: libraries imported before the ignore rule still carry seller-only columns.
 if(!db.prepare("SELECT value FROM library_meta WHERE key='cleaned_seller_columns'").get()){
  const dropped=db.prepare('SELECT key FROM library_columns').all().filter(c=>IGNORED_COLUMN.test(c.key)).map(c=>c.key);
  if(dropped.length){
   for(const key of dropped)db.prepare('DELETE FROM library_columns WHERE key=?').run(key);
   for(const row of db.prepare('SELECT id,data FROM products').all()){
    const data=JSON.parse(row.data);let changed=false;
    for(const key of dropped)if(key in data){delete data[key];changed=true;}
    if(changed)db.prepare('UPDATE products SET data=? WHERE id=?').run(JSON.stringify(data),row.id);
   }
  }
  db.prepare('INSERT OR REPLACE INTO library_meta(key,value,updated_at) VALUES(?,?,?)').run('cleaned_seller_columns',String(dropped.length),new Date().toISOString());
 }
 const columns=()=>db.prepare('SELECT key,label FROM library_columns ORDER BY position').all();
 const productRows=()=>db.prepare('SELECT id,label,data,image_id FROM products ORDER BY position').all().map(r=>({id:r.id,label:r.label,data:JSON.parse(r.data),imageId:r.image_id||''}));
 const dropImage=id=>{if(!id)return;db.prepare('DELETE FROM assets WHERE id=?').run(id);try{unlinkSync(join(dataDir,'images',id));}catch{}};
 const meta=key=>db.prepare('SELECT value FROM library_meta WHERE key=?').get(key)?.value||'';
 const setMeta=(key,value)=>db.prepare('INSERT INTO library_meta(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key,value,new Date().toISOString());
 const company=()=>{try{return JSON.parse(meta('company')||'[]');}catch{return [];}};
 function view(){return {products:productRows(),columns:columns(),company:company(),source:meta('source'),importedAt:meta('imported_at'),importedBy:meta('imported_by'),updatedAt:meta('updated_at')};}
 function ensureColumns(list){
  const known=new Set(columns().map(c=>c.key));
  let position=known.size;
  for(const {key,label} of list){if(!key||known.has(key))continue;db.prepare('INSERT INTO library_columns(key,label,position) VALUES(?,?,?)').run(key,String(label||key).slice(0,80),position++);known.add(key);}
 }
 function writeRow(id,label,data,user,position){
  const stamp=new Date().toISOString();
  if(id)db.prepare('UPDATE products SET label=?,data=?,updated_at=?,updated_by=? WHERE id=?').run(label,JSON.stringify(data),stamp,user.email,id);
  else db.prepare('INSERT INTO products(id,position,label,data,updated_at,updated_by) VALUES(?,?,?,?,?,?)').run(randomUUID(),position,label,JSON.stringify(data),stamp,user.email);
 }
 async function handle(request,user){
  const path=new URL(request.url).pathname;
  if(path.startsWith('/api/library/image/')){
   if(request.method!=='GET')fail('Method not allowed.',405);
   const id=path.slice('/api/library/image/'.length).replace(/[^a-zA-Z0-9-]/g,'').slice(0,80);
   const asset=db.prepare('SELECT mime FROM assets WHERE id=?').get(id);
   if(!asset||!db.prepare('SELECT id FROM products WHERE image_id=?').get(id))fail('Image not found.',404);
   let bytes;try{bytes=readFileSync(join(dataDir,'images',id));}catch{fail('Image not found.',404);}
   return new Response(bytes,{headers:{'Content-Type':asset.mime||'image/jpeg','Content-Length':String(bytes.length),'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'}});
  }
  if(path!=='/api/library')fail('Not found.',404);
  if(request.method==='GET')return json(view());
  if(user.role!=='admin')throw Object.assign(new Error('Only an administrator can change the shared product library.'),{status:403});
  if(request.method!=='POST')fail('Method not allowed.',405);
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)fail('Request origin is not allowed.',403);
  const type=request.headers.get('content-type')||'';
  if(type.includes('multipart/form-data')){
   const form=await request.formData();
   const image=form.get('image');
   if(image instanceof File){
    const target=db.prepare('SELECT id,label,image_id FROM products WHERE id=?').get(clean(form.get('productId')));
    if(!target)fail('Save the product before adding its picture.',404);
    if(!image.size)fail('Choose an image file.');
    if(image.size>8*1024*1024)fail('Use an image under 8 MB.');
    const bytes=Buffer.from(await image.arrayBuffer());
    const mime=imageType(bytes);
    if(!mime)fail('Only JPG, PNG and WebP images are supported.');
    const id=saveAsset(user.id,bytes,mime,image.name.slice(0,180)||'product-image');
    db.prepare('UPDATE products SET image_id=?,updated_at=?,updated_by=? WHERE id=?').run(id,new Date().toISOString(),user.email,target.id);
    dropImage(target.image_id);
    return json({...view(),notice:`Picture updated for ${target.label}.`});
   }
   const file=form.get('file');
   if(!(file instanceof File)||!file.size)fail('Choose an .xlsx file to import.');
   if(file.size>8*1024*1024)fail('Use a workbook under 8 MB.');
   const parsed=parseWorkbook(Buffer.from(await file.arrayBuffer()));
   const stamp=new Date().toISOString();
   const previous=db.prepare("SELECT image_id FROM products WHERE image_id<>''").all().map(r=>r.image_id);
   db.exec('DELETE FROM products;DELETE FROM library_columns;');
   previous.forEach(dropImage);
   parsed.columns.forEach((c,i)=>db.prepare('INSERT INTO library_columns(key,label,position) VALUES(?,?,?)').run(c.key,c.label,i));
   const labelKey=parsed.columns.find(c=>/categor|name|product|title|item/i.test(c.key))?.key||parsed.columns[0].key;
   parsed.rows.forEach((r,i)=>{
    const label=clean(r[labelKey])||`Product ${i+1}`;
    db.prepare('INSERT INTO products(id,position,label,data,image_id,updated_at,updated_by) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),i,label,JSON.stringify(r),'',stamp,user.email);
   });
   setMeta('source',file.name.slice(0,180));setMeta('imported_at',stamp);setMeta('imported_by',user.email);setMeta('updated_at',stamp);
   if(parsed.company.length)setMeta('company',JSON.stringify(parsed.company));
   return json({...view(),notice:`Imported ${parsed.rows.length} product${parsed.rows.length===1?'':'s'} from ${file.name}. Add a picture to each one.`});
  }
  let b;try{b=await request.json();}catch{fail('The request could not be read.');}
  const action=typeof b.action==='string'?b.action:'';
  if(action==='save'){
   const row=b.product&&typeof b.product==='object'?b.product:null;if(!row)fail('Nothing to save.');
   const data={};for(const [key,value] of Object.entries(row.data||{})){const k=slug(key);const v=clean(value);if(v)data[k]=v;}
   if(!Object.keys(data).length)fail('Fill in at least one field.');
   ensureColumns(Object.keys(data).map(key=>({key,label:key.replace(/_/g,' ')})));
   const labelKey=columns().find(c=>/categor|name|product|title|item/i.test(c.key))?.key||columns()[0].key;
   const label=clean(row.label)||data[labelKey]||clean(Object.values(data)[0])||'Untitled product';
   const existing=row.id?db.prepare('SELECT position FROM products WHERE id=?').get(row.id):null;
   writeRow(existing?row.id:'',label.slice(0,120),data,user,existing?existing.position:productRows().length);
   setMeta('updated_at',new Date().toISOString());
   return json({...view(),notice:`${label} saved.`});
  }
  if(action==='delete'){
   const id=clean(b.id);const row=db.prepare('SELECT id,image_id FROM products WHERE id=?').get(id);if(!row)fail('That product no longer exists.',404);
   db.prepare('DELETE FROM products WHERE id=?').run(id);
   dropImage(row.image_id);
   return json({...view(),notice:'Product removed.'});
  }
  if(action==='clear'){
   const images=db.prepare("SELECT image_id FROM products WHERE image_id<>''").all().map(r=>r.image_id);
   db.exec('DELETE FROM products;DELETE FROM library_columns;');
   images.forEach(dropImage);
   setMeta('source','');setMeta('imported_at','');setMeta('imported_by','');
   return json({...view(),notice:'The shared product library is now empty.'});
  }
  if(action==='removeImage'){
   const row=db.prepare('SELECT id,label,image_id FROM products WHERE id=?').get(clean(b.id));
   if(!row)fail('That product no longer exists.',404);
   db.prepare("UPDATE products SET image_id='',updated_at=?,updated_by=? WHERE id=?").run(new Date().toISOString(),user.email,row.id);
   dropImage(row.image_id);
   return json({...view(),notice:`Picture removed from ${row.label}.`});
  }
  if(action==='company'){
   const facts=Array.isArray(b.facts)?b.facts.map(f=>({field:clean(f.field),value:clean(f.value),note:clean(f.note)})).filter(f=>f.field):[];
   setMeta('company',JSON.stringify(facts));
   return json({...view(),notice:'Company facts saved.'});
  }
  fail('Unknown library action.');
 }
 return {handle};
}
