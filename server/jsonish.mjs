// Reading JSON out of a model reply.
// A model rarely returns a bare object: it may open with a sentence, wrap the object in a code
// fence, or leave a real line break inside a string. JSON.parse fails on all three, and that
// failure used to surface as an unrelated error, so every caller that parses model output goes
// through this module.
// Models sometimes leave real line breaks inside a JSON string, which makes JSON.parse throw.
// Escape those, then drop commas that trail the last member of an object or array.
export function repairJson(input){
 let out='',inString=false,escaped=false;
 for(const ch of String(input||'')){
  if(inString){
   if(escaped){out+=ch;escaped=false;continue;}
   if(ch==='\\'){out+=ch;escaped=true;continue;}
   if(ch==='"'){out+=ch;inString=false;continue;}
   if(ch==='\n'){out+='\\n';continue;}
   if(ch==='\r'){continue;}
   if(ch==='\t'){out+='\\t';continue;}
   if(ch<'\u0020'){continue;}
   out+=ch;
   continue;
  }
  if(ch==='"'){inString=true;out+=ch;continue;}
  out+=ch;
 }
 return out.replace(/,(\s*[}\]])/g,'$1');
}
export function extractJson(raw){
 const text=String(raw||'').replace(/```[a-zA-Z]*/g,'').trim();
 const start=text.indexOf('{'),end=text.lastIndexOf('}');
 const candidates=[];
 if(start>=0&&end>start)candidates.push(text.slice(start,end+1));
 candidates.push(text);
 for(const candidate of candidates){
  try{const parsed=JSON.parse(candidate);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return parsed;}catch{}
  try{const parsed=JSON.parse(repairJson(candidate));if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return parsed;}catch{}
 }
 return null;
}
