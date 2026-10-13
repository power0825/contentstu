"use client";
import { useEffect,useRef,useState } from "react";
import { Upload,LoaderCircle,Check,X,AlertCircle,CheckCircle2 } from "lucide-react";

type Candidates={image:string[];video:string[]};
type Settings={configured:boolean;workspace:string;keyHint:string;imageModel:string;videoModel:string;connected:boolean;candidates:Candidates};

export default function ModelSettings({onClose,onChanged}:{onClose:()=>void;onChanged:()=>void}){
 const [data,setData]=useState<Settings|null>(null);
 const [imageModel,setImageModel]=useState("");
 const [videoModel,setVideoModel]=useState("");
 const [apiKey,setApiKey]=useState("");
 const [busy,setBusy]=useState("");
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const fileRef=useRef<HTMLInputElement>(null);

 async function api(path:string,options?:RequestInit){const r=await fetch(path,options);const d=await r.json() as any;if(!r.ok)throw new Error(d.error||"Could not complete this request.");return d;}
 async function load(){const d=await api("/api/model-settings") as Settings;setData(d);setImageModel(d.imageModel||"");setVideoModel(d.videoModel||"");}
 useEffect(()=>{load().catch(e=>setError(e instanceof Error?e.message:"Could not load your model settings."));},[]);

 async function run(name:string,fn:()=>Promise<void>){setBusy(name);setError("");setNotice("");try{await fn();}catch(e){setError(e instanceof Error?e.message:"Please try again.");}finally{setBusy("");}}

 async function upload(f:File){await run("Reading your file",async()=>{
  const form=new FormData();form.append("file",f);
  const d=await api("/api/model-settings",{method:"POST",body:form});
  setNotice(`Connected ${d.workspace||"your workspace"} · ${d.keyHint}`);
  await load();onChanged();
 });}

 async function save(){await run("Saving settings",async()=>{
  await api("/api/model-settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({imageModel,videoModel,apiKey})});
  setApiKey("");await load();onChanged();setNotice("Model settings saved.");
 });}

 const connected=!!data?.connected;
 const candidates=data?.candidates||{image:[],video:[]};

 return <div className="modal-backdrop" onMouseDown={onClose}>
  <div className="modal-card" onMouseDown={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Model settings">
   <div className="modal-head">
    <div><h2>Model settings</h2><p className="helper">Run generations on your own Bailian key, so the free quota is yours to use.</p></div>
    <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button>
   </div>
   {error&&<div className="alert error" role="alert"><AlertCircle size={18}/><span>{error}</span></div>}
   {notice&&<div className="alert success" role="status"><CheckCircle2 size={18}/>{notice}</div>}
   <div className="modal-body">
    <section className="modal-section">
     <h3>Bailian API key</h3>
     <div className={`key-status ${connected?"is-ready":""}`}>{connected?<><Check size={15}/><span>{data?.workspace||"Workspace"}</span><code>{data?.keyHint}</code></>:<><X size={15}/><span>Not connected yet</span></>}</div>
     <p className="helper">Download the apiKey file from the Bailian console — .xlsx or .csv — and upload it here. The key and endpoint are read automatically.</p>
     <div className="modal-row">
      <button className="button secondary" onClick={()=>fileRef.current?.click()} disabled={!!busy}>{busy==="Reading your file"?<LoaderCircle size={16} className="spin"/>:<Upload size={16}/>}Upload key file</button>
      <input ref={fileRef} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden" onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)upload(f);}}/>
     </div>
     <label className="modal-field">Or paste the key manually<input type="password" value={apiKey} maxLength={200} autoComplete="off" spellCheck={false} onChange={e=>setApiKey(e.target.value)} placeholder={connected?"Leave blank to keep the current key":"sk-..."}/></label>
    </section>
    <section className="modal-section">
     <h3>Model</h3>
     <p className="helper">Each model has its own free quota. If one runs out, pick another and save.</p>
     <div className="field-grid">
      <label className="modal-field">Image model<input list="image-model-options" value={imageModel} maxLength={80} spellCheck={false} onChange={e=>setImageModel(e.target.value)} placeholder="qwen-image-3.0"/><datalist id="image-model-options">{candidates.image.map(m=><option key={m} value={m}/>)}</datalist></label>
      <label className="modal-field">Video model<input list="video-model-options" value={videoModel} maxLength={80} spellCheck={false} onChange={e=>setVideoModel(e.target.value)} placeholder="wan3.0-video"/><datalist id="video-model-options">{candidates.video.map(m=><option key={m} value={m}/>)}</datalist></label>
     </div>
    </section>
   </div>
   <div className="modal-foot">
    <span className="helper">{connected?"Stored on this workspace only.":"Connect a key before generating."}</span>
    <div className="modal-actions">
     <button className="button secondary" onClick={onClose} disabled={!!busy}>Close</button>
     <button className="button primary" onClick={save} disabled={!!busy||(!connected&&!apiKey.trim())}>{busy==="Saving settings"?<LoaderCircle size={16} className="spin"/>:<Check size={16}/>}Save</button>
    </div>
   </div>
  </div>
 </div>;
}
