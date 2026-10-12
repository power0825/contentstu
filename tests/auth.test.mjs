import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAuth} from '../server/auth.mjs';
test('email registration, password login and logout enforce session ownership',async()=>{
 const db=new DatabaseSync(':memory:');const auth=createAuth(db);const req=(path,body,cookie)=>new Request('http://localhost:5173'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json','Origin':'http://localhost:5173'}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal(await auth.user(req('/api/auth/me')),null);
 let r=await auth.handle(req('/api/auth/register',{email:'learner@example.com',password:'Classroom123!'}),'127.0.0.1');assert.equal(r.status,201);const cookie=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/SameSite=Lax/);
 const user=await auth.user(req('/api/auth/me',null,cookie));assert.equal(user.email,'learner@example.com');assert.ok(user.id);
 const stored=db.prepare('SELECT password_hash FROM users').get().password_hash;assert.ok(!stored.includes('Classroom123!'));
 r=await auth.handle(req('/api/auth/login',{email:'learner@example.com',password:'wrong-password'}),'127.0.0.1');assert.equal(r.status,401);
 r=await auth.handle(req('/api/auth/login',{email:'LEARNER@example.com',password:'Classroom123!'}),'127.0.0.1');assert.equal(r.status,200);const newCookie=r.headers.get('set-cookie').split(';')[0];assert.equal((await auth.user(req('/api/auth/me',null,newCookie))).id,user.id);
 r=await auth.handle(req('/api/auth/register',{email:'learner@example.com',password:'Classroom123!'}),'127.0.0.1');assert.equal(r.status,409);
 r=await auth.handle(req('/api/auth/register',{email:'bad',password:'short'}),'127.0.0.1');assert.equal(r.status,400);
 r=await auth.handle(req('/api/auth/logout',{},cookie),'127.0.0.1');assert.equal(r.status,200);assert.equal(await auth.user(req('/api/auth/me',null,cookie)),null);
 assert.equal(await auth.user(req('/api/auth/me',null,'studio_session=forged')),null);db.close();
});
