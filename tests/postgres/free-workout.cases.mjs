import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function freeWorkoutCases(admin, asUser, ownerA, ownerB) {
  const id = randomUUID(), exercise = randomUUID(), set = randomUUID(), custom = `custom:${randomUUID()}`, mutation = randomUUID()
  const note = 'dostigator:custom-exercise:v1:' + JSON.stringify({ key: custom, name: 'Своё упражнение', muscles: ['Плечи'], steps: ['Моя подсказка'] })
  const session = { id, template_code: null, title: 'Свободное занятие', started_at: '2026-10-25T10:00:00Z', finished_at: '2026-10-25T10:15:00Z', timer_paused_at: null, timer_paused_duration_ms: 0, readiness_sleep: null, readiness_energy: null, readiness_stress: null, readiness_discomfort: false, readiness_mode: null, readiness_note: '', note: 'dostigator:free-workout:v1' }
  const exercises = [{ id: exercise, session_id: id, exercise_key: null, exercise_name: 'Своё упражнение', target: '8–12', sort_order: 1, skipped: false, skip_reason: '', note }]
  const sets = [{ id: set, session_id: id, session_exercise_id: exercise, set_number: 1, weight_kg: 12.5, reps: 10, rir: null, done: true, is_warmup: false, completed_at: '2026-10-25T10:14:00Z' }]
  const templatesBefore = (await admin.query('select jsonb_agg(to_jsonb(t) order by code) as value from public.workout_templates t')).rows[0].value
  const call = owner => asUser(admin, owner, 'select public.training_save_workout($1,0,$2,$3,$4,ARRAY[]::uuid[],$5) as result', [mutation, JSON.stringify(session), JSON.stringify(exercises), JSON.stringify(sets), owner])
  const saved = (await call(ownerA)).rows[0].result
  assert.equal(saved.id, id)
  assert.deepEqual((await call(ownerA)).rows[0].result, saved, 'retry has no duplicate free session')
  const row = (await asUser(admin, ownerA, 'select exercise_key,exercise_name,note from public.workout_session_exercises where id=$1', [exercise])).rows[0]
  assert.equal(row.exercise_key, null); assert.equal(row.note, note)
  assert.equal((await asUser(admin, ownerA, 'select template_code,note from public.workout_sessions where id=$1', [id])).rows[0].template_code, null)
  assert.equal((await asUser(admin, ownerB, 'select * from public.workout_session_exercises where id=$1', [exercise])).rowCount, 0)
  await assert.rejects(() => call(ownerB), /Access denied|Mutation ID reused/)
  assert.deepEqual((await admin.query('select jsonb_agg(to_jsonb(t) order by code) as value from public.workout_templates t')).rows[0].value, templatesBefore, 'free sessions never modify the program')
  console.log('Free workout SQL: null template/custom FK, custom snapshot, exact retry, owner isolation and unchanged program passed')
}
