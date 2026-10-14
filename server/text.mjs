import {randomUUID} from 'node:crypto';
import {TEXT_CHANNELS,headerFor} from './prompts.mjs';
import {extractJson} from './jsonish.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
export const LANGUAGES={en:'English',zh:'Simplified Chinese',ms:'Bahasa Melayu'};
// Labels plus the shipped defaults. What actually goes out is resolved per user from prompt_settings,
// so the Prompt settings page can change it without a code change.
export const CHANNELS=Object.fromEntries(Object.entries(TEXT_CHANNELS).map(([id,channel])=>[id,{label:channel.label,shape:channel.shape,brief:channel.brief,voice:channel.voice}]));
// The instruction layers, in the order they reach the model. "locked" marks structural constraints:
// without the shape or the contract the model stops returning readable JSON and the request simply
// fails, so those are shown in the UI but cannot be switched off. Seeing that some instructions are
// structural rather than editorial is part of the lesson.
export const PROMPT_LAYERS=[
 {key:'role',title:'Role',locked:true},
 {key:'voice',title:'Site voice and section map'},
 {key:'shape',title:'Output shape',locked:true},
 {key:'guidance',title:'Default guidance'},
 {key:'facts',title:'Company facts'},
 {key:'specification',title:'Product specification'},
 {key:'rules',title:'Writing rules'},
 {key:'contract',title:'Output contract',locked:true},
 {key:'profile',title:'Business rules and Skill'},
 {key:'brief',title:"Author's brief"}
];
const LOCKED_LAYERS=new Set(PROMPT_LAYERS.filter(l=>l.locked).map(l=>l.key));
const OMITTABLE_LAYERS=PROMPT_LAYERS.filter(l=>!l.locked).map(l=>l.key);
function factsBlock(company){
 if(!Array.isArray(company)||!company.length)return 'None supplied.';
 return company.map(f=>'- '+f.field+': '+(f.value||'')+(f.note?' ('+f.note+')':'')).join('\n').slice(0,4000);
}
function productBlock(columns,data){
 return columns.map(c=>'- '+c.label+': '+(data[c.key]||'not supplied')).join('\n').slice(0,4000);
}
const pick=(value,max=4000)=>{const v=typeof value==='string'?value.trim():'';return v?v.slice(0,max):'';};
export function buildSections(channel,parsed,ctx={}){
 const out=[];
 if(!parsed||typeof parsed!=='object')return out;
 const list=(label,value,source='ai')=>{if(Array.isArray(value)){const items=value.map(v=>pick(v,600)).filter(Boolean);if(items.length)out.push({label,items,source});}};
 const push=(label,value,source='ai')=>{const v=pick(value,4000);if(v)out.push({label,text:v,source});};
 if(channel==='website'){
  // A collection card has exactly two strings worth writing. Everything else on the card is taken
  // from the product library, so it is not repeated in the output panel.
  push('Collection card headline',parsed.cardHeadline);
  push('Collection card paragraph',parsed.cardParagraph);
  return out;
 }
 if(channel==='instagram'){
  push('Hook',parsed.hook);
  push('Caption',parsed.caption);
  list('Hashtags',(parsed.hashtags||[]).map(h=>'#'+String(h).replace(/^#+/,'')));
  push('Call to action',parsed.cta);
  return out;
 }
 push('Hook',parsed.hook);
 push('Body',parsed.body);
 list('Key points',parsed.keyPoints);
 push('Call to action',parsed.cta);
 list('Hashtags',(parsed.hashtags||[]).map(h=>'#'+String(h).replace(/^#+/,'')));
 return out;
}
// profileFor is deliberately not used: it falls back to DEFAULT_CONFIG, which describes how to stage a
// product photograph. Text Studio resolves the profile itself and falls back to TEXT_STUDIO_CONFIG.
export function createTextStudio({db,env,provider,credsFor,reserve,refund,costs,prompts}){
 db.exec('CREATE TABLE IF NOT EXISTS text_drafts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,product_id TEXT NOT NULL,product_label TEXT NOT NULL,channel TEXT NOT NULL,language TEXT NOT NULL,angle TEXT NOT NULL,sections TEXT NOT NULL,prompt TEXT NOT NULL DEFAULT \'\',created_at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS text_drafts_user ON text_drafts(user_id,created_at);');
 if(!new Set(db.prepare('PRAGMA table_info(text_drafts)').all().map(c=>c.name)).has('prompt'))db.exec("ALTER TABLE text_drafts ADD COLUMN prompt TEXT NOT NULL DEFAULT ''");
 const select='SELECT id,product_id,product_label,channel,language,angle,sections,prompt,created_at FROM text_drafts WHERE user_id=? ORDER BY created_at DESC LIMIT 40';
 const list=user=>db.prepare(select).all(user.id).map(withSources);
 // The rules and the Skill come from prompt_settings (text.agentRules / text.agentSkill); their shipped
 // defaults live in shared/defaults.mjs. profiles.rules/skill no longer feed any prompt.
 const columnRows=()=>{try{return db.prepare('SELECT key,label FROM library_columns ORDER BY position').all();}catch{return [];}};
 function withSources(row){
  let blocks=[];try{blocks=JSON.parse(row.sections);}catch{blocks=[];}
  blocks=Array.isArray(blocks)?blocks.map(b=>({...b,source:b.source||'ai'})):[];
  // A website draft holds only the two strings the model wrote. Drafts saved earlier also carried
  // the rows that come straight from the product library, so those are dropped on read.
  if(row.channel==='website')blocks=blocks.filter(b=>b.source==='ai');
  return {...row,sections:blocks,prompt:parsePrompt(row.prompt)};
 }
 // The prompt is stored with the draft rather than recomputed on read: it depends on the product
 // library and the agent config as they stood at that moment, so rebuilding it later would show
 // something the model never saw.
 function parsePrompt(raw){
  try{
   const parsed=JSON.parse(raw||'');
   if(parsed&&Array.isArray(parsed.parts))return {parts:parsed.parts,omitted:Array.isArray(parsed.omitted)?parsed.omitted:[],system:typeof parsed.system==='string'?parsed.system:''};
  }catch{}
  return null;
 }
 const companyFacts=()=>{try{return JSON.parse(db.prepare("SELECT value FROM library_meta WHERE key='company'").get()?.value||'[]');}catch{return [];}};
 const channelList=()=>Object.keys(CHANNELS).map(id=>({id,label:CHANNELS[id].label}));
 const languageList=()=>Object.keys(LANGUAGES).map(id=>({id,label:LANGUAGES[id]}));
 function line(parts){return parts.filter(Boolean).join('\n');}
 // The prompt is assembled as named layers so the app can show the student exactly what was sent,
 // and so any single layer can be switched off to compare the result. The wording of each layer comes
 // from prompt_settings (see prompts.mjs); only facts, specification and the brief are built here.
 function promptParts({channel,angle,facts,spec,profile,copy}){
  const withHeader=(key,body)=>body?(headerFor(key)+body):'';
  const bodies={
   role:copy.role,
   voice:withHeader('text.'+channel+'.voice',copy.voice),
   shape:withHeader('text.'+channel+'.shape',copy.shape),
   guidance:withHeader('text.'+channel+'.guidance',copy.guidance),
   facts:'Company facts:\n'+(facts||'None supplied.'),
   specification:'Product specification:\n'+(spec||'None supplied.'),
   rules:withHeader('text.rules',copy.rules),
   contract:withHeader('text.contract',copy.contract),
   profile:line([
    profile&&profile.rules?'Business rules from the instructor:\n'+profile.rules:'',
    profile&&profile.skill?'Skill reference:\n'+profile.skill:''
   ]),
   brief:angle?'AUTHOR\'S BRIEF - HIGHEST PRIORITY, it overrides the default shape and guidance above where they disagree:\n"'+angle+'"\nFollow it literally. If it asks you to choose something, name the choice in the copy. If it asks for detail or examples, expand the length as far as needed and give concrete, specific examples. Illustrative scenarios and examples are welcome; stating specifications, certifications or numbers that are not in the facts above is not.':''
  };
  return PROMPT_LAYERS.map(layer=>({...layer,body:bodies[layer.key]||''})).filter(layer=>layer.body);
 }
 function composeSystem(parts,omitted){
  const cut=new Set(omitted||[]);
  return parts.filter(part=>!cut.has(part.key)).map(part=>part.body).join('\n\n');
 }
 // Only editorial layers may be switched off. The shape and the contract are structural: without them
 // the model stops returning JSON at all, so a run would fail instead of producing something to compare.
 function parseOmit(value){
  if(value===undefined||value===null)return [];
  if(!Array.isArray(value))fail('The instruction layers could not be read.');
  const keys=[...new Set(value.map(v=>String(v).trim()).filter(Boolean))];
  for(const key of keys){
   if(LOCKED_LAYERS.has(key))fail('That layer cannot be switched off. The output shape and the output contract are structural - without them the model stops returning readable JSON.');
   if(!OMITTABLE_LAYERS.includes(key))fail('Unknown instruction layer: '+key);
  }
  return keys;
 }
 async function handle(request,user){
  if(request.method==='GET')return json({drafts:list(user),channels:channelList(),languages:languageList(),layers:PROMPT_LAYERS});
  if(request.method!=='POST')fail('Method not allowed.',405);
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)fail('Request origin is not allowed.',403);
  let body;try{body=await request.json();}catch{fail('The request could not be read.');}
  const action=typeof body.action==='string'?body.action:'';
  if(action==='delete'){
   const id=typeof body.id==='string'?body.id.trim().slice(0,80):'';
   if(!id)fail('Nothing to delete.');
   db.prepare('DELETE FROM text_drafts WHERE id=? AND user_id=?').run(id,user.id);
   return json({drafts:list(user)});
  }
  if(action!=='generate'&&action!=='compare')fail('Unknown text action.');
  const channel=String(body.channel||'');if(!CHANNELS[channel])fail('Choose a supported channel.');
  const language=String(body.language||'en');if(!LANGUAGES[language])fail('Choose a supported language.');
  const angle=typeof body.angle==='string'?body.angle.trim().slice(0,600):'';
  const productId=typeof body.productId==='string'?body.productId.trim().slice(0,80):'';
  const product=db.prepare('SELECT id,label,data FROM products WHERE id=?').get(productId);
  if(!product)fail('That product is not in the shared library.',404);
  const creds=credsFor(user.id);
  if(!creds.textModel)fail('The instructor needs to configure the language model ID before copy can be written.',503);
  let spec={};try{spec=JSON.parse(product.data);}catch{spec={};}
  const columns=columnRows();
  const values=prompts.values(user.id);
  const profile={rules:values.raw('text.agentRules'),skill:values.raw('text.agentSkill')};
  const ctx={product,columns,data:spec};
  const copyVars={channel:CHANNELS[channel].label.toLowerCase(),language:LANGUAGES[language]};
  const copy={
   role:values.text('text.role',copyVars),
   rules:values.text('text.rules',copyVars),
   contract:values.text('text.contract',copyVars),
   voice:values.text('text.'+channel+'.voice',copyVars),
   guidance:values.text('text.'+channel+'.guidance',copyVars),
   // The shape has to reach the model as parseable JSON, so it is never run through placeholder filling.
   shape:values.raw('text.'+channel+'.shape')
  };
  const parts=promptParts({channel,angle,facts:factsBlock(companyFacts()),spec:productBlock(columns,spec),profile,copy});
  // One round trip, up to three attempts: the model occasionally wraps its JSON in prose, breaks it
  // with a raw newline, or answers without JSON at all.
  async function writeCopy(omitted){
   const system=composeSystem(parts,omitted);
   const userMessage='Write the '+CHANNELS[channel].label.toLowerCase()+' for "'+product.label+'" in '+LANGUAGES[language]+'.'+(angle&&!omitted.includes('brief')?' The author\'s brief is above - obey it.':'');
   let blocks=null,usage=null;
   for(let attempt=0;attempt<3&&!blocks;attempt++){
    const extra=attempt===0?'':'\n\nReply with raw JSON only. No prose, no markdown fences, no bullet lists. Use exactly the keys in the shape above and finish every string.';
    const out=await provider('chat/completions',{model:creds.textModel,messages:[{role:'system',content:system},{role:'user',content:userMessage+extra}],max_tokens:2400},120000,creds);
    usage=(out&&out.usage)||usage;
    const parsed=extractJson(out&&out.choices&&out.choices[0]&&out.choices[0].message?out.choices[0].message.content:'');
    if(!parsed)continue;
    const built=buildSections(channel,parsed,ctx);
    // Derived rows are always available, so "did the model actually write something" is the
    // only test that distinguishes a real reply from an empty one.
    if(built.some(section=>section.source==='ai'))blocks=built;
   }
   if(!blocks)fail('The model did not return usable copy. Try again.',502);
   return {blocks,usage,system};
  }
  if(action==='compare'){
   // Fixed presets, so the comparison is the same lesson every time. The locked layers stay in both:
   // remove the shape and the model stops returning JSON, which fails instead of teaching anything.
   const presets=[
    {key:'baseline',label:'Everything you supplied',omit:[]},
    {key:'bare',label:'Only the task and the product name',omit:['voice','guidance','facts','specification','rules','profile']}
   ];
   const groupId=randomUUID(),runs=[];
   for(const preset of presets){
    const quota=reserve(user.id,'prompt');
    try{
     const {blocks,usage}=await writeCopy(preset.omit);
     const written=blocks.filter(section=>section.source==='ai');
     // How much editorial guidance (everything except the structural layers) each run received.
     const guidance=parts.filter(part=>!preset.omit.includes(part.key)&&!LOCKED_LAYERS.has(part.key));
     costs?.recordText({userId:user.id,stage:'Copy comparison',model:creds.textModel,groupId,groupKind:'text',groupLabel:product.label+' - '+preset.label,usage,chars:JSON.stringify(written).length});
     runs.push({...preset,sections:written,guidanceChars:guidance.reduce((n,p)=>n+p.body.length,0),layersSent:guidance.length});
    }catch(e){
     refund(quota,'prompt');
     runs.push({...preset,sections:[],error:e&&e.message?e.message:'That configuration did not return usable copy.'});
    }
   }
   return json({runs,product_label:product.label,channel});
  }
  const omitted=parseOmit(body.omit);
  const quota=reserve(user.id,'prompt');
  try{
   const {blocks,usage,system}=await writeCopy(omitted);
   const id=randomUUID(),stamp=new Date().toISOString();
   const sectionsText=JSON.stringify(blocks);
   const promptText=JSON.stringify({parts:parts.map(({key,title,body,locked})=>({key,title,body,locked:!!locked})),omitted,system});
   db.prepare('INSERT INTO text_drafts(id,user_id,product_id,product_label,channel,language,angle,sections,prompt,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,user.id,product.id,product.label,channel,language,angle,sectionsText,promptText,stamp);
   costs?.recordText({userId:user.id,stage:'Copy draft',model:creds.textModel,groupId:id,groupKind:'text',groupLabel:product.label+' - '+CHANNELS[channel].label,usage,chars:sectionsText.length});
   const draft={id,product_id:product.id,product_label:product.label,channel,language,angle,sections:blocks,prompt:parsePrompt(promptText),created_at:stamp};
   return json({draft,drafts:list(user)});
  }catch(e){
   refund(quota,'prompt');
   throw e;
  }
 }
 return {handle};
}
