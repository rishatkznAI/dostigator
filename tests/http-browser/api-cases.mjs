import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
const origin='http://127.0.0.1:4210',{tokens}=await(await fetch(origin+'/__test/identities')).json()
const rpc=async(name,body,jwt=tokens.ownerB)=>{const r=await fetch(origin+'/rest/v1/rpc/'+name,{method:'POST',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();return {status:r.status,data}}
const rows=async(path,jwt=tokens.ownerB)=>{const r=await fetch(origin+'/rest/v1/'+path,{headers:{Authorization:'Bearer '+jwt}});return {status:r.status,data:await r.json()}}
const templates=JSON.parse(await readFile('src/lib/program-v21.json','utf8'))
function graph(t=templates[0]){const id=randomUUID(),now=new Date().toISOString();const exercises=t.items.map(i=>({id:randomUUID(),session_id:id,exercise_key:i.exercise.key,exercise_name:i.exercise.name,target:i.repTarget,sort_order:i.sortOrder,skipped:false,skip_reason:''}));const sets=exercises.flatMap((e,i)=>Array.from({length:t.items[i].setCount},(_,n)=>({id:randomUUID(),session_id:id,session_exercise_id:e.id,set_number:n+1,weight_kg:null,reps:null,rir:null,done:false,is_warmup:false,completed_at:null})));return {p_session:{id,template_code:t.code,title:'HTTP isolated '+t.code,started_at:now,finished_at:null,timer_paused_at:null,timer_paused_duration_ms:0,readiness_sleep:null,readiness_energy:null,readiness_stress:null,readiness_discomfort:false,readiness_mode:null,readiness_note:'',note:''},p_exercises:exercises,p_sets:sets,p_deleted_set_ids:[]}}
const save=(g,rev,mutation=randomUUID())=>rpc('training_save_workout',{...g,p_expected_revision:rev,p_mutation_id:mutation})
const finished=[]
for(const t of templates.slice(0,2)){
 const g=graph(t);let rev=0;let r=await save(g,rev++);assert.equal(r.status,200,JSON.stringify(r))
 for(const s of g.p_sets){Object.assign(s,{done:true,weight_kg:10,reps:10,rir:null,completed_at:new Date().toISOString()});r=await save(g,rev++);assert.equal(r.status,200,JSON.stringify(r))}
 g.p_session.finished_at=new Date().toISOString();r=await save(g,rev);assert.equal(r.status,200);assert.equal(r.data.revision,17)
 const read=await rows(`workout_sets?session_id=eq.${g.p_session.id}&select=*`);assert.equal(read.data.length,15);assert(read.data.every(s=>s.done&&s.rir===null));finished.push(g.p_session.id)
}
console.log('PASS HTTP A/B: create, each of 30 sets, optional RIR, completion, reread, exact cardinality')
const g=graph(),request={...g,p_expected_revision:0,p_mutation_id:randomUUID()}
await fetch(origin+'/__test/mode?value=lost-response');await assert.rejects(()=>rpc('training_save_workout',request));await fetch(origin+'/__test/mode?value=online')
const retry=await rpc('training_save_workout',request);assert.equal(retry.status,200);assert.equal(retry.data.revision,1);assert.equal((await rpc('training_save_workout',request)).data.revision,1)
console.log('PASS HTTP lost response after commit: exact retry returns revision 1, no duplicate')
const stale=await save(g,0);assert(stale.status>=400);assert.equal(stale.data.code,'40001')
assert.equal((await rows(`workout_sessions?id=eq.${g.p_session.id}`,tokens.ownerA)).data.length,0)
const denied=await rpc('training_cancel_workout',{p_id:g.p_session.id,p_mutation_id:randomUUID(),p_expected_revision:1},tokens.ownerA);assert.equal(denied.status,403)
console.log('PASS HTTP CAS conflict and cross-owner read/write isolation')
const cancel={p_id:g.p_session.id,p_mutation_id:randomUUID(),p_expected_revision:1}
assert.equal((await rpc('training_cancel_workout',cancel)).data.cancelled,true);assert.equal((await rpc('training_cancel_workout',cancel)).data.cancelled,true)
const tombstone=await save(g,1);assert(tombstone.status>=400);assert.equal(tombstone.data.code,'40001');assert.equal((await rows(`workout_sessions?id=eq.${g.p_session.id}`)).data.length,0)
console.log('PASS HTTP cancellation/replay/tombstone: late autosave cannot resurrect')
const cardioId=randomUUID(),cardio={activity_date:'2026-10-22',kind:'walk',duration_minutes:20,duration_seconds:1217,workout_session_id:finished[0],distance_km:null,effort:null,average_pulse:null,speed_kmh:null,incline_percent:null,resistance_level:null,note:'isolated HTTP'}
const cr=await rpc('cardio_apply_fact',{p_id:cardioId,p_mutation_id:randomUUID(),p_expected_revision:0,p_record:cardio,p_delete:false});assert.equal(cr.status,200,JSON.stringify(cr))
const facts=await rpc('cardio_list_facts',{p_include_deleted:false});const fact=facts.data.find(f=>f.id===cardioId);assert.equal(fact.duration_seconds,1217);assert.equal(fact.workout_session_id,finished[0])
console.log('PASS HTTP exact cardio 20:17 survives API reload and preserves workout link')
const invalid=graph();invalid.p_sets[0].session_exercise_id=randomUUID();const invalidResult=await save(invalid,0);assert.equal(invalidResult.status,409);assert.equal(invalidResult.data.code,'23503');assert.equal((await rows(`workout_sessions?id=eq.${invalid.p_session.id}`)).data.length,0)
const legacyTables=['dostigator_areas','dostigator_goals','dostigator_actions','dostigator_habits','dostigator_habit_checkins','dostigator_weekly_reviews']
for(const table of legacyTables){const owner=await rows(table+'?select=id&limit=1');assert.equal(owner.status,200);const anon=await rows(table+'?select=*&limit=1',tokens.anon);assert([401,403].includes(anon.status),JSON.stringify({table,...anon}))}
console.log('PASS HTTP atomic rollback and six anonymous API read denials with owner 200 controls')
console.log('LIMIT: real PostgREST/JWT/RLS; test identities, not Supabase Auth or physical iPhone')
