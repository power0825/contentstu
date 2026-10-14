import {useEffect,useState} from 'react';
import {Receipt,LoaderCircle,AlertCircle,RefreshCw,ChevronDown,ChevronRight,Type,Image as ImageIcon,Film,ExternalLink,Info} from 'lucide-react';
type Item={id:string;stage:string;kind:string;model:string;units:number;unitLabel:string;unitPrice:number;cost:number;detail:Record<string,unknown>;created_at:string;currency?:string;user?:string};
type Group={id:string;kind:string;label:string;created_at:string;total:number;items:Item[]};
type Payload={scope:string;kind:string;range:string;totals:{all:number;text:number;image:number;video:number;events:number;units:{tokens:number;image:number;second:number}};groups:Group[];daily:{day:string;cost:number}[];pricing:{currency:string;verified:string;sources:Record<string,string>;text:{input:number;output:number;cached:number;unit:string};image:{perImage:number;unit:string};video:{'480P':number;'720P':number;'1080P':number;unit:string};models:{text:string;image:string;video:string}}};
const SYMBOL:Record<string,string>={USD:'$',CNY:'¥'};
const symbolOf=(currency:string)=>SYMBOL[currency]||'$';
const money=(n:number,currency='USD')=>`${symbolOf(currency)}${n<0.01&&n>0?n.toFixed(4):n.toFixed(2)}`;
const kindIcon=(kind:string)=>kind==='video'?Film:kind==='image'?ImageIcon:Type;
const KIND_LABEL:Record<string,string>={text:'Language model',image:'Image model',video:'Video model'};
export default function Costs({user}:{user:{id:string;email:string;role?:string}}){
 const [data,setData]=useState<Payload|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [kind,setKind]=useState(''),[range,setRange]=useState('all'),[scope,setScope]=useState('mine'),[open,setOpen]=useState<Record<string,boolean>>({});
 async function load(){
  setBusy(true);setError('');
  try{const r=await fetch(`/api/costs?scope=${scope}&range=${range}${kind?`&kind=${kind}`:''}`);const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load costs.');setData(d);}
  catch(e){setError(e instanceof Error?e.message:'Could not load costs.');}
  finally{setBusy(false);}
 }
 useEffect(()=>{load();},[kind,range,scope]);
 const when=(v:string)=>new Date(v).toLocaleString('en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
 return <><div className="page-heading"><div><span className="eyebrow">USAGE &amp; COST</span><h1>What each film and image actually cost.</h1><p>Every model call is logged with its unit price, so you can see the script, the keyframes and the video itself priced separately.</p></div><button className="button secondary" disabled={busy} onClick={()=>load()}>{busy?<LoaderCircle className="spin" size={17}/>:<RefreshCw size={17}/>}Refresh</button></div>
 {error&&<div className="alert error" role="alert"><AlertCircle size={18}/><span>{error}</span></div>}
 <div className="cost-filters"><div className="channel-tabs">{[{id:'',label:'Everything'},{id:'text',label:'Language'},{id:'image',label:'Image'},{id:'video',label:'Video'}].map(f=><button key={f.id} className={kind===f.id?'active':''} onClick={()=>setKind(f.id)}>{f.label}</button>)}</div><div className="cost-controls"><select value={range} onChange={e=>setRange(e.target.value)}><option value="all">All time</option><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select>{user.role==='admin'&&<select value={scope} onChange={e=>setScope(e.target.value)}><option value="mine">My usage</option><option value="all">All members</option></select>}</div></div>
 {!data?<section className="panel history-empty">{busy?<LoaderCircle className="spin" size={32}/>:<Receipt size={34}/>}<p>Loading costs…</p></section>:<>
  <div className="admin-stats cost-stats">
   <div className="admin-stat"><strong>{money(data.totals.all)}</strong><span>Total spend · {data.totals.events} model call{data.totals.events===1?'':'s'}</span></div>
   <div className="admin-stat waiting"><strong>{money(data.totals.text)}</strong><span>{KIND_LABEL.text} · {Math.round(data.totals.units.tokens).toLocaleString()} tokens</span></div>
   <div className="admin-stat active"><strong>{money(data.totals.image)}</strong><span>{KIND_LABEL.image} · {data.totals.units.image} image{data.totals.units.image===1?'':'s'}</span></div>
   <div className="admin-stat declined"><strong>{money(data.totals.video)}</strong><span>{KIND_LABEL.video} · {Math.round(data.totals.units.second)} seconds</span></div>
  </div>
  {data.daily.length>1&&<section className="panel cost-daily"><div className="panel-heading"><h2>By day</h2></div><div className="cost-bars">{data.daily.slice(0,14).reverse().map(d=>{const max=Math.max(...data.daily.map(x=>x.cost))||1;return <div key={d.day} className="cost-bar"><span style={{height:`${Math.max(3,(d.cost/max)*100)}%`}} title={`${d.day} · ${money(d.cost)}`}/><small>{d.day.slice(5)}</small><em>{money(d.cost)}</em></div>;})}</div></section>}
  {!data.groups.length?<section className="panel history-empty"><Receipt size={34}/><h2>Nothing has been generated yet.</h2><p>Costs appear here after the first prompt, image or video is produced.</p></section>:<section className="panel cost-groups"><div className="panel-heading"><h2>{data.scope==='all'?'All members':'Your generations'}</h2><span className="tag">{data.groups.length}</span></div>
   {data.groups.map(g=>{const Icon=kindIcon(g.kind);const expanded=open[g.id]!==false;return <div className="cost-group" key={g.id}>
    <button className="cost-group-head" onClick={()=>setOpen({...open,[g.id]:!expanded})}>{expanded?<ChevronDown size={17}/>:<ChevronRight size={17}/>}<span className={`cost-kind ${g.kind}`}><Icon size={14}/>{KIND_LABEL[g.kind]||g.kind}</span><strong>{g.label||'Untitled'}</strong><small>{when(g.created_at)} · {g.items.length} call{g.items.length===1?'':'s'}</small><b>{money(g.total)}</b></button>
    {expanded&&<div className="cost-items">{g.items.map(item=><div className="cost-item" key={item.id}>
     <span className={`cost-kind ${item.kind}`}>{item.kind}</span>
     <span className="cost-stage">{item.stage}{item.user&&<em>{item.user}</em>}</span>
     <code>{item.model}</code>
     <span className="cost-units">{item.unitLabel==='tokens'?`${Number((item.detail.inputTokens as number)||0).toLocaleString()} in / ${Number((item.detail.outputTokens as number)||0).toLocaleString()} out`:`${item.units} ${item.unitLabel}${item.units===1?'':'s'} × ${symbolOf(item.currency||data.pricing.currency)}${item.unitPrice}`}</span>
     {Boolean(item.detail.estimated)&&<span className="cost-flag" title="The provider did not return token usage, so tokens were estimated from text length.">estimated</span>}
     {typeof item.detail.resolution==='string'&&item.detail.resolution?<span className="cost-flag">{item.detail.resolution}</span>:null}
     <b>{money(item.cost,item.currency||data.pricing.currency)}</b>
    </div>)}</div>}
   </div>;})}
  </section>}
  <section className="panel cost-pricing">
   <div className="panel-heading"><h2>Prices used</h2><span className="tag"><Info size={13}/>verified {data.pricing.verified}</span></div>
   <p className="helper">Official list prices for the Singapore region, in {data.pricing.currency}. Override any of them in the .env file (PRICE_TEXT_INPUT, PRICE_TEXT_OUTPUT, PRICE_IMAGE, PRICE_VIDEO_720P …) if your account has different terms.</p>
   <div className="price-grid">
    <div><span className="eyebrow">LANGUAGE MODEL</span><code>{data.pricing.models.text}</code><ul><li>Input {symbolOf(data.pricing.currency)}{data.pricing.text.input} {data.pricing.text.unit}</li><li>Output {symbolOf(data.pricing.currency)}{data.pricing.text.output} {data.pricing.text.unit}</li><li>Cache hit {symbolOf(data.pricing.currency)}{data.pricing.text.cached} {data.pricing.text.unit}</li></ul></div>
    <div><span className="eyebrow">IMAGE MODEL</span><code>{data.pricing.models.image}</code><ul><li>{symbolOf(data.pricing.currency)}{data.pricing.image.perImage} {data.pricing.image.unit}</li></ul></div>
    <div><span className="eyebrow">VIDEO MODEL</span><code>{data.pricing.models.video}</code><ul><li>480P {symbolOf(data.pricing.currency)}{data.pricing.video['480P']} {data.pricing.video.unit}</li><li>720P {symbolOf(data.pricing.currency)}{data.pricing.video['720P']} {data.pricing.video.unit}</li><li>1080P {symbolOf(data.pricing.currency)}{data.pricing.video['1080P']} {data.pricing.video.unit}</li></ul></div>
   </div>
   <div className="price-sources">{Object.entries(data.pricing.sources).map(([key,url])=><a key={key} href={url} target="_blank" rel="noreferrer">{key} price list <ExternalLink size={12}/></a>)}</div>
   <p className="helper">Video is only charged when a clip finishes successfully — failed tasks are not billed. The price above is the public pay-as-you-go rate; a dedicated or negotiated deployment can bill differently.</p>
  </section>
 </>}</>;
}
