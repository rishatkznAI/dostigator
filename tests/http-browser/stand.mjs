import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import EmbeddedPostgres from 'embedded-postgres'
import { bootstrap } from './bootstrap.sql.mjs'
const ownerA='10000000-0000-4000-8000-000000000001',ownerB='20000000-0000-4000-8000-000000000002'
const root=await mkdtemp(join(tmpdir(),'dostigator-http-'))
const postgres=new EmbeddedPostgres({databaseDir:join(root,'db'),user:'postgres',password:'isolated-test',port:56219,persistent:false,onLog:()=>{},onError:()=>{}})
await postgres.initialise();await postgres.start()
const admin=postgres.getPgClient();await admin.connect();await bootstrap(admin,ownerA,ownerB)
for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) await admin.query(await readFile(join('supabase/migrations',file),'utf8'))
await admin.query(`create role authenticator login password 'test-api'; grant anon, authenticated to authenticator;
create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
grant usage on schema public to authenticated,anon;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant select on exercise_library,workout_templates,workout_template_items to anon;`)
const secret=randomBytes(48).toString('hex')
const token=(sub,role='authenticated')=>{const body=[{alg:'HS256',typ:'JWT'},{role,sub,aud:'authenticated',iss:'isolated-test',exp:Math.floor(Date.now()/1000)+86400}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url')}
const tokens={ownerA:token(ownerA),ownerB:token(ownerB),anon:token(undefined,'anon')}
await writeFile(join(root,'postgrest.conf'),`db-uri = "postgres://authenticator:test-api@127.0.0.1:56219/postgres"\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = "${secret}"\nserver-port = 4212\nserver-host = "127.0.0.1"\n`)
const postgrest=spawn('/opt/homebrew/bin/postgrest',[join(root,'postgrest.conf')],{stdio:['ignore','ignore','pipe']});postgrest.stderr.on('data',d=>process.stderr.write(d))
let mode='online',lost=false
const lanBootstrap=await readFile('tools/phone-preview/mobile-preview-bootstrap.js','utf8')
const user={id:ownerA,aud:'authenticated',role:'authenticated',email:'isolated@local.test',app_metadata:{provider:'test-fixture'},user_metadata:{display_name:'Изолированный тест'},created_at:'2026-10-22T00:00:00Z'}
const fixture={access_token:tokens.ownerA,refresh_token:'fixture-no-cloud-auth',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,token_type:'bearer',user}
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}
 if(url.pathname==='/__test/login') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<script>localStorage.setItem('sb-192-auth-token',${JSON.stringify(JSON.stringify(fixture))});localStorage.setItem('dostigator:onboarding:v1:${ownerA}','skipped');location.replace('/training')</script>`);return}
 if(url.pathname==='/__test/mode') {mode=url.searchParams.get('value')??'online';lost=false;res.end(mode);return}
 if(url.pathname==='/__test/identities') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ownerA,ownerB,tokens}));return}
 if(url.pathname==='/__test/counts') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify((await admin.query(`select (select count(*)::int from workout_sessions) sessions,(select count(*)::int from workout_sets where done) done_sets,(select count(*)::int from cardio_facts where deleted_at is null) cardio,(select count(*)::int from private.training_deleted_sessions) cancelled`)).rows[0]));return}
 // Only authentication is a test fixture. All workout/cardio API reads and writes go to real PostgREST/PostgreSQL.
 if(url.pathname==='/auth/v1/user') {if(req.headers.authorization!==`Bearer ${tokens.ownerA}`){res.writeHead(401);res.end('{}');return}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(user));return}
 if(url.pathname.startsWith('/rest/v1/')) {
  if(mode==='offline') {res.writeHead(503);res.end(JSON.stringify({message:'isolated network interruption'}));return}
  if(mode==='missing') {res.writeHead(404);res.end(JSON.stringify({code:'PGRST202',message:'missing function'}));return}
  const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks)
  const response=await fetch('http://127.0.0.1:4212'+url.pathname.replace('/rest/v1','')+url.search,{method:req.method,headers:{...req.headers,host:'127.0.0.1:4212'},body:['GET','HEAD'].includes(req.method)?undefined:body})
  const content=await response.arrayBuffer()
  if(mode==='lost-response'&&!lost&&url.pathname.includes('/rpc/')&&response.ok){lost=true;res.destroy();return}
  res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')??'application/json','Content-Range':response.headers.get('content-range')??'*/*'});res.end(Buffer.from(content));return
 }
 const response=await fetch('http://127.0.0.1:4211'+req.url,{headers:{accept:req.headers.accept??'*/*'}});let content=Buffer.from(await response.arrayBuffer())
 if(response.headers.get('content-type')?.includes('text/html'))content=Buffer.from(content.toString().replace('<head>',`<head><script>${lanBootstrap}</script>`).replace('<body>','<body><div style="background:#51431c;color:white;padding:8px;font:12px sans-serif">Изолированный стенд · настоящая БД/API · вход тестовый · production не используется</div>'))
 res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')??'text/plain'});res.end(content)
}catch(error){res.writeHead(502);res.end(JSON.stringify({message:error.message}))}})
server.listen(4210,'0.0.0.0',()=>console.log('Isolated HTTP stand http://192.168.1.137:4210/__test/login'))
async function stop(){server.close();postgrest.kill();await admin.end();await postgres.stop();await rm(root,{recursive:true,force:true});process.exit()}
process.on('SIGTERM',stop);process.on('SIGINT',stop)
