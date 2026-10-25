import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'

// Read-only SQL. XMLTABLE is only a bridge for executing a per-table SELECT;
// rowsJson stays a PostgreSQL JSON string, preserving arbitrary numeric precision.
export const exportSql = String.raw`
with app_tables as (
  select c.*, n.nspname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind='r'
    and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
), app_functions as (
  select p.*, n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prokind in ('f','p')
    and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
)
select jsonb_build_object(
  'format','dostigator-application-snapshot-v1', 'exportedAt',clock_timestamp(),
  'settings',jsonb_build_object('TimeZone',current_setting('TimeZone'),'DateStyle',current_setting('DateStyle'),'IntervalStyle',current_setting('IntervalStyle'),'extra_float_digits',current_setting('extra_float_digits'),'bytea_output',current_setting('bytea_output')),
  'authUserIds',(select coalesce(jsonb_agg(id order by id),'[]') from auth.users),
  'schemas',(select jsonb_agg(jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),
    'grants',(select coalesce(jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable)),'[]') from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a)) order by n.nspname)
    from pg_namespace n where n.nspname in ('public','private')),
  'enums',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname,'labels',
    (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid)) order by n.nspname,t.typname),'[]')
    from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','private') and t.typtype='e'),
  'tables',(select jsonb_agg(jsonb_build_object(
    'schema',t.nspname,'name',t.relname,'owner',pg_get_userbyid(t.relowner),'rls',t.relrowsecurity,'forceRls',t.relforcerowsecurity,
    'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'default',pg_get_expr(d.adbin,d.adrelid),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid,true)) order by c.conname),'[]') from pg_constraint c where c.conrelid=t.oid),
    'indexes',(select coalesce(jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid::regclass::text),'[]') from pg_index i where i.indrelid=t.oid and not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)),
    'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',g.tgname,'definition',pg_get_triggerdef(g.oid,true),'enabled',g.tgenabled) order by g.tgname),'[]') from pg_trigger g where g.tgrelid=t.oid and not g.tgisinternal),
    'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'permissive',p.polpermissive,
      'command',case p.polcmd when '*' then 'ALL' when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' end,
      'roles',(select jsonb_agg(case when u.role=0 then 'PUBLIC' else pg_get_userbyid(u.role) end order by u.role) from unnest(p.polroles) u(role)),
      'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname),'[]') from pg_policy p where p.polrelid=t.oid),
    'grants',(select coalesce(jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable)),'[]') from aclexplode(coalesce(t.relacl,acldefault('r',t.relowner))) a),
    'rowCount',(select (payload::jsonb->>'count')::bigint from xmltable('/row' passing query_to_xml(format('select jsonb_build_object(''count'',count(*))::text payload from %I.%I',t.nspname,t.relname),false,true,'') columns payload text path 'payload')),
    'rowsJson',x.rows_json,'rowsMd5',md5(x.rows_json)) order by t.nspname,t.relname)
    from app_tables t cross join lateral xmltable('/row' passing query_to_xml(format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text collate "C"),''[]''::jsonb)::text payload from %I.%I r',t.nspname,t.relname),false,true,'') columns rows_json text path 'payload') x),
  'functions',(select coalesce(jsonb_agg(jsonb_build_object('schema',p.nspname,
    'identity',format('%I.%I(%s)',p.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
    'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
    'grants',(select coalesce(jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable)),'[]') from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)) order by p.nspname,p.proname,p.oid),'[]') from app_functions p)
) as snapshot;
`

if (process.argv.includes('--export-sql')) {
  process.stdout.write(exportSql)
  process.exit(0)
}

