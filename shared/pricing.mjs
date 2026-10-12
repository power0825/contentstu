// Official list prices, verified 2026-10-04. Every number here is traceable to a
// vendor document — do not edit these without updating the source note as well.
export const PRICING_VERIFIED='2026-10-04';
export const PRICING_SOURCES={
 text:'https://www.volcengine.com/docs/6492/1544808 — Volcengine Ark billing: doubao-seed series (online inference)',
 image:'https://www.volcengine.com/docs/6492/1544808 — Volcengine Ark billing: doubao-seedream series',
 video:'https://help.aliyun.com/zh/model-studio/wan3-0-video — Alibaba Cloud Model Studio: wan3.0-video pricing (Beijing, list price)'
};
// CNY per million tokens. The studio standardises on the turbo tier; the other rows are
// kept so already-recorded history still resolves to the right unit price.
const TEXT={'doubao-seed-2-1-turbo':{input:3,output:15,cached:0.6},'doubao-seed-2-1-pro':{input:6,output:30,cached:1.2},'doubao-seed-2-0-pro':{input:3.2,output:16,cached:0.64},'default':{input:3,output:15,cached:0.6}};
// CNY per successfully generated image.
const IMAGE={'doubao-seedream-4-5':0.25,'doubao-seedream-4-0':0.2,'doubao-seedream-5-0':0.22,'doubao-seedream-3-0':0.259,'default':0.25};
// CNY per second of output video, by resolution.
const VIDEO={'wan3.0-video':{'480P':0.3,'720P':0.6,'1080P':1.2},'wan2.5':{'480P':0.3,'720P':0.6,'1080P':1.2},'default':{'480P':0.3,'720P':0.6,'1080P':1.2}};
const match=(table,model)=>{const key=String(model||'').toLowerCase();for(const name of Object.keys(table)){if(name!=='default'&&key.startsWith(name))return table[name];}return table.default;};
const num=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:fallback;};
export function priceBook(env={}){
 const text=match(TEXT,env.VOLCENGINE_TEXT_MODEL||'doubao-seed-2-1-turbo');
 const image=match(IMAGE,env.VOLCENGINE_IMAGE_MODEL||'doubao-seedream-4-5');
 const video=match(VIDEO,env.BAILIAN_VIDEO_MODEL||'wan3.0-video');
 return {
  currency:'CNY',
  verified:PRICING_VERIFIED,
  sources:PRICING_SOURCES,
  text:{input:num(env.PRICE_TEXT_INPUT,text.input),output:num(env.PRICE_TEXT_OUTPUT,text.output),cached:num(env.PRICE_TEXT_CACHED,text.cached),unit:'per million tokens'},
  image:{perImage:num(env.PRICE_IMAGE,image),unit:'per image'},
  video:{'480P':num(env.PRICE_VIDEO_480P,video['480P']),'720P':num(env.PRICE_VIDEO_720P,video['720P']),'1080P':num(env.PRICE_VIDEO_1080P,video['1080P']),unit:'per second'}
 };
}
export function textCost(book,m={}){
 const input=Math.max(0,Number(m.input)||0),output=Math.max(0,Number(m.output)||0),cached=Math.max(0,Number(m.cached)||0);
 const billed=Math.max(0,input-cached);
 return {cost:(billed*book.text.input+cached*book.text.cached+output*book.text.output)/1e6,units:billed+output,detail:{inputTokens:input,outputTokens:output,cachedTokens:cached}};
}
export function imageCost(book,count=1,size=''){
 const images=Math.max(0,count);
 return {cost:book.image.perImage*images,units:images,detail:{images,size:size||''},unitPrice:book.image.perImage};
}
export function videoCost(book,resolution='720P',seconds=0){
 const tier=book.video[String(resolution).toUpperCase()]??book.video['720P'];
 return {cost:tier*Math.max(0,seconds),units:Math.max(0,seconds),detail:{resolution,seconds},unitPrice:tier};
}
