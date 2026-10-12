import {randomBytes,randomUUID,scrypt as scryptCallback,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
const digest=s=>createHash('sha256').update(s).digest('hex');
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hashSync=password=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');};
export async function hashPassword(password){const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64)).toString('hex');}
export async function verifyPassword(password,stored){const [salt,hash]=String(stored||'').split(':');if(!salt||!hash)return false;const out=await scrypt(password,salt,64);const target=Buffer.from(hash,'hex');return target.length===out.length&&timingSafeEqual(out,target);}
export function createAuth(db,{secureCookies=false,adminIdentifier='admin',adminPassword='12345678'}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);`);
 // Existing rows predate the approval flow: they keep full access so nobody is locked out by the upgrade.
 const columns=new Set(db.prepare('PRAGMA table_info(users)').all().map(c=>c.name));
 if(!columns.has('status'))db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'");
 if(!columns.has('role'))db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
 // Seeded administrator: created once, never overwritten, so a changed password survives restarts.
 const adminKey=String(adminIdentifier||'').trim().toLowerCase();
 const adminSecret=String(adminPassword||'');
 if(adminKey){
  const existing=db.prepare('SELECT id,role FROM users WHERE email=?').get(adminKey);
  if(!existing&&adminSecret.length>=8)db.prepare('INSERT INTO users(id,email,password_hash,created_at,status,role) VALUES(?,?,?,?,?,?)').run(randomUUID(),adminKey,hashSync(adminSecret),new Date().toISOString(),'approved','admin');
  else if(existing&&existing.role!=='admin')db.prepare("UPDATE users SET role='admin',status='approved' WHERE id=?").run(existing.id);
 }
 const attempts=new Map();
 function token(request){const c=request.headers.get('cookie')||'';return c.split(';').map(x=>x.trim()).find(x=>x.startsWith('studio_session='))?.slice(15)||'';}
 function cookie(value,maxAge=604800){return `studio_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureCookies?'; Secure':''}`;}
 async function user(request){const t=token(request);if(!t)return null;const row=db.prepare('SELECT users.id,users.email,users.status,users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?').get(digest(t),Date.now());return row||null;}
 function session(u){db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());const t=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(t),u.id,Date.now()+604800000);return cookie(t);}
 async function handle(request,ip='local'){
  const path=new URL(request.url).pathname;
  if(path==='/api/auth/me')return json({user:await user(request)});
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Request origin is not allowed.'},403);
  if(path==='/api/auth/logout'){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token(request)));return json({ok:true},200,{'Set-Cookie':cookie('',0)});}
  if(!['/api/auth/register','/api/auth/login'].includes(path))return json({error:'Not found.'},404);
  const now=Date.now();for(const [key,value] of attempts)if(now-value.start>900000)attempts.delete(key);const rate=attempts.get(ip)||{start:now,count:0};rate.count++;attempts.set(ip,rate);if(rate.count>30)return json({error:'Too many sign-in attempts. Please try again in 15 minutes.'},429);
  let body;try{body=await request.json();}catch{return json({error:'Enter your email and password.'},400);}
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';const password=body.password;
  if(typeof password!=='string'||password.length<8||password.length>128)return json({error:'Use a valid email and a password between 8 and 128 characters.'},400);
  if(email.length<3||email.length>254||/\s/.test(email))return json({error:'Use a valid email and a password between 8 and 128 characters.'},400);
  if(path==='/api/auth/register'){
   if(!EMAIL.test(email))return json({error:'Use a valid email address.'},400);
   if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return json({error:'This email is already registered. Please sign in.'},409);
   const u={id:randomUUID(),email};
   try{db.prepare('INSERT INTO users(id,email,password_hash,created_at,status,role) VALUES(?,?,?,?,?,?)').run(u.id,email,await hashPassword(password),new Date().toISOString(),'pending','member');}catch(e){if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return json({error:'This email is already registered. Please sign in.'},409);throw e;}
   return json({user:{id:u.id,email:u.email,status:'pending',role:'member'},status:'pending'},201);
  }
  const row=db.prepare('SELECT id,email,password_hash,status,role FROM users WHERE email=?').get(email);const [salt,stored]=row?row.password_hash.split(':'):['0'.repeat(32),'00'.repeat(64)];const hash=await scrypt(password,salt,64);const valid=timingSafeEqual(hash,Buffer.from(stored,'hex'));
  if(!row||!valid)return json({error:'Email or password is incorrect.'},401);
  if(row.status==='pending')return json({error:'Your account is still waiting for administrator approval. Please try again later.'},403);
  if(row.status!=='approved')return json({error:'Your account request was declined. Please contact the administrator.'},403);
  return json({user:{id:row.id,email:row.email,status:row.status,role:row.role}},200,{'Set-Cookie':session(row)});
 }
 return {user,handle,revoke:id=>db.prepare('DELETE FROM sessions WHERE user_id=?').run(id)};
}
