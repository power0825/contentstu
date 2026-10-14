// Official list prices, verified 2026-10-14, for Alibaba Cloud Model Studio in Singapore
// (international deployment scope). Every number is traceable to a vendor page - do not edit
// these without updating the source note as well.
export const PRICING_VERIFIED='2026-10-14';
export const PRICING_SOURCES={
 text:'https://docs.modelstudio.console.alibabacloud.com/tc/model-studio/billing-for-model-studio - Model Studio: DeepSeek-V4-Flash-0731, Singapore, peak rate',
 image:'https://docs.modelstudio.console.alibabacloud.com/tc/model-studio/billing-for-model-studio - Model Studio: image generation, Singapore',
 video:'https://www.alibabacloud.com/help/tc/model-studio/wan3-0-video - Model Studio: Wan 3.0 video generation, Singapore'
};
// USD per million tokens. DeepSeek-V4-Flash-0731 moved to peak/off-peak pricing on 2026-08-17;
// the peak rate is quoted so an estimate never understates the bill, and a cache hit is billed at
// 10% of the input rate. Longer names must stay ahead of their prefixes: match() returns the first
// entry whose name the model id starts with.
const TEXT={'deepseek-v4-flash':{input:0.44,output:1.32,cached:0.044},'default':{input:0.44,output:1.32,cached:0.044}};
// USD per successfully generated image, by model.
const IMAGE={'qwen-image-3.0-pro':0.04,'qwen-image-3.0':0.03,'qwen-image-2.1-pro':0.04,'qwen-image-2.1-turbo':0.016,'default':0.03};
// USD per second of output video, by resolution.
const VIDEO={'wan3.0-video-prime':{'480P':0.068,'720P':0.14,'1080P':0.28},'wan3.0-video':{'480P':0.05,'720P':0.1,'1080P':0.2},'default':{'480P':0.05,'720P':0.1,'1080P':0.2}};
const match=(table,model)=>{const key=String(model||'').toLowerCase();for(const name of Object.keys(table)){if(name!=='default'&&key.startsWith(name))return table[name];}return table.default;};
const num=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:fallback;};
// `models` lets a caller price one specific call: accounts choose their own models now, so the
// rate has to come from the model that actually ran, not from whatever the server was started with.
export function priceBook(env={},models={}){
 const textName=models.text||env.VOLCENGINE_TEXT_MODEL||'deepseek-v4-flash';
 const imageName=models.image||env.VOLCENGINE_IMAGE_MODEL||'qwen-image-3.0';
 const videoName=models.video||env.BAILIAN_VIDEO_MODEL||'wan3.0-video';
 const text=match(TEXT,textName),image=match(IMAGE,imageName),video=match(VIDEO,videoName);
 return {
  currency:'USD',
  verified:PRICING_VERIFIED,
  sources:PRICING_SOURCES,
  models:{text:textName,image:imageName,video:videoName},
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
