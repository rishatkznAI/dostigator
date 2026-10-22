import assert from 'node:assert/strict'
export async function trainingUxCases(admin,asUser,ownerA,ownerB) {
 const sid='11111111-2222-4333-8444-000000000001',eid='11111111-2222-4333-8444-000000000002',setid='11111111-2222-4333-8444-000000000003'
 const key=(await admin.query('select key from public.exercise_library order by key limit 1')).rows[0].key
 await asUser(admin,ownerA,`insert into public.workout_sessions(id,template_code,title,started_at) values($1,'A','Synthetic UX test',now())`,[sid])
 await asUser(admin,ownerA,`insert into public.workout_session_exercises(id,session_id,exercise_key,exercise_name,target,sort_order) values($1,$2,$3,'Synthetic exercise','8–12',1)`,[eid,sid,key])
 const sql=`insert into public.workout_sets(id,session_id,session_exercise_id,set_number,weight_kg,reps,rir,done,is_warmup,completed_at) values($1,$2,$3,1,50,$4,$5,true,false,now()) on conflict(id) do update set reps=excluded.reps,rir=excluded.rir`
 await asUser(admin,ownerA,sql,[setid,sid,eid,10,null])
 await asUser(admin,ownerA,sql,[setid,sid,eid,9,2])
 await asUser(admin,ownerA,sql,[setid,sid,eid,9,null])
 const row=(await asUser(admin,ownerA,'select reps,rir,count(*) over()::int as count from public.workout_sets where id=$1',[setid])).rows[0]
 assert.deepEqual(row,{reps:9,rir:null,count:1})
 assert.equal((await asUser(admin,ownerB,'select id from public.workout_sets where id=$1',[setid])).rows.length,0)
 console.log('PostgreSQL training UX gate passed: nullable RIR, correction, idempotent UUID, owner isolation')
}