const quote = value => '"' + String(value).replaceAll('"', '""') + '"'
const literal = value => "'" + String(value).replaceAll("'", "''") + "'"
const role = name => name === 'PUBLIC' ? 'public' : quote(name)
const qualified = table => `${quote(table.schema)}.${quote(table.name)}`
const migrationPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations/20261023105721_add_safe_workout_set_corrections.sql')
const snapshotPath = resolve(process.env.AUDIT_APPLICATION_SNAPSHOT ?? '../private-release/application-snapshot.json')
let source, snapshot
try {
  source = await readFile(snapshotPath)
  snapshot = JSON.parse(source.toString('utf8'))
  assert.equal(snapshot.format, 'dostigator-application-snapshot-v1', 'unsupported snapshot format')
  assert.equal(snapshot.tables.length, Number(process.env.AUDIT_EXPECTED_TABLES ?? 24), 'unexpected application table count')
  assert.deepEqual(new Set(snapshot.schemas.map(s => s.name)), new Set(['public', 'private']))
  assert.ok(snapshot.tables.every(t => ['public', 'private'].includes(t.schema)), 'unexpected schema')
  for (const table of snapshot.tables) {
    assert.equal(typeof table.rowsJson, 'string')
    assert.equal(createHash('md5').update(table.rowsJson).digest('hex'), table.rowsMd5, 'snapshot row integrity failed')
    assert.equal(JSON.parse(table.rowsJson).length, table.rowCount, 'snapshot row count failed')
    assert.ok(table.columns.every(c => !c.identity && !c.generated && !/nextval\s*\(/i.test(c.default ?? '')),
      'identity/generated/sequence columns require an explicit exporter extension')
  }
} catch {
  console.error(JSON.stringify({gate:'correction-production-application-copy',status:'FAIL',phase:'private-input-validation',message:'Private snapshot missing, malformed, inconsistent, or outside supported schema; details suppressed'}))
  process.exit(1)
}
const root = await mkdtemp(join(tmpdir(), 'dostigator-correction-copy-'))
const db = new EmbeddedPostgres({databaseDir:join(root,'db'),user:'postgres',password:'local-audit-only',port:59000+process.pid%1000,persistent:false,onLog:()=>{},onError:()=>{}})
let admin
let failed = false
let phase = 'initialise'
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

try {
  await db.initialise(); await db.start(); admin = db.getPgClient(); await admin.connect()
  phase = 'bootstrap'
  await admin.query(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    set check_function_bodies=off; set timezone='UTC';`)
  for (const [setting,value] of Object.entries(snapshot.settings ?? {TimeZone:'UTC'})) {
    assert.ok(['TimeZone','DateStyle','IntervalStyle','extra_float_digits','bytea_output'].includes(setting),'unexpected database formatting setting')
    await admin.query('select set_config($1,$2,false)',[setting,value])
  }
  for (const id of snapshot.authUserIds) await admin.query('insert into auth.users(id) values($1)', [id])
  const roles = new Set(['anon', 'authenticated'])
  for (const object of [...snapshot.schemas, ...snapshot.tables, ...snapshot.functions]) {
    roles.add(object.owner)
    for (const grant of object.grants) if (grant.grantee !== 'PUBLIC') roles.add(grant.grantee)
    for (const policy of object.policies ?? []) for (const name of policy.roles) if (name !== 'PUBLIC') roles.add(name)
  }
  for (const name of roles) if (!(await admin.query('select 1 from pg_roles where rolname=$1',[name])).rowCount)
    await admin.query(`create role ${quote(name)} nologin`)
  for (const schema of snapshot.schemas) await admin.query(`create schema if not exists ${quote(schema.name)}`)
  for (const item of snapshot.enums) await admin.query(`create type ${quote(item.schema)}.${quote(item.name)} as enum (${item.labels.map(literal).join(',')})`)
  phase = 'restore-catalog'
  for (const table of snapshot.tables) {
    await admin.query(`create table ${qualified(table)} (${table.columns.map(c => `${quote(c.name)} ${c.type}${c.default ? ' default ' + c.default : ''}${c.notNull ? ' not null' : ''}`).join(',')})`)
  }
  // No application trigger executes during restoration. Add every constraint only
  // after the rows are present; FK validation then verifies the complete graph.
  phase = 'restore-data'
  for (const table of snapshot.tables) await admin.query(`insert into ${qualified(table)} select * from jsonb_populate_recordset(null::${qualified(table)},$1::jsonb)`,[table.rowsJson])
  phase = 'restore-catalog'
  for (const foreign of [false,true]) for (const table of snapshot.tables)
    for (const constraint of table.constraints.filter(c => (c.type === 'f') === foreign))
      await admin.query(`alter table ${qualified(table)} add constraint ${quote(constraint.name)} ${constraint.definition}`)
  for (const fn of snapshot.functions) await admin.query(fn.definition)
  for (const table of snapshot.tables) {
    for (const index of table.indexes) await admin.query(index)
    for (const trigger of table.triggers) {
      await admin.query(trigger.definition)
      const mode = {O:'enable',D:'disable',R:'enable replica',A:'enable always'}[trigger.enabled]
      assert.ok(mode, 'unsupported trigger state')
      await admin.query(`alter table ${qualified(table)} ${mode} trigger ${quote(trigger.name)}`)
    }
    for (const policy of table.policies) await admin.query(`create policy ${quote(policy.name)} on ${qualified(table)} as ${policy.permissive ? 'permissive' : 'restrictive'} for ${policy.command} to ${policy.roles.map(role).join(',')}${policy.using ? ' using (' + policy.using + ')' : ''}${policy.check ? ' with check (' + policy.check + ')' : ''}`)
    if (table.rls) await admin.query(`alter table ${qualified(table)} enable row level security`)
    if (table.forceRls) await admin.query(`alter table ${qualified(table)} force row level security`)
  }
  const restoreAcl = async (kind, identity, object) => {
    await admin.query(`alter ${kind} ${identity} owner to ${quote(object.owner)}`)
    await admin.query(`revoke all on ${kind} ${identity} from public`)
    for (const grant of object.grants) await admin.query(`grant ${grant.privilege} on ${kind} ${identity} to ${role(grant.grantee)}${grant.grantable ? ' with grant option' : ''}`)
  }
  for (const table of snapshot.tables) await restoreAcl('table',qualified(table),table)
  for (const fn of snapshot.functions) await restoreAcl('function',fn.identity,fn)
  for (const schema of snapshot.schemas) await restoreAcl('schema',quote(schema.name),schema)
  // A logical table has no row ordering. Normalize the copied array with binary
  // C ordering; source/target servers can have different default collations.
  // Each row's PostgreSQL JSON bytes (including every field) remain untouched.
  const expectedInventory=[]
  for (const table of snapshot.tables) {
    const {rows:[row]}=await admin.query(`select count(*)::int count,md5(coalesce(jsonb_agg(value order by value::text collate "C"),'[]'::jsonb)::text) md5 from jsonb_array_elements($1::jsonb)`,[table.rowsJson])
    expectedInventory.push({schema:table.schema,table:table.name,...row})
  }
  const state = async () => {
    const result=[]
    for (const table of snapshot.tables) {
      const {rows:[row]}=await admin.query(`select count(*)::int count,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text collate "C"),'[]'::jsonb)::text) md5 from ${qualified(table)} t`)
      result.push({schema:table.schema,table:table.name,...row})
    }
    return result
  }
  phase = 'verify-restoration'
  const restored = await state()
  // Two-way EXCEPT ALL compares the complete row text with binary collation,
  // retaining duplicate multiplicity. It does not rely on hash collision safety.
  for (const table of snapshot.tables) {
    const {rows:[row]}=await admin.query(`select
      (select count(*)::int from ((select value::text collate "C" from jsonb_array_elements($1::jsonb)) except all (select to_jsonb(t)::text collate "C" from ${qualified(table)} t)) missing) missing,
      (select count(*)::int from ((select to_jsonb(t)::text collate "C" from ${qualified(table)} t) except all (select value::text collate "C" from jsonb_array_elements($1::jsonb))) extra) extra`,[table.rowsJson])
    assert.deepEqual(row,{missing:0,extra:0},`row byte mismatch in ${table.schema}.${table.name}`)
  }
  assert.deepEqual(restored,expectedInventory,'restored application rows differ from export')
  phase = 'apply-correction-only'
  assert.equal((await admin.query("select to_regprocedure('public.training_correct_set(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb)') is null absent")).rows[0].absent,true,'correction already present; do not replay migration')
  const migration = await readFile(migrationPath,'utf8')
  await admin.query('begin')
  try { await admin.query(migration); await admin.query('commit') } catch(error) { await admin.query('rollback'); throw error }
  phase = 'verify-preservation-and-security'
  assert.deepEqual(await state(),restored,'correction migration changed existing application rows')
  const signature='training_correct_set(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb)'
  const privileges=(await admin.query(`select n.nspname schema,p.prosecdef definer,pg_get_userbyid(p.proowner) owner,
    has_function_privilege('anon',p.oid,'EXECUTE') anon,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid in ($1::regprocedure,$2::regprocedure) order by n.nspname`,['private.'+signature,'public.'+signature])).rows
  assert.deepEqual(privileges,[{schema:'private',definer:true,owner:'postgres',anon:false,authenticated:true,public:false},{schema:'public',definer:false,owner:'postgres',anon:false,authenticated:true,public:false}])
  const attempt = async (authenticatedOwner, expectedOwner, expectedCode, dbRole='authenticated', sessionId=randomUUID()) => {
    await admin.query('begin')
    try {
      await admin.query(`set local role ${quote(dbRole)}`)
      await admin.query("select set_config('request.jwt.claim.sub',$1,true)",[authenticatedOwner ?? ''])
      await assert.rejects(() => admin.query('select public.training_correct_set($1,$2,$3,$4,0,now(),$5::jsonb)',[expectedOwner,randomUUID(),sessionId,randomUUID(),'{"weight_kg":1,"reps":1,"rir":null}']),error => error.code === expectedCode)
    } finally { await admin.query('rollback') }
  }
  const owner = snapshot.authUserIds[0] ?? randomUUID()
  await attempt(null,owner,'42501')
  await attempt(owner,randomUUID(),'42501')
  await attempt(owner,owner,'42501') // no such session: an arbitrary ID cannot be used
  await attempt(null,owner,'42501','anon')
  const existingSession=(await admin.query('select id from public.workout_sessions limit 1')).rows[0]
  if (existingSession) {
    const outsider=randomUUID()
    await attempt(outsider,outsider,'42501','authenticated',existingSession.id)
  }
  assert.deepEqual(await state(),restored,'rejected calls changed application data')
  // FKs were created and validated during restoration, including auth ownership.
  assert.equal((await admin.query("select count(*)::int n from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','private') and not c.convalidated")).rows[0].n,0,'unvalidated constraints')
  console.info(JSON.stringify({gate:'correction-production-application-copy',status:'PASS',tables:restored.length,rows:restored.reduce((n,t)=>n+t.count,0),authIds:snapshot.authUserIds.length,snapshotSha256:createHash('sha256').update(source).digest('hex'),applicationSha256:digest(restored),migrationSha256:createHash('sha256').update(migration).digest('hex'),restorationExact:true,rowBytesCompared:true,rowOrderNormalizedTables:snapshot.tables.filter((t,i)=>t.rowsMd5!==expectedInventory[i].md5).length,existingRowsUnchanged:true,ownerGuardsPassed:true,existingSessionOwnerGuard:existingSession ? 'PASS' : 'NO_EXISTING_SESSIONS',privilegesPassed:true,foreignKeysValidated:true,inventory:restored}))
} catch (error) {
  // Avoid PostgreSQL error detail/queries because either can contain copied PII.
  console.error(JSON.stringify({gate:'correction-production-application-copy',status:'FAIL',phase,code:error.code ?? error.name,message:error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Local gate failed; private details suppressed'}))
  failed=true
} finally {
  if (admin) await admin.end().catch(()=>{})
  await db.stop().catch(()=>{})
  await rm(root,{recursive:true,force:true})
}
// embedded-postgres' async-exit-hook otherwise supplies a zero beforeExit code.
// Passing the result explicitly preserves failures after all cleanup completes.
process.exit(failed ? 1 : 0)
