import assert from 'node:assert/strict'
import { readFile,mkdtemp,rm } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { tmpdir } from 'node:os'
import EmbeddedPostgres from 'embedded-postgres'
import { bootstrap } from '../http-browser/bootstrap.sql.mjs'

// Inputs are private read-only exports, never committed or uploaded to a cloud project.
const input=resolve(process.env.AUDIT_SNAPSHOT_DIR??'..')
const read=async name=>JSON.parse(await readFile(join(input,`prod-${name}.json`),'utf8'))
const [catalog,extra,snapshot]=await Promise.all(['catalog','extra','snapshot'].map(read))
const quote=s=>'"'+s.replaceAll('"','""')+'"'
const root=await mkdtemp(join(tmpdir(),'dostigator-production-copy-'))
const db=new EmbeddedPostgres({databaseDir:join(root,'db'),user:'postgres',password:'audit-local-only',port:58000+process.pid%1000,persistent:false,onLog:()=>{},onError:()=>{}})
let admin
try {
 await db.initialise();await db.start();admin=db.getPgClient();await admin.connect()
 await bootstrap(admin,'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002')
 // Reconstruct the ACTUAL catalog, including production integer types, unique
 // constraints, policies, grants, triggers and function bodies. No local base SQL.
 for(const table of extra.tables) {
  const cols=catalog.columns.filter(c=>c.table===table.name).map(c=>`${quote(c.name)} ${c.type}${c.default?' default '+c.default:''}${c.notnull?' not null':''}`)
  await admin.query(`create table public.${quote(table.name)} (${cols.join(',')})`)
 }
 for(const foreign of [false,true]) for(const c of catalog.constraints.filter(c=>c.def.startsWith('FOREIGN KEY')===foreign))
  await admin.query(`alter table public.${quote(c.table)} add constraint ${quote(c.name)} ${c.def}`)
 for(const f of catalog.functions) await admin.query(f.def)
 for(const index of extra.indexes??[]) await admin.query(index.def)
 for(const t of extra.triggers??[]) await admin.query(t.def)
 for(const t of extra.tables) {
  if(t.rls) await admin.query(`alter table public.${quote(t.name)} enable row level security`)
  if(t.force) await admin.query(`alter table public.${quote(t.name)} force row level security`)
 }
 for(const p of catalog.policies) await admin.query(`create policy ${quote(p.policyname)} on public.${quote(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(quote).join(',')}${p.qual?' using ('+p.qual+')':''}${p.with_check?' with check ('+p.with_check+')':''}`)
 for(const t of extra.tables) await admin.query(`revoke all on public.${quote(t.name)} from public,anon,authenticated`)
 for(const g of extra.grants??[]) await admin.query(`grant ${g.privilege_type} on public.${quote(g.table_name)} to ${g.grantee==='PUBLIC'?'public':quote(g.grantee)}`)
 for(const g of extra.function_grants??[]) {
  await admin.query(`${g.execute?'grant':'revoke'} execute on function ${g.function} ${g.execute?'to':'from'} ${quote(g.grantee)}`)
 }
 const owners=[...new Set([...snapshot.sessions,...snapshot.exercises,...snapshot.sets].map(r=>r.user_id))]
 for(const owner of owners) await admin.query('insert into auth.users(id) values($1) on conflict do nothing',[owner])
 const tables={library:'exercise_library',templates:'workout_templates',items:'workout_template_items',sessions:'workout_sessions',exercises:'workout_session_exercises',sets:'workout_sets',cardio:'cardio_sessions'}
 for(const [key,table] of Object.entries(tables)) await admin.query(`insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},$1::jsonb)`,[JSON.stringify(snapshot[key])])
 const snapshotNow=async()=>{
  const result={}
  for(const [key,table] of Object.entries(tables)) result[key]=(await admin.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') rows from public.${table} t`)).rows[0].rows
  return result
 }
 const before=await snapshotNow()
 for(const file of ['20261022050058_persist_exact_cardio_and_atomic_workouts.sql','20261022175114_add_v21_exercise_references.sql'])
  await admin.query(await readFile(join('supabase/migrations',file),'utf8'))
 const after=await snapshotNow()
 assert.deepEqual(after.sessions.map(({revision:_revision,...r})=>r),before.sessions,'every old session field is unchanged')
 assert.ok(after.sessions.every(r=>r.revision===0))
 for(const key of ['exercises','sets','templates','items','cardio']) assert.deepEqual(after[key],before[key],key)
 assert.deepEqual(after.library.filter(r=>!['pallof_press','cable_hip_extension'].includes(r.key)),before.library)
 assert.equal(after.library.length,before.library.length+2)
 await admin.query(await readFile('supabase/migrations/20261022175114_add_v21_exercise_references.sql','utf8'))
 assert.deepEqual(await snapshotNow(),after,'reference rerun does not duplicate or rewrite data')
 console.info(JSON.stringify({gate:'actual-production-copy',sessions:before.sessions.length,completed:before.sessions.filter(r=>r.finished_at).length,active:before.sessions.filter(r=>!r.finished_at).length,exercises:before.exercises.length,sets:before.sets.length,oldFieldsUnchanged:true,newReferences:2,duplicateReferences:0}))
} finally {
 if(admin) await admin.end().catch(()=>{})
 await db.stop().catch(()=>{});await rm(root,{recursive:true,force:true})
}
