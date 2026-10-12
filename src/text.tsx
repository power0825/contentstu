import {useEffect,useState,type ReactNode} from 'react';
import {PenLine,LoaderCircle,AlertCircle,CheckCircle2,Sparkles,Copy,Check,Trash2,RefreshCw,Globe,Camera,Briefcase,Save,ChevronDown,ChevronRight,Lock,Columns2} from 'lucide-react';
type Column={key:string;label:string};
type Product={id:string;label:string;data:Record<string,string>};
type Section={label:string;text?:string;items?:string[];source?:string};
type Layer={key:string;title:string;locked?:boolean};
type PromptPart={key:string;title:string;body:string;locked?:boolean};
type PromptRecord={parts:PromptPart[];omitted:string[];system:string};
type Draft={id:string;product_label:string;channel:string;language:string;angle:string;sections:Section[];prompt?:PromptRecord|null;created_at:string};
type Run={key:string;label:string;omit:string[];sections:Section[];guidanceChars?:number;layersSent?:number;error?:string};
const CHANNEL_ICON:Record<string,typeof Globe>={website:Globe,instagram:Camera,linkedin:Briefcase};
const OMIT_KEY='text-studio-omitted-layers';
const readOmitted=():string[]=>{try{const raw=localStorage.getItem(OMIT_KEY);const parsed=raw?JSON.parse(raw):[];return Array.isArray(parsed)?parsed.filter(v=>typeof v==='string'):[];}catch{return [];}};
// Where each block of a draft actually comes from. Older drafts stored no source, so they count as written.
const sourceOf=(s:Section)=>s.source||'ai';
const SOURCE_BADGE:Record<string,string>={ai:'AI written',library:'From library',fixed:'Fixed text'};
const sourceSummary=(sections:Section[])=>{
 const written=sections.filter(s=>sourceOf(s)==='ai').length,derived=sections.length-written;
 return derived?`${written} written · ${derived} from your data`:`${written} written`;
};
const copyText=(sections:Section[])=>sections.map(s=>s.items?`${s.label}:\n${s.items.join('\n')}`:`${s.label}:\n${s.text}`).join('\n\n');
function Disclosure({open,onToggle,icon,title,tag,children}:{open:boolean;onToggle:()=>void;icon:'rows'|'prompt';title:string;tag?:string;children?:ReactNode}){
 return <div className="disclosure">
  <button type="button" className="disclosure-head" aria-expanded={open} onClick={onToggle}>
   {open?<ChevronDown size={15}/>:<ChevronRight size={15}/>}
   {icon==='prompt'?<Sparkles size={14}/>:<Columns2 size={14}/>}
   <span>{title}</span>
   {tag&&<em className="disclosure-tag">{tag}</em>}
  </button>
  {open&&<div className="disclosure-body">{children}</div>}
 </div>;
}
export default function TextStudio(){
 const [products,setProducts]=useState<Product[]>([]),[columns,setColumns]=useState<Column[]>([]),[drafts,setDrafts]=useState<Draft[]>([]),[channels,setChannels]=useState<{id:string;label:string}[]>([]),[languages,setLanguages]=useState<{id:string;label:string}[]>([]),[layers,setLayers]=useState<Layer[]>([]);
 const [productId,setProductId]=useState(''),[channel,setChannel]=useState('website'),[language,setLanguage]=useState('en'),[angle,setAngle]=useState('');
 const [omitted,setOmitted]=useState<string[]>(()=>readOmitted());
 const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[copied,setCopied]=useState('');
 const [runs,setRuns]=useState<Run[]>([]),[showLayers,setShowLayers]=useState(false),[showPrompt,setShowPrompt]=useState(false);
 async function load(){
  try{const [l,t]=await Promise.all([fetch('/api/library').then(r=>r.json()),fetch('/api/text').then(r=>r.json())]);
   setProducts(l.products||[]);setColumns(l.columns||[]);setProductId(prev=>prev||l.products?.[0]?.id||'');
   setDrafts(t.drafts||[]);setLayers(t.layers||[]);setChannels(t.channels?.length?t.channels:[{id:'website',label:'Website page copy'},{id:'instagram',label:'Instagram post'},{id:'linkedin',label:'LinkedIn post'}]);setLanguages(t.languages?.length?t.languages:[{id:'en',label:'English'},{id:'zh',label:'Simplified Chinese'},{id:'ms',label:'Bahasa Melayu'}]);
  }catch(e){setError(e instanceof Error?e.message:'Could not load the studio.');}
 }
 useEffect(()=>{load();},[]);
 useEffect(()=>{try{localStorage.setItem(OMIT_KEY,JSON.stringify(omitted));}catch{}}, [omitted]);
 const toggleLayer=(key:string)=>setOmitted(prev=>prev.includes(key)?prev.filter(k=>k!==key):[...prev,key]);
 const activeLayers=layers.filter(l=>l.locked||!omitted.includes(l.key)).length;
 async function post(payload:Record<string,unknown>){
  const r=await fetch('/api/text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const d=await r.json();
  if(!r.ok)throw new Error(d.error||'That request did not go through.');
  return d;
 }
 async function generate(){
  setBusy('generate');setError('');setNotice('');
  try{const d=await post({action:'generate',productId,channel,language,angle,omit:omitted});setDraft(d.draft);setDrafts(d.drafts||[]);setShowPrompt(d.draft?.prompt?.omitted?.length>0);setNotice('Draft ready. Review it before you send it anywhere.');}
  catch(e){setError(e instanceof Error?e.message:'Could not write that draft.');}
  finally{setBusy('');}
 }
 async function compare(){
  setBusy('compare');setError('');setNotice('');
  try{const d=await post({action:'compare',productId,channel,language,angle});setRuns(d.runs||[]);}
  catch(e){setError(e instanceof Error?e.message:'Could not run that comparison.');}
  finally{setBusy('');}
 }
 async function remove(id:string){
  setBusy('delete');setError('');
  try{const r=await fetch('/api/text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',id})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not remove that draft.');setDrafts(d.drafts||[]);if(draft?.id===id)setDraft(null);}
  catch(e){setError(e instanceof Error?e.message:'Could not remove that draft.');}
  finally{setBusy('');}
 }
 async function copy(sections:Section[],mark='picked'){
  try{await navigator.clipboard.writeText(copyText(sections));setCopied(mark);setTimeout(()=>setCopied(''),1500);}catch{setError('Your browser blocked the clipboard. Select the text and copy it manually.');}
 }
 const product=products.find(p=>p.id===productId);
 const languageLabel=languages.find(l=>l.id===language)?.label||language;
 const written=draft?draft.sections.filter(s=>sourceOf(s)==='ai'):[];
 const derived=draft?draft.sections.filter(s=>sourceOf(s)!=='ai'):[];
 const record=draft?.prompt||null;
 const layerTitle=(key:string)=>layers.find(l=>l.key===key)?.title||key;
 function sectionBlock(s:Section,key:string){
  const badge=sourceOf(s);
  return <div className={`draft-section source-${badge}`} key={key}>
   <div className="draft-label"><span>{s.label}</span><span className="draft-tools"><em className={`source-badge ${badge}`}>{SOURCE_BADGE[badge]||badge}</em><button className="icon-button" title="Copy this block" onClick={async()=>{const t=s.items?s.items.join('\n'):s.text||'';try{await navigator.clipboard.writeText(t);setCopied(key);setTimeout(()=>setCopied(''),1500);}catch{setError('Your browser blocked the clipboard.');}}}>{copied===key?<Check size={14}/>:<Copy size={14}/>}</button></span></div>
   {s.items?<ul>{s.items.map((item,j)=><li key={j}>{item}</li>)}</ul>:<p>{s.text}</p>}
  </div>;
 }
 return <><div className="page-heading"><div><span className="eyebrow">TEXT STUDIO</span><h1>Copy that stays inside the facts.</h1><p>Pick a product from the shared library and write website, Instagram or LinkedIn copy from its real specifications.</p></div><button className="button secondary" disabled={!!busy} onClick={()=>load()}><RefreshCw size={17}/>Refresh</button></div>
 {error&&<div className="alert error" role="alert"><AlertCircle size={18}/><span>{error}</span></div>}
 {notice&&<div className="alert success" role="status"><CheckCircle2 size={18}/><span>{notice}</span></div>}
 {!products.length?<section className="panel history-empty"><PenLine size={38}/><h2>The library is empty.</h2><p>An administrator needs to import the product specification workbook before copy can be written.</p></section>:<div className="text-layout">
  <section className="panel">
   <div className="panel-heading"><h2>What should we write?</h2><span className="tag"><Sparkles size={13}/>{languageLabel}</span></div>
   <label>Product<select value={productId} onChange={e=>setProductId(e.target.value)}>{products.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
   <div className="channel-tabs">{channels.map(c=>{const Icon=CHANNEL_ICON[c.id]||Globe;return <button key={c.id} className={channel===c.id?'active':''} onClick={()=>setChannel(c.id)}><Icon size={16}/>{c.label}</button>;})}</div>
   <label>Language<select value={language} onChange={e=>setLanguage(e.target.value)}>{languages.map(l=><option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
   <label>Angle or must-mention (optional)<textarea rows={3} maxLength={600} value={angle} onChange={e=>setAngle(e.target.value)} placeholder="e.g. focus on four-way stretch for yoga brands, mention sample availability"/></label>
   <button className="button primary wide" disabled={!!busy||!productId} onClick={generate}>{busy==='generate'?<LoaderCircle className="spin" size={18}/>:<Sparkles size={18}/>}Write the copy</button>
   {product&&<div className="spec-preview"><h3>Facts the model will use</h3><dl>{columns.map(c=><div key={c.key}><dt>{c.label}</dt><dd>{product.data[c.key]||'not supplied'}</dd></div>)}</dl></div>}
   {!!layers.length&&<Disclosure open={showLayers} onToggle={()=>setShowLayers(v=>!v)} icon="rows" title="Instructions sent to the model" tag={`${activeLayers} of ${layers.length} on`}>
    <p className="disclosure-note">Every request is assembled from these layers. Switch one off and write again to see what it was doing — the draft keeps a record of which layers it used.</p>
    <div className="layer-list">{layers.map(l=><label key={l.key} className={l.locked?'layer-row locked':'layer-row'}>
     <input type="checkbox" disabled={l.locked} checked={l.locked||!omitted.includes(l.key)} onChange={()=>toggleLayer(l.key)}/>
     <span className="layer-name">{l.title}</span>
     {l.locked&&<Lock size={12} className="layer-lock"/>}
    </label>)}</div>
    {!!omitted.length&&<p className="disclosure-warn">{omitted.length} layer{omitted.length===1?'':'s'} currently switched off.</p>}
    <p className="disclosure-note">The layers marked with a lock are structural: without the output shape and the output contract the model stops returning readable JSON, so a run would fail instead of producing something to compare.</p>
   </Disclosure>}
   <button className="button secondary wide" disabled={!!busy||!productId} onClick={compare}>{busy==='compare'?<LoaderCircle className="spin" size={17}/>:<Columns2 size={17}/>}Compare: everything vs nothing</button>
   <p className="helper">Runs the same brief twice — once with everything above, once with only the task and the product name. Two model calls.</p>
  </section>
  <section className="panel">
   <div className="panel-heading"><h2>Draft</h2>{draft&&<span className="tag">{sourceSummary(draft.sections)}</span>}</div>
   {!draft?<div className="library-empty"><PenLine size={30}/><p>Your draft appears here. Nothing is published anywhere — this is a writing bench.</p></div>:<>
    <div className="draft-meta">{draft.product_label} · {channels.find(c=>c.id===draft.channel)?.label||draft.channel} · {languages.find(l=>l.id===draft.language)?.label||draft.language}</div>
    {draft.angle&&<p className="draft-angle"><span>Brief</span>{draft.angle}</p>}
    <div className="draft-group">
     <div className="draft-group-head"><span>Written for you</span>{derived.length>0&&<span className="draft-group-count">{written.length} of {draft.sections.length}</span>}<button className="button secondary small" onClick={()=>copy(written)}>{copied==='picked'?<Check size={15}/>:<Copy size={15}/>}Copy all</button></div>
     {written.map((s,i)=>sectionBlock(s,'w'+i))}
    </div>
    {derived.length>0&&<div className="draft-group derived">
     <div className="draft-group-head"><span>Already in your data</span><span className="draft-group-count">{derived.length} of {draft.sections.length}</span></div>
     <p className="draft-group-note">Read from the product library, or fixed wording the page reuses. The model did not write these — nothing here changes between drafts.</p>
     {derived.map((s,i)=>sectionBlock(s,'d'+i))}
    </div>}
    {record?<Disclosure open={showPrompt} onToggle={()=>setShowPrompt(v=>!v)} icon="prompt" title="What the model was told" tag={`${record.parts.length-record.omitted.length} of ${record.parts.length} layers`}>
     <p className="disclosure-note">The exact instruction text behind the draft above, saved with it. It is never rebuilt on read, because the product library and the agent config can change afterwards.</p>
     <div className="prompt-parts">{record.parts.map(p=>{
      const off=record.omitted.includes(p.key);
      return <div className={off?'prompt-part off':'prompt-part'} key={p.key}>
       <div className="prompt-part-head"><span>{p.title}</span>{p.locked&&<em className="prompt-flag locked"><Lock size={11}/>locked</em>}{off&&<em className="prompt-flag off">left out</em>}</div>
       <pre>{p.body}</pre>
      </div>;
     })}</div>
    </Disclosure>:<p className="disclosure-note standalone">This draft was written before the instructions were recorded, so there is nothing to show for it. Write a new draft to see them.</p>}
   </>}
  </section>
 </div>}
 {runs.length>0&&<section className="panel">
  <div className="panel-heading"><h2>Same task, different instructions</h2><button className="button secondary small" onClick={()=>setRuns([])}>Close</button></div>
  <p className="helper">Identical product, channel, language and brief. The only thing that changed is how much was explained to the model.</p>
  <div className="compare-columns">{runs.map(run=><div className="compare-column" key={run.key}>
   <div className="compare-head"><strong>{run.label}</strong><span>{run.layersSent} layers · {run.guidanceChars} characters of guidance</span>{run.omit.length>0&&<em className="compare-omit" title={run.omit.map(layerTitle).join(', ')}>left out {run.omit.length} layers</em>}</div>
   {run.error?<div className="alert error"><AlertCircle size={17}/><span>{run.error}</span></div>:run.sections.map((s,i)=><div className="compare-block" key={i}><span className="compare-label">{s.label}</span>{s.items?<ul>{s.items.map((item,j)=><li key={j}>{item}</li>)}</ul>:<p>{s.text}</p>}</div>)}
  </div>)}</div>
 </section>}
 {drafts.length>0&&<section className="panel admin-panel"><div className="panel-heading"><h2>Recent drafts</h2><span className="tag"><Save size={13}/>{drafts.length}</span></div><div className="admin-list">{drafts.map(d=><div key={d.id}><div className="admin-who"><strong>{d.product_label}</strong><span>{channels.find(c=>c.id===d.channel)?.label||d.channel} · {languages.find(l=>l.id===d.language)?.label||d.language} · {new Date(d.created_at).toLocaleString('en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}{d.prompt&&d.prompt.omitted.length>0&&<em className="draft-omit" title={'Left out: '+d.prompt.omitted.map(layerTitle).join(', ')}>−{d.prompt.omitted.length} layers</em>}</span></div><div className="admin-actions"><button className="button secondary small" onClick={()=>setDraft(d)}>Open</button><button className="icon-button danger" disabled={!!busy} onClick={()=>remove(d.id)} aria-label="Delete draft"><Trash2 size={16}/></button></div></div>)}</div></section>}
 </>;
}
