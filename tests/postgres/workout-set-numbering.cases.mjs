import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

/** Replay the production failure before upgrading, then retry the identical request. */
export async function workoutSetNumberingUpgradeCases(admin, asUser, ownerA, ownerB, migration) {
  const constraint = 'workout_sets_session_exercise_id_set_number_key'
  // The historic bootstrap lacks this constraint; existing production has it.
  await admin.query(`alter table public.workout_sets add constraint ${constraint} unique(session_exercise_id,set_number)`)
  const key = (await admin.query('select key from public.exercise_library order by key limit 1')).rows[0].key
  const saveSql = 'select public.training_save_workout($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::uuid[],$7) as result'
  const save = (graph, revision, mutation = randomUUID(), owner = ownerA, expectedOwner = owner) =>
    asUser(admin, owner, saveSql, [mutation, revision, JSON.stringify(graph.session), JSON.stringify(graph.exercises), JSON.stringify(graph.sets), graph.deleted, expectedOwner])
  const receipt = async mutation => (await admin.query('select response from private.training_requests where user_id=$1 and mutation_id=$2', [ownerA, mutation])).rows
  const graph = (count = 3, owner = ownerA) => {
    const id = randomUUID(), exerciseId = randomUUID()
    return {
      session: { id, user_id: owner, template_code: 'A', title: 'Synthetic numbering regression', started_at: '2026-10-25T10:00:00Z', finished_at: null, timer_paused_at: null, timer_paused_duration_ms: 0, readiness_discomfort: false },
      exercises: [{ id: exerciseId, session_id: id, exercise_key: key, exercise_name: 'Synthetic exercise', target: '8–12', sort_order: 1, skipped: false, skip_reason: '' }],
      sets: Array.from({ length: count }, (_, i) => ({ id: randomUUID(), session_id: id, session_exercise_id: exerciseId, set_number: i + 1, weight_kg: 20 + i, reps: 8 + i, rir: null, done: i === count - 1, is_warmup: false, completed_at: i === count - 1 ? '2026-10-25T10:01:00Z' : null })),
      deleted: [],
    }
  }
  const snapshot = async id => (await admin.query(`select
    (select to_jsonb(s) from public.workout_sessions s where id=$1) session,
    (select jsonb_agg(to_jsonb(e) order by id) from public.workout_session_exercises e where session_id=$1) exercises,
    (select jsonb_agg(to_jsonb(s) order by id) from public.workout_sets s where session_id=$1) sets`, [id])).rows[0]
  const rejected = async (action, code) => assert.rejects(action, error => error.code === code)

  const original = graph()
  await save(original, 0)
  const before = await snapshot(original.session.id)
  const removal = { ...original, sets: original.sets.slice(1).map((set, i) => ({ ...set, set_number: i + 1 })), deleted: [original.sets[0].id] }
  const stuckMutation = randomUUID()
  await rejected(() => save(removal, 1, stuckMutation), '23505')
  assert.deepEqual(await snapshot(original.session.id), before, 'failed renumber must roll back every row and revision')
  assert.deepEqual(await receipt(stuckMutation), [], 'failed request must not have a success receipt')

  await admin.query(migration)
  assert.deepEqual(await snapshot(original.session.id), before, 'DDL upgrade must preserve the saved graph byte for byte')
  assert.deepEqual((await admin.query('select condeferrable,condeferred from pg_constraint where conrelid=$1::regclass and conname=$2', ['public.workout_sets', constraint])).rows[0], { condeferrable: true, condeferred: false })
  const response = (await save(removal, 1, stuckMutation)).rows[0].result
  assert.equal(response.revision, 2)
  const removedSnapshot = await snapshot(original.session.id)
  assert.deepEqual(removedSnapshot.sets.map(row => row.id).sort(), removal.sets.map(row => row.id).sort())
  for (const expected of removal.sets) {
    const actual = removedSnapshot.sets.find(row => row.id === expected.id)
    for (const field of ['set_number', 'weight_kg', 'reps', 'rir', 'done', 'is_warmup']) assert.equal(actual[field], expected[field])
  }
  assert.deepEqual((await save(removal, 1, stuckMutation)).rows[0].result, response, 'retry must return the exact receipt without advancing revision')
  assert.deepEqual(await snapshot(original.session.id), removedSnapshot)

  // Actual UI ordering after a warmup is prepended, then a work set is removed:
  // warmup #4 -> #1, existing work #1 -> #2 and work #3 remains #3.
  const warmupGraph = graph()
  warmupGraph.sets.unshift({ ...warmupGraph.sets[0], id: randomUUID(), set_number: 4, is_warmup: true, done: false })
  await save(warmupGraph, 0)
  const deleteId = warmupGraph.sets[2].id
  const warmupReorder = { ...warmupGraph, sets: warmupGraph.sets.filter(set => set.id !== deleteId).map((set, i) => ({ ...set, set_number: i + 1 })), deleted: [deleteId] }
  const warmupResult = (await save(warmupReorder, 1)).rows[0].result
  assert.equal(warmupResult.revision, 2)
  const warmupSaved = await snapshot(warmupGraph.session.id)
  for (const expected of warmupReorder.sets) {
    const actual = warmupSaved.sets.find(row => row.id === expected.id)
    assert.equal(actual.set_number, expected.set_number)
    assert.equal(actual.is_warmup, expected.is_warmup)
    assert.equal(actual.weight_kg, expected.weight_kg)
  }

  const swapped = { ...removal, sets: [...removal.sets].reverse().map((set, i) => ({ ...set, set_number: i + 1 })), deleted: [] }
  assert.equal((await save(swapped, 2)).rows[0].result.revision, 3, 'plain number swaps also preserve UUIDs')
  const stable = await snapshot(original.session.id)
  const duplicate = { ...swapped, sets: swapped.sets.map(set => ({ ...set, set_number: 1 })) }
  const badMutation = randomUUID()
  await rejected(() => save(duplicate, 3, badMutation), '23505')
  assert.deepEqual(await snapshot(original.session.id), stable, 'invalid final uniqueness must roll back before acknowledgement')
  assert.deepEqual(await receipt(badMutation), [])

  const foreign = graph(1, ownerB)
  await save(foreign, 0, randomUUID(), ownerB)
  const foreignBefore = await snapshot(foreign.session.id)
  const unauthorized = { ...removal, deleted: [...removal.deleted, foreign.sets[0].id] }
  const ownerMutation = randomUUID()
  await rejected(() => save(unauthorized, 3, ownerMutation), '42501')
  assert.deepEqual(await snapshot(original.session.id), stable, 'foreign deletion must roll back renumber and revision')
  assert.deepEqual(await snapshot(foreign.session.id), foreignBefore, 'foreign facts must remain untouched')
  assert.deepEqual(await receipt(ownerMutation), [])
  await rejected(() => save(swapped, 3, randomUUID(), ownerB, ownerA), '42501')
  assert.deepEqual(await snapshot(original.session.id), stable)

  // Still immediate outside the RPC; a direct invalid insert cannot weaken uniqueness.
  await rejected(() => admin.query(`insert into public.workout_sets(id,user_id,session_id,session_exercise_id,set_number,done,is_warmup)
    values($1,$2,$3,$4,1,false,false)`, [randomUUID(), ownerA, original.session.id, original.exercises[0].id]), '23505')
  const permissions = (await admin.query(`select
    has_function_privilege('anon','public.training_save_workout(uuid,bigint,jsonb,jsonb,jsonb,uuid[],uuid)','execute') anon,
    has_function_privilege('authenticated','public.training_save_workout(uuid,bigint,jsonb,jsonb,jsonb,uuid[],uuid)','execute') authenticated`)).rows[0]
  assert.deepEqual(permissions, { anon: false, authenticated: true })
  await admin.query(migration)
  assert.deepEqual(await snapshot(original.session.id), stable, 'reapplying the migration preserves existing facts and receipts')
  assert.deepEqual((await save(removal, 1, stuckMutation)).rows[0].result, response)
  console.log('PostgreSQL workout numbering upgrade passed: production 23505 repro, exact failed-request recovery, remove-first, warmup/reorder swaps, receipt replay, final uniqueness and owner rollback')
}
