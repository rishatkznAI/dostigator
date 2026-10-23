import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
export async function v21Cases(admin,asUser,owner) {
 const templates=JSON.parse(await readFile('src/lib/program-v21.json','utf8'))
 for(const t of templates.slice(0,2)) {
  const sid=randomUUID()
  const session={id:sid,template_code:t.code,title:`Тренировка ${t.code} · V2.1`,started_at:'2026-10-22T09:00:00Z',finished_at:'2026-10-22T10:15:00Z',timer_paused_at:null,timer_paused_duration_ms:0,readiness_sleep:null,readiness_energy:null,readiness_stress:null,readiness_discomfort:false,readiness_mode:null,readiness_note:'',note:''}
  const exercises=t.items.map(i=>({id:randomUUID(),session_id:sid,exercise_key:i.exercise.key,exercise_name:i.exercise.name,target:i.repTarget,sort_order:i.sortOrder,skipped:false,skip_reason:'',note:''}))
  const sets=exercises.flatMap((e,i)=>Array.from({length:t.items[i].setCount},(_,n)=>({id:randomUUID(),session_id:sid,session_exercise_id:e.id,set_number:n+1,weight_kg:10,reps:Number(e.target.match(/\d+/)[0]),rir:null,done:true,is_warmup:false,completed_at:session.finished_at})))
  const mutation=randomUUID()
  const save=()=>asUser(admin,owner,'select public.training_save_workout($1,$2,$3,$4,$5,ARRAY[]::uuid[],$6) as result',[mutation,0,JSON.stringify(session),JSON.stringify(exercises),JSON.stringify(sets),owner])
  const saved=(await save()).rows[0].result
  assert.deepEqual((await save()).rows[0].result,saved)
  const got=(await asUser(admin,owner,'select exercise_key,target from workout_session_exercises where session_id=$1 order by sort_order',[sid])).rows
  assert.deepEqual(got,exercises.map(e=>({exercise_key:e.exercise_key,target:e.target})))
  const read=(await asUser(admin,owner,'select count(*)::int total,count(rir)::int reserve from workout_sets where session_id=$1',[sid])).rows[0]
  assert.deepEqual(read,{total:15,reserve:0})
  const id=randomUUID(),cardio={activity_date:'2026-10-22',kind:'walk',duration_minutes:20,duration_seconds:1217,workout_session_id:sid,distance_km:null,effort:null,average_pulse:null,speed_kmh:null,incline_percent:null,resistance_level:null,note:'V2.1 synthetic API contract test'}
  await asUser(admin,owner,'select public.cardio_apply_fact($1,$2,0,$3::jsonb,false,$4)',[id,randomUUID(),JSON.stringify(cardio),owner])
  const fact=(await asUser(admin,owner,'select public.cardio_list_facts() as fact')).rows.map(r=>r.fact).find(r=>r.id===id)
  assert.equal(fact.duration_seconds,1217);assert.equal(fact.workout_session_id,sid)
 }
 console.log('V2.1 full A/B SQL: 6+6 exercise snapshots, 15+15 nullable-RIR sets, exact linked cardio, FK and replay passed')
}
