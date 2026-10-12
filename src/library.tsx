import {useEffect,useRef,useState} from 'react';
import {Package,Upload,LoaderCircle,AlertCircle,CheckCircle2,Plus,Pencil,Trash2,RefreshCw,X,FileSpreadsheet,Save,Image as ImageIcon} from 'lucide-react';
type Column={key:string;label:string};
type Product={id:string;label:string;data:Record<string,string>;imageId:string};
type Payload={products:Product[];columns:Column[];source:string;importedAt:string;importedBy:string;notice?:string};
const blank=(columns:Column[])=>({id:'',label:'',data:Object.fromEntries(columns.map(c=>[c.key,''])),imageId:''});
const imageUrl=(id:string)=>`/api/library/image/${id}`;
export default function Library({user}:{user:{id:string;email:string;role?:string}}){
 const admin=user.role==='admin';
 const [data,setData]=useState<Payload|null>(null),[selected,setSelected]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [draft,setDraft]=useState<Product|null>(null);
 const fileInput=useRef<HTMLInputElement>(null),imageInput=useRef<HTMLInputElement>(null);
 async function load(pick?:string){
  try{const r=await fetch('/api/library');const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load the library.');setData(d);setSelected(cur=>pick||(cur&&d.products.some((p:Product)=>p.id===cur)?cur:d.products[0]?.id||''));}
  catch(e){setError(e instanceof Error?e.message:'Could not load the library.');}
 }
 useEffect(()=>{load();},[]);
 async function send(body:unknown,label:string,done?:'product'){
  setBusy(label);setError('');setNotice('');
  try{const r=await fetch('/api/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'That action failed.');setData(d);setNotice(d.notice||'Saved.');if(done==='product')setDraft(null);return d;}
  catch(e){setError(e instanceof Error?e.message:'That action failed.');}
  finally{setBusy('');}
 }
 async function post(form:FormData,label:string,pick?:string){
  setBusy(label);setError('');setNotice('');
  try{const r=await fetch('/api/library',{method:'POST',body:form});const d=await r.json();if(!r.ok)throw new Error(d.error||'That action failed.');setData(d);setNotice(d.notice||'Saved.');if(pick)setSelected(pick);}
  catch(e){setError(e instanceof Error?e.message:'That action failed.');}
  finally{setBusy('');}
 }
 const current=data?.products.find(p=>p.id===selected)||null;
 const when=(v:string)=>{if(!v)return 'never';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('en',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});};
 const summary=(p:Product)=>[p.data.composition,p.data.weight_gsm?`${p.data.weight_gsm} GSM`:''].filter(Boolean).join(' · ');
 return <><div className="page-heading"><div><span className="eyebrow">SHARED PRODUCT LIBRARY</span><h1>The products behind every draft.</h1><p>Import the master specification workbook once, then add a base picture to each product. Everyone in the studio works from the same facts.</p></div><div className="heading-actions">{admin&&<label className="button primary"><Upload size={17}/>{busy==='import'?<LoaderCircle className="spin" size={17}/>:'Import Excel'}<input type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" disabled={!!busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f){const form=new FormData();form.append('file',f);post(form,'import');}}}/></label>}<button className="button secondary" disabled={!!busy} onClick={()=>load()}><RefreshCw size={17}/>Refresh</button></div></div>
 {error&&<div className="alert error" role="alert"><AlertCircle size={18}/><span>{error}</span></div>}
 {notice&&<div className="alert success" role="status"><CheckCircle2 size={18}/><span>{notice}</span></div>}
 {!data?<section className="panel history-empty"><LoaderCircle className="spin" size={32}/><p>Loading the library…</p></section>:!data.products.length?<section className="panel history-empty"><FileSpreadsheet size={38}/><h2>No products yet.</h2><p>{admin?'Import the specification workbook to fill the library.':'Ask an administrator to import the product workbook.'}</p></section>:<div className="library-layout">
  <aside className="panel library-list">
   <div className="panel-heading"><h2>Products</h2><span className="tag">{data.products.length}</span></div>
   <div className="library-items">{data.products.map(p=><button key={p.id} className={p.id===selected?'library-item active':'library-item'} onClick={()=>{setSelected(p.id);setDraft(null);}}>
    <span className="library-thumb">{p.imageId?<img src={imageUrl(p.imageId)} alt=""/>:<ImageIcon size={20}/>}</span>
    <span className="library-item-text"><strong>{p.label}</strong><small>{summary(p)||'No specification yet'}</small></span>
   </button>)}</div>
   {admin&&<button className="button secondary wide" disabled={!!busy||!data.columns.length} onClick={()=>setDraft(blank(data.columns))}><Plus size={16}/>Add product</button>}
   <p className="helper library-source">Source: {data.source||'no workbook imported'} · {when(data.importedAt)}{data.importedBy?` · ${data.importedBy}`:''}</p>
  </aside>
  <section className="panel library-detail">
   {draft?<>
    <div className="panel-heading"><h2>{draft.id?`Edit ${draft.label||'product'}`:'New product'}</h2><button className="icon-button" onClick={()=>setDraft(null)} aria-label="Close"><X size={18}/></button></div>
    <div className="field-grid">{data.columns.map(c=><label key={c.key}>{c.label}<input value={draft.data[c.key]||''} maxLength={600} onChange={e=>setDraft({...draft,data:{...draft.data,[c.key]:e.target.value}})}/></label>)}</div>
    <div className="heading-actions"><button className="button primary" disabled={!!busy} onClick={async()=>{const d=await send({action:'save',product:draft},'save','product');const saved=d?.products.find((p:Product)=>p.label===(draft.label||draft.data[data.columns.find(c=>/categor|name|product|title|item/i.test(c.key))?.key||'']));if(saved)setSelected(saved.id);}}>{busy==='save'?<LoaderCircle className="spin" size={17}/>:<Save size={17}/>}Save product</button><button className="button secondary" disabled={!!busy} onClick={()=>setDraft(null)}>Cancel</button></div>
    {draft.id?<p className="helper">A picture can be added once the product is saved.</p>:null}
   </>:!current?<div className="library-empty"><Package size={30}/><p>Choose a product on the left to see its specification.</p></div>:<>
    <div className="detail-head">
     <div className="detail-image">{current.imageId?<img src={imageUrl(current.imageId)} alt={current.label}/>:<div className="detail-image-empty"><ImageIcon size={30}/><span>No picture yet</span></div>}{admin&&<label className="button secondary small detail-upload">{busy==='image'?<LoaderCircle className="spin" size={15}/>:<Upload size={15}/>}{current.imageId?'Replace picture':'Upload picture'}<input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={!!busy} onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;const form=new FormData();form.append('productId',current.id);form.append('image',f);await post(form,'image',current.id);}}/></label>}</div>
     <div className="detail-summary">
      <h2>{current.label}</h2>
      <p>{summary(current)||'Specification not filled in yet.'}</p>
      <div className="admin-actions">{admin&&<><button className="button secondary small" disabled={!!busy} onClick={()=>setDraft({...current,data:{...Object.fromEntries(data.columns.map(c=>[c.key,''])),...current.data}})}><Pencil size={15}/>Edit</button>{current.imageId&&<button className="button secondary small" disabled={!!busy} onClick={()=>send({action:'removeImage',id:current.id},'removeImage')}>Remove picture</button>}<button className="button secondary small" disabled={!!busy} onClick={()=>{if(confirm(`Remove ${current.label} from the shared library?`))send({action:'delete',id:current.id},'delete');}}><Trash2 size={15}/>Delete</button></>}</div>
     </div>
    </div>
    <dl className="detail-fields">{data.columns.map(c=><div key={c.key}><dt>{c.label}</dt><dd>{current.data[c.key]||'—'}</dd></div>)}</dl>
   </>}
   {admin&&!draft&&current&&<div className="panel-footer-actions"><button className="button secondary small" disabled={!!busy} onClick={()=>{if(confirm('Remove every product from the shared library?'))send({action:'clear'},'clear');}}>Clear the whole library</button></div>}
  </section>
 </div>}
 </>;
}
