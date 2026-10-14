// The official facts layer.
//
// The shared product library is the ONLY source of product information in this studio. An
// administrator maintains it; the model never sees it as something to complete. Every studio
// reads its facts through this module, so a caption, an image prompt or a film can only ever
// repeat what is written down here. What is not in the table is not in the output: the model is
// never asked to fill a gap, because a gap filled by a model is a claim nobody verified.
export function companyFacts(db){try{return JSON.parse(db.prepare("SELECT value FROM library_meta WHERE key='company'").get()?.value||'[]');}catch{return [];}}
// One product, read straight from the library: its label, its picture and every specification
// column that has a value. Columns with no value are dropped rather than passed on as blanks,
// so the model is never shown an empty slot it might want to fill.
export function libraryFacts(db,productId){
 const id=String(productId||'').trim();
 if(!id)return null;
 const product=db.prepare('SELECT id,label,data,image_id FROM products WHERE id=?').get(id);
 if(!product)return null;
 let data={};try{data=JSON.parse(product.data||'{}');}catch{data={};}
 const specs=db.prepare('SELECT key,label FROM library_columns ORDER BY position').all()
  .filter(c=>data[c.key]).map(c=>({label:c.label,value:String(data[c.key]).slice(0,300)}));
 return {id:product.id,label:product.label,imageId:product.image_id||'',specs};
}
export function factsBlock(company){
 if(!Array.isArray(company)||!company.length)return 'None supplied.';
 return company.map(f=>'- '+f.field+': '+(f.value||'')+(f.note?' ('+f.note+')':'')).join('\n').slice(0,4000);
}
export function productBlock(columns,data){
 return columns.map(c=>'- '+c.label+': '+(data[c.key]||'not supplied')).join('\n').slice(0,4000);
}
export function specLines(specs){
 if(!Array.isArray(specs)||!specs.length)return 'None supplied.';
 return specs.map(s=>'- '+s.label+': '+s.value).join('\n').slice(0,4000);
}
export function companyBlock(db){return factsBlock(companyFacts(db));}
// What a generation prompt quotes, in the order the model should read it.
export function officialBlock(db,productId){
 const product=libraryFacts(db,productId);
 if(!product)return null;
 return {product,text:['Product: '+product.label,'','Specification (the only source of fact):',specLines(product.specs)].join('\n')};
}
