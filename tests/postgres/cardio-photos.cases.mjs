import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function cardioPhotoCases(admin, asUser, ownerA, ownerB) {
  const bucketBefore = (await admin.query("select to_jsonb(b) data from storage.buckets b where id='trainlog-progress-photos'")).rows[0].data
  assert.equal(bucketBefore.public, false)
  const policies = (await admin.query("select policyname,roles,cmd,qual,with_check from pg_policies where schemaname='storage' and tablename='objects' order by policyname")).rows
  const fact = { activity_date: '2026-10-24', kind: 'walk', duration_minutes: 20, duration_seconds: 1200, workout_session_id: null, distance_km: null, average_pulse: null, effort: null, speed_kmh: null, incline_percent: null, resistance_level: null, note: 'Synthetic photo parent' }
  const cardio = async owner => {
    const id = randomUUID()
    await asUser(admin, owner, 'select public.cardio_apply_fact($1,$2,0,$3::jsonb,false,$4)', [id, randomUUID(), JSON.stringify(fact), owner])
    return id
  }
  const parentA = await cardio(ownerA), parentB = await cardio(ownerB), deletedParent = await cardio(ownerA)
  await asUser(admin, ownerA, 'select public.cardio_apply_fact($1,$2,1,null,true,$3)', [deletedParent, randomUUID(), ownerA])
  const photo = (owner = ownerA, parent = parentA) => {
    const id = randomUUID()
    return { id, user_id: owner, cardio_id: parent, object_path: `${owner}/cardio/${parent}/${id}.jpg`, byte_size: 128, sha256: 'a'.repeat(64) }
  }
  const insertSql = `insert into public.cardio_result_photos(id,user_id,cardio_id,object_path,byte_size,sha256,deleted_at)
    values($1,$2,$3,$4,$5,$6,$7) on conflict(id) do nothing returning *`
  const values = row => [row.id, row.user_id, row.cardio_id, row.object_path, row.byte_size, row.sha256, row.deleted_at ?? null]
  const insert = (row, owner = ownerA) => asUser(admin, owner, insertSql, values(row))
  const reject = (action, code) => assert.rejects(action, error => error.code === code)
  const own = photo()
  const saved = (await insert(own)).rows[0]
  assert.ok(saved.created_at)
  for (const field of Object.keys(own)) assert.equal(saved[field], own[field])
  assert.equal((await insert(own)).rowCount, 0, 'ignore-duplicate retry uses no UPDATE privilege')
  assert.equal((await asUser(admin, ownerA, 'select * from public.cardio_result_photos where id=$1', [own.id])).rowCount, 1)
  assert.equal((await asUser(admin, ownerB, 'select * from public.cardio_result_photos where id=$1', [own.id])).rowCount, 0)
  assert.equal((await asUser(admin, ownerB, 'update public.cardio_result_photos set deleted_at=now() where id=$1', [own.id])).rowCount, 0)
  await reject(() => insert(photo(ownerA, parentB)), '42501')
  await reject(() => insert(photo(ownerB, parentB)), '42501')
  await reject(() => insert(photo(ownerA, deletedParent)), '42501')
  const tombstoneBeforeAck = { ...photo(ownerA, deletedParent), deleted_at: '2026-10-25T12:00:00Z' }
  await insert(tombstoneBeforeAck)
  await reject(() => insert({ ...photo(ownerA, parentB), deleted_at: tombstoneBeforeAck.deleted_at }), '42501')
  await reject(() => insert(photo(ownerA, randomUUID())), '42501')
  await reject(() => admin.query(insertSql, values(photo(ownerA, parentB))), '42501')
  await reject(() => insert({ ...photo(), object_path: `${ownerB}/cardio/${parentA}/${randomUUID()}.jpg` }), '23514')
  await reject(() => insert({ ...photo(), object_path: `${ownerA}/cardio/${parentA}/../photo.jpg` }), '23514')
  for (const byte_size of [0, -1, 2097153]) await reject(() => insert({ ...photo(), byte_size }), '23514')
  for (const sha256 of ['', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)]) await reject(() => insert({ ...photo(), sha256 }), '23514')
  const maxSize = photo(); maxSize.byte_size = 2097152
  await insert(maxSize)
  const minSize = photo(); minSize.byte_size = 1
  await insert(minSize)
  await reject(() => asUser(admin, ownerA, 'update public.cardio_result_photos set sha256=$1 where id=$2', ['b'.repeat(64), own.id]), '42501')
  const deleted = (await asUser(admin, ownerA, 'update public.cardio_result_photos set deleted_at=now() where id=$1 returning *', [own.id])).rows[0]
  assert.ok(deleted.deleted_at)
  assert.equal((await insert(own)).rowCount, 0, 'late active INSERT retry cannot resurrect an existing tombstone')
  const repeatedDelete = (await asUser(admin, ownerA, 'update public.cardio_result_photos set deleted_at=now() where id=$1 returning *', [own.id])).rows[0]
  assert.equal(repeatedDelete.deleted_at.getTime(), deleted.deleted_at.getTime(), 'repeat deletion keeps the first tombstone timestamp')
  assert.equal((await asUser(admin, ownerA, 'select * from public.cardio_result_photos where id=$1 and deleted_at is not null', [own.id])).rowCount, 1, 'own tombstones remain readable for retries')
  await reject(() => asUser(admin, ownerA, 'update public.cardio_result_photos set deleted_at=null where id=$1', [own.id]), '42501')
  await reject(() => admin.query('update public.cardio_result_photos set sha256=$1 where id=$2', ['b'.repeat(64), own.id]), '42501')
  await reject(() => asUser(admin, ownerA, 'delete from public.cardio_result_photos where id=$1', [own.id]), '42501')

  await admin.query('begin')
  try {
    await admin.query('set local role anon')
    await assert.rejects(() => admin.query('select * from public.cardio_result_photos'), /permission denied/)
  } finally { await admin.query('rollback') }
  assert.deepEqual((await admin.query(`select
    has_table_privilege('anon','public.cardio_result_photos','select') anon_select,
    has_table_privilege('anon','public.cardio_result_photos','insert') anon_insert,
    has_table_privilege('authenticated','public.cardio_result_photos','update') auth_update,
    has_table_privilege('authenticated','public.cardio_result_photos','delete') auth_delete,
    has_column_privilege('authenticated','public.cardio_result_photos','deleted_at','update') auth_tombstone,
    has_column_privilege('authenticated','public.cardio_result_photos','object_path','update') auth_path_update,
    has_table_privilege('authenticated','public.cardio_result_photos','select,insert') auth_read_insert`)).rows[0], { anon_select: false, anon_insert: false, auth_update: false, auth_delete: false, auth_tombstone: true, auth_path_update: false, auth_read_insert: true })
  assert.equal((await admin.query("select prosecdef from pg_proc where oid='private.check_cardio_result_photo_parent()'::regprocedure")).rows[0].prosecdef, false)

  // Real SQL storage ACLs remain owner-scoped. The hosted gate checks blob upload/signing.
  const object = randomUUID(), name = photo().object_path
  // Match the hosted Storage service's baseline grants in the minimal SQL fixture.
  await admin.query('grant usage on schema storage to authenticated')
  await admin.query('grant select,insert,delete,update on storage.objects to authenticated')
  await asUser(admin, ownerA, 'insert into storage.objects(id,bucket_id,name) values($1,$2,$3)', [object, 'trainlog-progress-photos', name])
  assert.equal((await asUser(admin, ownerB, 'select id from storage.objects where id=$1', [object])).rowCount, 0)
  assert.equal((await asUser(admin, ownerB, 'delete from storage.objects where id=$1', [object])).rowCount, 0)
  await reject(() => asUser(admin, ownerB, 'insert into storage.objects(id,bucket_id,name) values($1,$2,$3)', [randomUUID(), 'trainlog-progress-photos', name]), '42501')
  assert.equal((await asUser(admin, ownerA, 'delete from storage.objects where id=$1', [object])).rowCount, 1)
  assert.deepEqual((await admin.query("select to_jsonb(b) data from storage.buckets b where id='trainlog-progress-photos'")).rows[0].data, bucketBefore)
  assert.deepEqual((await admin.query("select policyname,roles,cmd,qual,with_check from pg_policies where schemaname='storage' and tablename='objects' order by policyname")).rows, policies)
  await admin.query('delete from public.cardio_facts where id=$1', [parentA])
  assert.equal((await admin.query('select id from public.cardio_result_photos where cardio_id=$1', [parentA])).rowCount, 0, 'hard parent deletion cascades metadata')
  console.log('PostgreSQL cardio photos passed: immutable owner metadata, active parent, path/size/hash checks, duplicate-ignore retry, durable tombstones/no resurrection, FK cascade, anon denial and unchanged private-bucket policies')
}
