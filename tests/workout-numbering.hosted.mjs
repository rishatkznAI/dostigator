import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

assert.equal(process.env.DOSTIGATOR_NUMBERING_AUDIT, '1', 'explicit opt-in is required')
assert.equal(process.env.AUDIT_PROJECT_REF, 'xorlzijpgklasatxzcnn')
const url = process.env.VITE_SUPABASE_URL
assert.equal(new URL(url).hostname, 'xorlzijpgklasatxzcnn.supabase.co')
const client = () => createClient(url, process.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(15000)]) }) },
})
const a = client(), b = client(), id = randomUUID(), exerciseId = randomUUID(), firstId = randomUUID(), factId = randomUUID()
const out = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT ?? '.cache/workout-numbering-hosted')
await mkdir(out, { recursive: true })
const result = { checks: [], failures: [], sessionId: id, setIdsBefore: [firstId, factId], setIdsAfter: [], rpcStatuses: [], productionTraffic: false, physicalPhone: false }
const check = name => { result.checks.push(name); console.log('PASS ' + name) }
const ok = response => { assert.equal(response.error, null, response.error?.message); return response.data }
try {
  const owner = ok(await a.auth.signInWithPassword({ email: 'audit-a@example.invalid', password: process.env.AUDIT_PASSWORD })).user.id
  ok(await b.auth.signInWithPassword({ email: 'audit-b@example.invalid', password: process.env.AUDIT_PASSWORD }))
  const key = JSON.parse(await readFile('src/lib/program-v21.json', 'utf8')).find(template => template.code === 'A').items[0].exercise.key
  const stamp = new Date().toISOString()
  const session = { id, user_id: owner, template_code: 'A', title: 'Disposable hosted numbering audit', started_at: stamp, finished_at: null, timer_paused_at: null, timer_paused_duration_ms: 0, readiness_discomfort: false, note: '' }
  const exercises = [{ id: exerciseId, session_id: id, exercise_key: key, exercise_name: 'Synthetic numbering exercise', target: '8–12', sort_order: 1, skipped: false, skip_reason: '', note: '' }]
  const makeSet = (setId, number, done) => ({ id: setId, session_id: id, session_exercise_id: exerciseId, set_number: number, weight_kg: done ? 42.5 : null, reps: done ? 9 : null, rir: null, done, is_warmup: false, completed_at: done ? stamp : null })
  const beforeSets = [makeSet(firstId, 1, false), makeSet(factId, 2, true)]
  const base = { p_expected_owner: owner, p_session: session, p_exercises: exercises }
  const save = async request => { const response = await a.rpc('training_save_workout', request); result.rpcStatuses.push(response.status); return ok(response) }
  const first = await save({ ...base, p_expected_revision: 0, p_mutation_id: randomUUID(), p_sets: beforeSets, p_deleted_set_ids: [] })
  assert.equal(first.id, id); assert.equal(first.revision, 1)
  const read = async () => ({
    session: ok(await a.from('workout_sessions').select('id,user_id,revision').eq('id', id).single()),
    sets: ok(await a.from('workout_sets').select('id,user_id,set_number,weight_kg,reps,rir,done,completed_at').eq('session_id', id).order('set_number')),
  })
  const before = await read()
  assert.deepEqual(before.sets.map(set => set.id), [firstId, factId])
  assert.ok(before.sets.every(set => set.user_id === owner && set.rir === null))
  check('real hosted RPC saves two set UUIDs with nullable RIR and verifies the expected owner')
  const request = { ...base, p_expected_revision: 1, p_mutation_id: randomUUID(), p_sets: [{ ...beforeSets[1], set_number: 1 }], p_deleted_set_ids: [firstId] }
  const response = await save(request)
  assert.equal(response.id, id); assert.equal(response.revision, 2)
  const after = await read()
  assert.equal(after.session.user_id, owner); assert.equal(after.session.revision, 2)
  assert.equal(after.sets.length, 1)
  assert.deepEqual(after.sets[0], { ...before.sets[1], set_number: 1 })
  result.setIdsAfter = after.sets.map(set => set.id)
  check('remove first set and renumber the surviving fact succeeds without changing its UUID, weight, reps, RIR or completion time')
  assert.deepEqual(await save(request), response)
  assert.deepEqual(await read(), after)
  check('exact mutation/payload retry returns the original receipt and leaves revision and fact unchanged')
  assert.deepEqual(ok(await b.from('workout_sets').select('id').eq('session_id', id)), [])
  const wrongOwner = await b.rpc('training_save_workout', request)
  assert.equal(wrongOwner.error?.code, '42501')
  assert.deepEqual(await read(), after)
  check('second account cannot read or replay the owner-bound request')
} catch (error) { result.failures.push({ message: error.message, code: error.code ?? null }) }
finally {
  await Promise.allSettled([a.auth.signOut({ scope: 'local' }), b.auth.signOut({ scope: 'local' })])
  await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  if (result.failures.length) process.exitCode = 1
}
