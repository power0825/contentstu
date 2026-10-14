"use client";
import { useEffect,useRef,useState } from "react";
import {t} from './i18n';
import { Upload,LoaderCircle,Check,X,AlertCircle,CheckCircle2 } from "lucide-react";

type Candidates={image:string[];video:string[]};
type Settings={configured:boolean;workspace:string;keyHint:string;imageModel:string;videoModel:string;connected:boolean;candidates:Candidates};

// A plain <input list> lets the browser filter the suggestions by whatever is already typed, which
// hides most of the list. A real <select> shows every candidate, and the "Other model" entry keeps
// the door open for a model that is not in the list yet.
function ModelField({label,value,options,placeholder,onChange}:{label:string;value:string;options:string[];placeholder:string;onChange:(v:string)=>void}){
 const [custom,setCustom]=useState(!!value&&!options.includes(value));
 if(custom)return <label className="modal-field">{label}<div className="model-custom"><input value={value} maxLength={80} spellCheck={false} placeholder={placeholder} onChange={e=>onChange(e.target.value)}/><button type="button" className="button secondary small" onClick={()=>{onChange(options[0]||"");setCustom(false);}}>{t("Pick from list")}</button></div></label>;
 return <label className="modal-field">{label}<select value={value} onChange={e=>{const v=e.target.value;if(v==="__other__"){setCustom(true);onChange("");}else onChange(v);}}>{!!value&&!options.includes(value)&&<option value={value}>{value}</option>}{options.map(m=><option key={m} value={m}>{m}</option>)}<option value="__other__">{t("Other model...")}</option></select></label>;
}

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

 async function save(){setBusy(t("Saving settings"));setError("");setNotice("");try{
  await api("/api/model-settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({imageModel,videoModel,apiKey})});
  setApiKey("");await load();onChanged();setNotice(t("Model settings saved."));setBusy("");
  window.setTimeout(onClose,900);
 }catch(e){setError(e instanceof Error?e.message:"Please try again.");setBusy("");}}

 const connected=!!data?.connected;
 const candidates=data?.candidates||{image:[],video:[]};

 return <div className="modal-backdrop" onMouseDown={onClose}>
  <div className="modal-card" onMouseDown={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("Model settings")}>
   <div className="modal-head">
    <div><h2>{t("Model settings")}</h2><p className="helper">{t("Run generations on your own Bailian key, so the free quota is yours to use.")}</p></div>
    <button className="icon-button" onClick={onClose} aria-label={t("Close")}><X size={18}/></button>
   </div>
   {error&&<div className="alert error" role="alert"><AlertCircle size={18}/><span>{t(error)}</span></div>}
   {notice&&<div className="alert success" role="status"><CheckCircle2 size={18}/>{t(notice)}</div>}
   <div className="modal-body">
    <section className="modal-section">
     <h3>{t("Bailian API key")}</h3>
     <div className={`key-status ${connected?"is-ready":""}`}>{connected?<><Check size={15}/><span>{data?.workspace||"Workspace"}</span><code>{data?.keyHint}</code></>:<><X size={15}/><span>{t("Not connected yet")}</span></>}</div>
     <p className="helper">{t("Download the apiKey file from the Bailian console — .xlsx or .csv — and upload it here. The key and endpoint are read automatically.")}</p>
     <div className="modal-row">
      <button className="button secondary" onClick={()=>fileRef.current?.click()} disabled={!!busy}>{busy==="Reading your file"?<LoaderCircle size={16} className="spin"/>:<Upload size={16}/>}Upload key file</button>
      <input ref={fileRef} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden" onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)upload(f);}}/>
     </div>
     <label className="modal-field">{t("Or paste the key manually")}<input type="password" value={apiKey} maxLength={200} autoComplete="off" spellCheck={false} onChange={e=>setApiKey(e.target.value)} placeholder={connected?t("Leave blank to keep the current key"):"sk-..."}/></label>
    </section>
    <section className="modal-section">
     <h3>{t("Model")}</h3>
     <p className="helper">{t("Each model has its own free quota. If one runs out, pick another and save.")}</p>
     <div className="field-grid">
      <ModelField label={t("Image model")} value={imageModel} options={candidates.image} placeholder="qwen-image-3.0" onChange={setImageModel}/>
      <ModelField label={t("Video model")} value={videoModel} options={candidates.video} placeholder="wan3.0-video" onChange={setVideoModel}/>
     </div>
    </section>
   </div>
   <div className="modal-foot">
    <span className="helper">{connected?t("Stored on this workspace only."):t("Connect a key before generating.")}</span>
    <div className="modal-actions">
     <button className="button secondary" onClick={onClose} disabled={!!busy}>{t("Close")}</button>
     <button className="button primary" onClick={save} disabled={!!busy||(!connected&&!apiKey.trim())}>{busy==="Saving settings"?<LoaderCircle size={16} className="spin"/>:<Check size={16}/>}Save</button>
    </div>
   </div>
  </div>
 </div>;
}
