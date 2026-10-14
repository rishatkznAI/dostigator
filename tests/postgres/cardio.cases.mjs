import assert from 'node:assert/strict'

export async function cardioCases(admin, asUser, ownerA, ownerB) {
  const created = await asUser(admin, ownerA, `insert into public.cardio_sessions (kind, duration_minutes, note) values ('walk', 25, 'Уклон 5%') returning id`)
  const sessionId = created.rows[0].id
  assert.equal((await asUser(admin, ownerA, 'select note from public.cardio_sessions where id = $1', [sessionId])).rows[0].note, 'Уклон 5%')
  assert.equal((await asUser(admin, ownerB, 'select * from public.cardio_sessions where id = $1', [sessionId])).rowCount, 0)
  assert.equal((await asUser(admin, ownerB, "update public.cardio_sessions set note = 'чужая запись' where id = $1 returning id", [sessionId])).rowCount, 0)
  assert.equal((await asUser(admin, ownerB, 'delete from public.cardio_sessions where id = $1 returning id', [sessionId])).rowCount, 0)
  await assert.rejects(() => asUser(admin, ownerA, "update public.cardio_sessions set user_id = $1 where id = $2", [ownerB, sessionId]), /row-level security/)
  await assert.rejects(() => asUser(admin, ownerA, "insert into public.cardio_sessions (user_id, kind, duration_minutes) values ($1, 'bike', 20)", [ownerB]), /row-level security/)
  await assert.rejects(() => asUser(admin, ownerA, "update public.cardio_sessions set duration_minutes = 0 where id = $1", [sessionId]), /check constraint/)
  for (const privilege of ['select', 'insert', 'update', 'delete']) {
    assert.equal((await admin.query('select has_table_privilege($1, $2, $3) as allowed', ['anon', 'public.cardio_sessions', privilege])).rows[0].allowed, false)
  }
  await asUser(admin, ownerA, "update public.cardio_sessions set note = 'обновлено' where id = $1", [sessionId])
  assert.equal((await asUser(admin, ownerA, 'select note from public.cardio_sessions where id = $1', [sessionId])).rows[0].note, 'обновлено')
  assert.equal((await asUser(admin, ownerA, 'delete from public.cardio_sessions where id = $1 returning id', [sessionId])).rowCount, 1)
  console.log('Cardio: persistence, validation and owner isolation passed')
}
