import {inflateRawSync} from 'node:zlib';
// Minimal .xlsx reader. Excel files are ZIP archives of XML, and some generators
// (including the classroom workbook) use non-standard namespace prefixes, so every
// matcher below works on local names only and ignores any prefix.
const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
const decode=text=>String(text).replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g,(all,name)=>{
 if(name[0]==='#'){const code=name[1]==='x'||name[1]==='X'?parseInt(name.slice(2),16):Number(name.slice(1));return Number.isFinite(code)?String.fromCodePoint(code):all;}
 return ENTITIES[name]??all;
});
function entries(buffer){
 const eocd=buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
 if(eocd<0)throw new Error('not a zip archive');
 const count=buffer.readUInt16LE(eocd+10),start=buffer.readUInt32LE(eocd+16);
 const files=new Map();
 let p=start;
 for(let i=0;i<count;i++){
  if(buffer.readUInt32LE(p)!==0x02014b50)break;
  const method=buffer.readUInt16LE(p+10),size=buffer.readUInt32LE(p+20),nameLen=buffer.readUInt16LE(p+28),extraLen=buffer.readUInt16LE(p+30),commentLen=buffer.readUInt16LE(p+32),offset=buffer.readUInt32LE(p+42);
  const name=buffer.toString('utf8',p+46,p+46+nameLen);
  files.set(name,{method,size,offset});
  p+=46+nameLen+extraLen+commentLen;
 }
 return files;
}
const rowsOf=xml=>{
 const rows=[];
 const rowRe=/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g;
 let match;
 while((match=rowRe.exec(xml))){
  const cells=[];
  const cellRe=/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  let cell;
  while((cell=cellRe.exec(match[2]))){
   const attrs=cell[1]||'',inner=cell[2]||'';
   const ref=/r="([A-Z]+)\d+"/.exec(attrs);
   const type=/t="([^"]+)"/.exec(attrs);
   let value='';
   if(type&&type[1]==='inlineStr'){
    const texts=[...inner.matchAll(/<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m=>m[1]);
    value=texts.join('');
   }else{
    const v=/<(?:\w+:)?v[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner);
    value=v?v[1]:'';
    if(type&&type[1]==='s'&&value!=='')value='\u0000'+value;
   }
   if(ref)cells.push({column:columnIndex(ref[1]),value:decode(value)});
   else cells.push({column:cells.length,value:decode(value)});
  }
  rows.push(cells);
 }
 return rows;
};
function columnIndex(letters){
 let n=0;
 for(const ch of letters)n=n*26+(ch.charCodeAt(0)-64);
 return n-1;
}
export function readXlsx(buffer){
 const files=entries(buffer);
 const needed=[...files.keys()];
 const pick=pattern=>needed.filter(name=>pattern.test(name)).sort();
 const loadRaw=name=>{
  const entry=files.get(name);
  const local=entry.offset;
  const nameLen=buffer.readUInt16LE(local+26),extraLen=buffer.readUInt16LE(local+28);
  const start=local+30+nameLen+extraLen;
  const raw=buffer.subarray(start,start+entry.size);
  return entry.method===0?raw:inflateRawSync(raw);
 };
 const shared=[];
 const sharedName=pick(/^xl\/sharedStrings\.xml$/i)[0];
 if(sharedName){
  const xml=loadRaw(sharedName).toString('utf8');
  for(const si of xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)){
   const texts=[...si[1].matchAll(/<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m=>m[1]);
   shared.push(decode(texts.join('')));
  }
 }
 const workbookName=pick(/^xl\/workbook\.xml$/i)[0];
 if(!workbookName)throw new Error('no workbook.xml');
 const workbook=loadRaw(workbookName).toString('utf8');
 const relsName=pick(/^xl\/_rels\/workbook\.xml\.rels$/i)[0];
 const rels=new Map();
 if(relsName){
  const xml=loadRaw(relsName).toString('utf8');
  for(const rel of xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)){
   const attrs=rel[1];
   const id=/Id="([^"]+)"/.exec(attrs),target=/Target="([^"]+)"/.exec(attrs);
   if(id&&target)rels.set(id[1],target[1].replace(/^\//,''));
  }
 }
 const sheets=[];
 const sheetRe=/<(?:\w+:)?sheet\b([^>]*)\/?>/g;
 let sheet;
 while((sheet=sheetRe.exec(workbook))){
  const attrs=sheet[1];
  const name=/name="([^"]*)"/.exec(attrs);
  const rid=/:id="([^"]+)"/.exec(attrs);
  const explicit=/sheetId="([^"]*)"/.exec(attrs);
  if(!name)continue;
  let target=rid?rels.get(rid[1]):null;
  if(!target)target=`xl/worksheets/sheet${explicit?explicit[1]:sheets.length+1}.xml`;
  if(!target.startsWith('xl/'))target='xl/'+target;
  if(!files.has(target))continue;
  const xml=loadRaw(target).toString('utf8');
  const rows=rowsOf(xml).map(cells=>{
   const out=[];
   for(const {column,value} of cells)out[column]=value.startsWith('\u0000')?shared[Number(value.slice(1))]??'':value;
   return out.map(v=>v??'');
  });
  sheets.push({name:decode(name[1]),rows});
 }
 if(!sheets.length)throw new Error('no worksheets');
 return sheets;
}
