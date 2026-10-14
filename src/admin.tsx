import {useEffect,useState} from 'react';
import {t} from './i18n';
import {ShieldCheck,LoaderCircle,AlertCircle,CheckCircle2,Check,X,UserCog,Trash2,KeyRound,RefreshCw} from 'lucide-react';
type Account={id:string;email:string;status:string;role:string;label:string;created_at:string;generations:number;self:boolean};
type Payload={users:Account[];counts:{pending:number;approved:number;rejected:number};self:{id:string;email:string};notice?:string};
export default function Admin({user}:{user:{id:string;email:string}}){
 const [data,setData]=useState<Payload|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[current,setCurrent]=useState(''),[next,setNext]=useState('');
 async function load(){try{const r=await fetch('/api/admin');const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load accounts.');setData(d);}catch(e){setError(e instanceof Error?e.message:'Could not load accounts.');}}
 useEffect(()=>{load();},[]);
 async function send(action:string,userId:string,extra:Record<string,string>={}){
  setBusy(action+userId);setError('');setNotice('');
  try{const r=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,userId,...extra})});const d=await r.json();if(!r.ok)throw new Error(d.error||'That action failed.');setData(d);setNotice(d.notice||'Saved.');}
  catch(e){setError(e instanceof Error?e.message:'That action failed.');}
  finally{setBusy('');}
 }
 async function changePassword(e:React.FormEvent){
  e.preventDefault();setBusy('password');setError('');setNotice('');
  try{const r=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'password',current,password:next})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not update the password.');setNotice(d.notice||'Password updated.');setCurrent('');setNext('');}
  catch(e){setError(e instanceof Error?e.message:'Could not update the password.');}
  finally{setBusy('');}
 }
 const today=(v:string)=>{const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('en',{year:'numeric',month:'short',day:'numeric'});};
 return <><div className="page-heading"><div><span className="eyebrow">{t("ACCOUNT APPROVALS")}</span><h1>{t("Who can use the studio.")}</h1><p>{t("New registrations wait here until you approve them. Declined accounts keep their data but cannot sign in.")}</p></div><button className="button secondary" disabled={!!busy} onClick={()=>load()}><RefreshCw size={17}/>{t("Refresh")}</button></div>
 {error&&<div className="alert error" role="alert"><AlertCircle size={18}/><span>{t(error)}</span></div>}
 {notice&&<div className="alert success" role="status"><CheckCircle2 size={18}/><span>{t(notice)}</span></div>}
 {!data?<section className="panel history-empty"><LoaderCircle className="spin" size={32}/><p>{t("Loading accounts…")}</p></section>:<>
  <div className="admin-stats">
   <div className="admin-stat waiting"><strong>{data.counts.pending}</strong><span>{t("Waiting for approval")}</span></div>
   <div className="admin-stat active"><strong>{data.counts.approved}</strong><span>{t("Active accounts")}</span></div>
   <div className="admin-stat declined"><strong>{data.counts.rejected}</strong><span>{t("Declined")}</span></div>
  </div>
  <section className="panel admin-panel">
   <div className="panel-heading"><h2>{t("All accounts")}</h2><span className="tag"><UserCog size={13}/>{user.email}</span></div>
   <div className="admin-list">
    {data.users.map(u=><div className={`admin-row ${u.status}`} key={u.id}>
     <div className="admin-who"><strong>{u.email}{u.self&&<em>you</em>}</strong><span>{u.role==='admin'?t("Administrator"):t("Member")} · joined {today(u.created_at)} · {u.generations} image{u.generations===1?'':'s'}</span></div>
     <span className={`status-chip ${u.status}`}>{u.label}</span>
     <div className="admin-actions">
      {u.status!=='approved'&&<button className="button primary small" disabled={!!busy} onClick={()=>send('approve',u.id)}>{busy==='approve'+u.id?<LoaderCircle className="spin" size={15}/>:<Check size={15}/>}Approve</button>}
      {u.status==='approved'&&!u.self&&<button className="button secondary small" disabled={!!busy} onClick={()=>send('reject',u.id)}>{busy==='reject'+u.id?<LoaderCircle className="spin" size={15}/>:<X size={15}/>}Decline</button>}
      {u.status==='approved'&&(u.role==='admin'?(!u.self&&<button className="button secondary small" disabled={!!busy} onClick={()=>send('demote',u.id)}>{t("Remove admin")}</button>):<button className="button secondary small" disabled={!!busy} onClick={()=>send('promote',u.id)}><ShieldCheck size={15}/>{t("Make admin")}</button>)}
      {!u.self&&<button className="icon-button danger" title={t("Delete account and files")} disabled={!!busy} onClick={()=>{if(confirm(`Delete ${u.email} and all their files? This cannot be undone.`))send('delete',u.id);}}><Trash2 size={17}/></button>}
     </div>
    </div>)}
   </div>
  </section>
  <section className="panel admin-password">
   <div className="panel-heading"><h2>{t("Your administrator password")}</h2><span className="tag"><KeyRound size={13}/>sign-in</span></div>
   <p className="helper">{t("The studio ships with a default administrator password. Change it before sharing the link with anyone.")}</p>
   <form onSubmit={changePassword}><label>{t("Current password")}<input type="password" autoComplete="current-password" required maxLength={128} value={current} onChange={e=>setCurrent(e.target.value)}/></label><label>{t("New password")}<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={next} onChange={e=>setNext(e.target.value)}/></label><button className="button secondary" disabled={!!busy}>{busy==='password'&&<LoaderCircle className="spin" size={16}/>}Update password</button></form>
  </section>
 </>}</>;
}
