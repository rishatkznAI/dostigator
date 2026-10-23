import assert from 'node:assert/strict'
export async function correctionCases(admin, asUser, ownerA, ownerB) {
  const session='a1000000-0000-4000-8000-000000000001', exercise='a2000000-0000-4000-8000-000000000001', set='a3000000-0000-4000-8000-000000000001'
  await admin.query(`insert into workout_sessions(id,user_id,template_code,title,started_at,finished_at,revision) values ($1,$2,'A','Correction fixture','2026-10-01','2026-10-01T01:00:00Z',1)`,[session,ownerA])
  await admin.query(`insert into workout_session_exercises(id,user_id,session_id,exercise_key,exercise_name,target,sort_order) values ($1,$2,$3,'chest_press','Original exercise','8–12',1)`,[exercise,ownerA,session])
  await admin.query(`insert into workout_sets(id,user_id,session_id,session_exercise_id,set_number,weight_kg,reps,rir,done) values ($1,$2,$3,$4,1,40,12,null,true)`,[set,ownerA,session,exercise])
  const original=(await admin.query('select * from workout_sessions where id=$1',[session])).rows[0]
  const before=(await admin.query('select * from workout_sets where id=$1',[set])).rows[0]
  const originalStamp=(await admin.query('select updated_at::text stamp from workout_sessions where id=$1',[session])).rows[0].stamp
  const mutation='a4000000-0000-4000-8000-000000000001'
  const call=(owner,change={},id=mutation)=>asUser(admin,owner,`select public.training_correct_set($1,$2,$3,$4,$5,$6,$7) result`,[change.expectedOwner??owner,id,session,change.set??set,change.revision??1,change.updatedAt??originalStamp,JSON.stringify(change.values??{weight_kg:42.5,reps:10,rir:null})])
  const rejected=async(action,code)=>{await assert.rejects(action,error=>error.code===code)}
  await rejected(()=>call(ownerB),'42501')
  await rejected(()=>call(ownerA,{expectedOwner:ownerB}),'42501')
  for(const values of [{weight_kg:-1,reps:10,rir:null},{weight_kg:10,reps:1.5,rir:null},{weight_kg:10,reps:10,rir:6},{weight_kg:10,reps:10},{weight_kg:10,reps:10,rir:null,done:false}]) await rejected(()=>call(ownerA,{values}),'22023')
  assert.deepEqual((await admin.query('select * from workout_sets where id=$1',[set])).rows[0],before)
  const first=(await call(ownerA)).rows[0].result
  assert.equal(first.revision,2);assert.equal(first.set.weight_kg,42.5);assert.equal(first.set.rir,null)
  assert.equal(first.previous_set.weight_kg,40);assert.equal(first.previous_set.reps,12)
  assert.deepEqual((await call(ownerA)).rows[0].result,first,'lost response replay must not duplicate a correction')
  await rejected(()=>call(ownerA,{values:{weight_kg:99,reps:12,rir:null}}),'PT409')
  await rejected(()=>call(ownerA,{},'a4000000-0000-4000-8000-000000000002'),'PT409')
  const after=(await admin.query('select * from workout_sessions where id=$1',[session])).rows[0]
  for(const key of Object.keys(original).filter(k=>!['revision','updated_at'].includes(k))) assert.deepEqual(after[key],original[key],`correction preserves ${key}`)
  const actual=(await admin.query('select * from workout_sets where id=$1',[set])).rows[0]
  for(const key of Object.keys(before).filter(k=>!['weight_kg','reps','rir'].includes(k))) assert.deepEqual(actual[key],before[key],`correction preserves set ${key}`)
  assert.equal((await admin.query('select count(*)::int n from private.training_requests where user_id=$1 and mutation_id=$2',[ownerA,mutation])).rows[0].n,1)
  assert.equal((await admin.query("select has_function_privilege('anon','public.training_correct_set(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb)','execute') allowed")).rows[0].allowed,false)
  await admin.query(`update workout_sessions set revision=0 where id=$1`,[session])
  const legacy=(await admin.query('select updated_at::text updated_at from workout_sessions where id=$1',[session])).rows[0].updated_at
  const legacyResult=await call(ownerA,{revision:0,updatedAt:legacy},'a4000000-0000-4000-8000-000000000003')
  assert.equal(legacyResult.rows[0].result.revision,1,'legacy snapshots can be corrected without reopening the session')
  await admin.query('delete from workout_sessions where id=$1',[session])
  console.log('PostgreSQL correction gate passed: ownership, validation/rollback, CAS, exact replay, immutable session/set identity, nullable RIR, legacy history, original fact retained')
}
