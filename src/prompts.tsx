import {useEffect,useState} from 'react';
import {AlertCircle,CheckCircle2,LoaderCircle,RotateCcw,Save,Lock,RefreshCw,Info,Type,Image as ImageIcon,Film} from 'lucide-react';
type Field={key:string;label:string;header:string;help:string;rows:number;structural:boolean;placeholders:string[];default:string;value:string;overridden:boolean};
type Group={name:string;fields:Field[]};
type Tab={id:string;label:string;help:string;groups:Group[];total:number;overridden:number};
const TAB_ICON:Record<string,typeof Type>={text:Type,image:ImageIcon,video:Film};
export default function PromptSettings(){
 const [tabs,setTabs]=useState<Tab[]>([]),[active,setActive]=useState('text'),[overridden,setOverridden]=useState(0),[total,setTotal]=useState(0);
 const [edits,setEdits]=useState<Record<string,string>>({}),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loaded,setLoaded]=useState(false);
 const apply=(d:{tabs?:Tab[];overridden?:number;total?:number})=>{if(d.tabs)setTabs(d.tabs);if(typeof d.overridden==='number')setOverridden(d.overridden);if(typeof d.total==='number')setTotal(d.total);};
 async function load(){
  try{const r=await fetch('/api/prompts');const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load the prompts.');apply(d);setLoaded(true);}
  catch(e){setError(e instanceof Error?e.message:'Could not load the prompts.');}
 }
 useEffect(()=>{load();},[]);
 async function send(payload:Record<string,unknown>,key:string,message:string){
  setBusy(key);setError('');setNotice('');
  try{
   const r=await fetch('/api/prompts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const d=await r.json();
   if(!r.ok)throw new Error(d.error||'That change was not saved.');
   apply(d);
   if(payload.action==='save')setEdits(prev=>{const next={...prev};Object.keys(payload.values as Record<string,string>).forEach(k=>delete next[k]);return next;});
   else setEdits({});
   setNotice(message);
  }catch(e){setError(e instanceof Error?e.message:'That change was not saved.');}
  finally{setBusy('');}
 }
 const allFields=tabs.flatMap(tab=>tab.groups.flatMap(group=>group.fields));
 const valueOf=(f:Field)=>edits[f.key]!==undefined?edits[f.key]:f.value;
 const isDirty=(f:Field)=>edits[f.key]!==undefined&&edits[f.key]!==f.value;
 const dirtyIn=(fields:Field[])=>fields.filter(isDirty).length;
 const dirtyCount=allFields.filter(isDirty).length;
 const current=tabs.find(tab=>tab.id===active)||tabs[0];
 function field(f:Field){
  const dirty=isDirty(f),value=valueOf(f);
  return <div className={f.structural?'prompt-field structural':'prompt-field'} key={f.key}>
   <div className="prompt-field-head">
    <span className="prompt-field-label">{f.label}</span>
    {f.structural&&<em className="prompt-flag locked"><Lock size={11}/>structural</em>}
    {f.overridden&&<em className="prompt-flag edited">edited</em>}
   </div>
   {f.header&&<code className="prompt-header">{f.header.replace(/\n$/,'')}</code>}
   <textarea className={f.structural?'prompt-editor mono':'prompt-editor'} rows={f.rows} spellCheck={false} value={value} onChange={e=>setEdits(prev=>({...prev,[f.key]:e.target.value}))}/>
   <p className="prompt-field-help">{f.help}</p>
   {!!f.placeholders.length&&<p className="prompt-field-help tokens">Filled in automatically: {f.placeholders.map(p=>'{'+p+'}').join('  ')}</p>}
   <div className="prompt-field-foot">
    <span>{value.length.toLocaleString()} characters{dirty?' · unsaved':''}</span>
    <div className="prompt-field-actions">
     {dirty&&<button className="button secondary small" disabled={!!busy} onClick={()=>setEdits(prev=>{const next={...prev};delete next[f.key];return next;})}>Discard</button>}
     <button className="button secondary small" disabled={!!busy||!f.overridden} onClick={()=>send({action:'reset',keys:[f.key]},f.key,f.label+' is back to the shipped default.')}><RotateCcw size={14}/>Reset</button>
     <button className="button primary small" disabled={!!busy||!dirty} onClick={()=>send({action:'save',values:{[f.key]:value}},'save-'+f.key,'Saved. New requests use this text.')}>{busy==='save-'+f.key?<LoaderCircle className="spin" size={14}/>:<Save size={14}/>}Save</button>
    </div>
   </div>
  </div>;
 }
 if(!loaded)return <section className="panel history-empty"><LoaderCircle className="spin" size={34}/><h2>Loading the prompts…</h2></section>;
 return <>
  <div className="page-heading"><div><span className="eyebrow">PROMPT SETTINGS</span><h1>See exactly what the model is told.</h1><p>Every instruction the studio sends lives here as plain text. Change one, save it, and the next request uses your wording. These edits belong to your account only — nobody else's results change.</p></div><div className="heading-actions"><button className="button secondary" disabled={!!busy} onClick={()=>load()}><RefreshCw size={17}/>Refresh</button><button className="button secondary" disabled={!!busy||!overridden} onClick={()=>send({action:'reset'},'all','All prompts are back to the shipped defaults.')}>{busy==='all'?<LoaderCircle className="spin" size={17}/>:<RotateCcw size={17}/>}Reset everything</button></div></div>
  {error&&<div className="alert error" role="alert"><AlertCircle size={18}/><span>{error}</span></div>}
  {notice&&<div className="alert success" role="status"><CheckCircle2 size={18}/><span>{notice}</span></div>}
  <div className="channel-tabs prompt-tabs">{tabs.map(tab=>{const Icon=TAB_ICON[tab.id]||Type;const dirty=dirtyIn(tab.groups.flatMap(g=>g.fields));return <button key={tab.id} className={current&&current.id===tab.id?'active':''} onClick={()=>setActive(tab.id)} disabled={!!busy}><Icon size={16}/>{tab.label}{tab.overridden>0&&<em className="prompt-tab-count">{tab.overridden}</em>}{dirty>0&&<em className="prompt-tab-dirty">{dirty} unsaved</em>}</button>;})}</div>
  <section className="panel prompt-summary">
   <div className="prompt-summary-row"><Info size={18}/><div><strong>{total} prompt fields · {overridden?overridden+' changed on your account':'running the shipped defaults'}</strong><span>{current?current.help:''}{dirtyCount?'  ·  '+dirtyCount+' unsaved edit'+(dirtyCount===1?'':'s')+' on this page.':''}</span></div></div>
   <div className="working-note"><Lock size={17}/><div><strong>Fields marked structural control how the app reads a result back</strong><p>The studio checks them before saving, so a broken key gets a plain explanation instead of a failed request. Anything you leave alone still comes from the shipped default, which is what Reset restores.</p></div></div>
  </section>
  {current&&current.groups.map(group=><section className="panel" key={group.name}>
   <div className="panel-heading"><h2>{group.name}</h2><span className="tag">{group.fields.length} field{group.fields.length===1?'':'s'}</span></div>
   {group.fields.map(field)}
  </section>)}
 </>;
}
