import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createApp} from './app.mjs';
try{process.loadEnvFile(resolve('.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
const production=process.argv.includes('--production');
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT)||5173;
const app=createApp({dataDir:resolve(process.env.DATA_DIR||'data')});let vite;
const server=http.createServer(async(req,res)=>{
 try{
  const origin=process.env.PUBLIC_ORIGIN||`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`;const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/api/')){
   const max=url.pathname==='/api/video/upload'?101*1024*1024:url.pathname==='/api/upload'?9*1024*1024:url.pathname==='/api/library'?9*1024*1024:url.pathname.startsWith('/api/auth/')?20000:250000;
   if(Number(req.headers['content-length'])>max){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'This request is too large.'}));req.resume();return;}
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>max){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'This request is too large.'}));return;}chunks.push(chunk);}
   const headers=new Headers();for(const [key,value]of Object.entries(req.headers)){if(Array.isArray(value))headers.set(key,value.join(','));else if(value!==undefined)headers.set(key,value);}
   const request=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
   const result=await app.handle(request,req.socket.remoteAddress||'local');res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
  }
  if(!production){vite.middlewares(req,res);return;}
  const root=resolve('dist');let file=resolve(root,'.'+decodeURIComponent(url.pathname));if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  try{if(!(await stat(file)).isFile())file=resolve(root,'index.html');}catch{file=resolve(root,'index.html');}
  const content=await readFile(file);const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'}[extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'X-Content-Type-Options':'nosniff'});res.end(content);
 }catch(e){console.error('Request failed:',e.name);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'The server could not complete this request.'}));}
});
if(!production){const {createServer}=await import('vite');vite=await createServer({server:{middlewareMode:true,hmr:{server}},appType:'spa'});}
server.listen(port,host,()=>console.log(`Content Management Studio is ready at http://${host==='0.0.0.0'?'localhost':host}:${port}`));
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is in use. Set a different PORT in .env.`:e.message);process.exit(1);});
let closing=false;async function stop(){if(closing)return;closing=true;await vite?.close();server.close(()=>{app.close();process.exit(0);});setTimeout(()=>process.exit(0),3000).unref();}process.on('SIGINT',stop);process.on('SIGTERM',stop);
