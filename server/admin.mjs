import {join} from 'node:path';
import {unlinkSync} from 'node:fs';
import {hashPassword,verifyPassword} from './auth.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const STATUS_LABEL={pending:'Waiting for approval',approved:'Active',rejected:'Declined'};
export function createAdmin({db,dataDir,auth}){
 function account(id){const row=db.prepare('SELECT id,email,status,role,created_at FROM users WHERE id=?').get(id);if(!row)fail('That account no longer exists.',404);return row;}
 function adminCount(){return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='approved'").get().n;}
 function listing(me){
  const users=db.prepare("SELECT id,email,status,role,created_at FROM users ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,created_at ASC").all().map(u=>({...u,label:STATUS_LABEL[u.status]||u.status,generations:db.prepare('SELECT COUNT(*) AS n FROM generations WHERE user_id=?').get(u.id).n,self:u.id===me.id}));
  const counts={pending:0,approved:0,rejected:0};for(const u of users)counts[u.status]=(counts[u.status]||0)+1;
  return {users,counts,self:{id:me.id,email:me.email}};
 }
 function guard(me){if(!me||me.role!=='admin'||me.status!=='approved')fail('Administrator access is required.',403);}
 async function handle(request,me){
  guard(me);
  const path=new URL(request.url).pathname;if(path!=='/api/admin')fail('Not found.',404);
  if(request.method==='GET')return json(listing(me));
  if(request.method!=='POST')fail('Method not allowed.',405);
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)fail('Request origin is not allowed.',403);
  let b;try{b=await request.json();}catch{fail('The request could not be read.');}
  const action=typeof b.action==='string'?b.action:'';
  if(action==='password'){
   const current=typeof b.current==='string'?b.current:'',next=typeof b.password==='string'?b.password:'';
   if(next.length<8||next.length>128)fail('Use a password between 8 and 128 characters.');
   if(!(await verifyPassword(current,db.prepare('SELECT password_hash FROM users WHERE id=?').get(me.id).password_hash)))fail('Your current password is incorrect.',403);
   db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPassword(next),me.id);
   return json({...listing(me),notice:'Your password was updated.'});
  }
  const target=account(typeof b.userId==='string'?b.userId:'');
  if(action==='approve'){
   db.prepare("UPDATE users SET status='approved' WHERE id=?").run(target.id);
   return json({...listing(me),notice:`${target.email} can sign in now.`});
  }
  if(action==='reject'){
   if(target.self)fail('You cannot decline your own account.');
   if(target.role==='admin'&&adminCount()<=1)fail('Keep at least one administrator.');
   db.prepare("UPDATE users SET status='rejected' WHERE id=?").run(target.id);auth.revoke(target.id);
   return json({...listing(me),notice:`${target.email} was declined and signed out.`});
  }
  if(action==='promote'){
   if(target.status!=='approved')fail('Approve the account before making it an administrator.');
   db.prepare("UPDATE users SET role='admin' WHERE id=?").run(target.id);
   return json({...listing(me),notice:`${target.email} is now an administrator.`});
  }
  if(action==='demote'){
   if(target.self)fail('You cannot remove your own administrator access.');
   if(target.role!=='admin')fail('That account is not an administrator.');
   if(adminCount()<=1)fail('Keep at least one administrator.');
   db.prepare("UPDATE users SET role='member' WHERE id=?").run(target.id);
   return json({...listing(me),notice:`${target.email} is now a member.`});
  }
  if(action==='delete'){
   if(target.self)fail('You cannot delete your own account.');
   if(target.role==='admin'&&adminCount()<=1)fail('Keep at least one administrator.');
   const files=db.prepare('SELECT id FROM assets WHERE user_id=?').all(target.id).map(a=>a.id);
   for(const table of ['sessions','assets','generations','profiles','video_projects','video_jobs'])db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(target.id);
   db.prepare('DELETE FROM usage WHERE id LIKE ?').run(target.id+':%');
   db.prepare('DELETE FROM users WHERE id=?').run(target.id);
   for(const id of files){try{unlinkSync(join(dataDir,'images',id));}catch{}}
   return json({...listing(me),notice:`${target.email} and ${files.length} of their files were deleted.`});
  }
  fail('Unknown administrator action.');
 }
 return {handle};
}
