import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function productCases(admin, asUser, ownerA, ownerB, peer) {
  const call = (owner, id, revision, record, deleted = false, mutation = randomUUID(),client=admin) => asUser(client, owner,
    'select public.cardio_apply_fact($1,$2,$3,$4::jsonb,$5,$6) as result', [id,mutation,revision,JSON.stringify(record),deleted,owner])
  const fact = (seconds, workout = null) => ({activity_date:'2026-10-21',kind:'walk',duration_minutes:Math.floor(seconds/60),
    duration_seconds:seconds,workout_session_id:workout,distance_km:null,effort:null,average_pulse:null,
    speed_kmh:5.5,incline_percent:3,resistance_level:null,note:'Exact test'})
  const parent = randomUUID()
  await asUser(admin,ownerA,"insert into public.workout_sessions(id,title,template_code) values($1,'Parent','A')",[parent])
  const id=randomUUID(), mutation=randomUUID()
  const first=(await call(ownerA,id,0,fact(1217,parent),false,mutation)).rows[0].result
  assert.equal(first.duration_seconds,1217); assert.equal(first.workout_session_id,parent); assert.equal(first.revision,1)
  assert.deepEqual((await call(ownerA,id,0,fact(1217,parent),false,mutation)).rows[0].result,first,'timeout-after-commit retry')
  await assert.rejects(()=>call(ownerA,id,0,fact(1218,parent),false,mutation),/Mutation ID reused/)
  const device2=(await asUser(admin,ownerA,'select public.cardio_list_facts() as result')).rows.map(r=>r.result).find(r=>r.id===id)
  assert.deepEqual(device2,first,'independent DB read includes seconds, link and metrics')
  assert.equal((await asUser(admin,ownerA,'select duration_minutes from public.cardio_sessions where id=$1',[id])).rows[0].duration_minutes,20)
  assert.equal((await asUser(admin,ownerB,'select * from public.cardio_facts where id=$1',[id])).rowCount,0)
  await assert.rejects(()=>call(ownerB,randomUUID(),0,fact(77,parent)),/foreign key/)
  await assert.rejects(()=>call(ownerB,id,1,fact(77)),/Access denied/)
  await assert.rejects(()=>asUser(admin,ownerA,"update public.cardio_sessions set duration_minutes=1 where id=$1",[id]),/новый API/)
  await assert.rejects(()=>asUser(admin,ownerA,'delete from public.cardio_sessions where id=$1',[id]),/новый API/)
  await assert.rejects(()=>asUser(admin,ownerA,'update public.cardio_facts set revision=99 where id=$1',[id]),/permission denied/)
  await assert.rejects(()=>asUser(admin,ownerA,'delete from public.workout_sessions where id=$1',[parent]),/foreign key/)
  const second=(await call(ownerA,id,1,fact(77,parent))).rows[0].result
  await assert.rejects(()=>call(ownerA,id,1,fact(1220,parent)),/Cardio conflict/)
  assert.equal(second.revision,2)
  const raced=await Promise.allSettled([call(ownerA,id,2,fact(80,parent)),call(ownerA,id,2,fact(81,parent),false,randomUUID(),peer)])
  assert.equal(raced.filter(r=>r.status==='fulfilled').length,1,'two actual DB connections cannot both update the same revision')
  assert.equal(raced.filter(r=>r.status==='rejected').length,1)
  for(const seconds of [1,45,59,60,77,86400,86459]) {
    const key=randomUUID(); await call(ownerA,key,0,fact(seconds))
    assert.equal((await asUser(admin,ownerA,'select id from public.cardio_sessions where id=$1',[key])).rowCount,seconds<60?0:1)
  }
  for(const seconds of [0,86460]) await assert.rejects(()=>call(ownerA,randomUUID(),0,fact(seconds)),/check constraint/)
  const legacy=randomUUID()
  await asUser(admin,ownerA,"insert into public.cardio_sessions(id,kind,duration_minutes) values($1,'bike',20)",[legacy])
  const old=(await asUser(admin,ownerA,'select public.cardio_list_facts() as result')).rows.map(r=>r.result).find(r=>r.id===legacy)
  assert.equal(old.duration_seconds,null); assert.equal(old.workout_session_id,null); assert.equal(old.revision,0)
  const deleted=(await call(ownerA,id,3,null,true)).rows[0].result
  assert.ok(deleted.deleted_at)
  await assert.rejects(()=>call(ownerA,id,4,fact(77,parent)),/Cardio conflict/)
  assert.equal((await asUser(admin,ownerA,'select public.cardio_list_facts() as result')).rows.filter(r=>r.result.id===id).length,0)
  assert.equal((await asUser(admin,ownerA,'select public.cardio_list_facts(true) as result')).rows.filter(r=>r.result.id===id).length,1)
  for(const table of ['cardio_facts','private.training_requests']) {
    assert.equal((await admin.query('select has_table_privilege($1,$2,$3) as allowed',['anon',table,'select'])).rows[0].allowed,false)
  }
  assert.equal((await admin.query("select has_function_privilege('anon','public.cardio_apply_fact(uuid,uuid,bigint,jsonb,boolean,uuid)','execute') as allowed")).rows[0].allowed,false)

  const sid=randomUUID(), eid=randomUUID(), setid=randomUUID()
  const session={id:sid,template_code:'A',title:'Atomic test',started_at:'2026-10-21T10:00:00Z',finished_at:null,
    timer_paused_at:null,timer_paused_duration_ms:0,readiness_sleep:null,readiness_energy:null,readiness_stress:null,
    readiness_discomfort:false,readiness_mode:null,readiness_note:'',note:''}
  const ex=[{id:eid,session_id:sid,exercise_key:null,exercise_name:'Synthetic',target:'8–12',sort_order:1,skipped:false,skip_reason:'',note:''}]
  const sets=[{id:setid,session_id:sid,session_exercise_id:eid,set_number:1,weight_kg:10,reps:9,rir:null,done:true,is_warmup:false,completed_at:'2026-10-21T10:02:00Z'}]
  const workout=(rev,s=session,e=ex,t=sets,m=randomUUID(),owner=ownerA)=>asUser(admin,owner,
    'select public.training_save_workout($1,$2,$3,$4,$5,ARRAY[]::uuid[],$6) as result',[m,rev,JSON.stringify(s),JSON.stringify(e),JSON.stringify(t),owner])
  await assert.rejects(()=>workout(0,session,ex,[{...sets[0],session_exercise_id:randomUUID()}]),/foreign key/)
  assert.equal((await admin.query('select id from public.workout_sessions where id=$1',[sid])).rowCount,0,'failure rolls back the whole graph')
  await workout(0)
  assert.equal((await asUser(admin,ownerA,'select rir from public.workout_sets where id=$1',[setid])).rows[0].rir,null)
  await assert.rejects(()=>workout(0),/Workout conflict/)
  await assert.rejects(()=>workout(1,session,ex,sets,randomUUID(),ownerB),/Access denied/)
  const done={...session,finished_at:'2026-10-21T11:00:00Z'},mid=randomUUID()
  const completed=(await workout(1,done,ex,sets,mid)).rows[0].result
  assert.deepEqual((await workout(1,done,ex,sets,mid)).rows[0].result,completed)
  await assert.rejects(()=>workout(2),/Workout conflict/)
  await assert.rejects(()=>asUser(admin,ownerA,'update public.workout_sessions set finished_at=null where id=$1',[sid]),/атомарное/)
  await assert.rejects(()=>asUser(admin,ownerA,'update public.workout_sets set reps=1 where id=$1',[setid]),/atomic/)
  const legacyTime=(await asUser(admin,ownerA,'select updated_at::text as updated_at from public.cardio_sessions where id=$1',[legacy])).rows[0].updated_at
  await assert.rejects(()=>call(ownerA,legacy,0,{...fact(1217),legacy_updated_at:'2000-01-01T00:00:00Z'}),/Legacy cardio changed/)
  const upgraded=(await call(ownerA,legacy,0,{...fact(1217),legacy_updated_at:legacyTime})).rows[0].result
  assert.equal(upgraded.duration_seconds,1217)
  const backupId=randomUUID(),restoreId=randomUUID(),backup=[{...upgraded,id:backupId}]
  const restore=records=>asUser(admin,ownerA,'select public.cardio_restore_facts($1,$2::jsonb) as result',[restoreId,JSON.stringify(records)])
  const restored=await restore(backup)
  assert.equal(restored.rows[0].result.restored,1)
  assert.equal((await admin.query('select created_at=$2::timestamptz as same from public.cardio_facts where id=$1',[backupId,upgraded.created_at])).rows[0].same,true,'restore retains historical creation time')
  assert.deepEqual((await restore(backup)).rows[0].result,restored.rows[0].result)
  const missingId=randomUUID()
  await assert.rejects(()=>asUser(admin,ownerA,'select public.cardio_restore_facts($1,$2::jsonb)',[randomUUID(),JSON.stringify([{...upgraded,id:missingId},{...upgraded,note:'different'}])]),/Backup conflicts/)
  assert.equal((await admin.query('select id from public.cardio_facts where id=$1',[missingId])).rowCount,0,'restore is atomic')
  const cancelId=randomUUID(),cancelSession={...session,id:cancelId}
  await workout(0,cancelSession,[],[])
  await asUser(admin,ownerA,'select public.training_cancel_workout($1,$2,1,$3)',[cancelId,randomUUID(),ownerA])
  await assert.rejects(()=>workout(0,cancelSession,[],[]),/Workout cancelled/)
  await assert.rejects(()=>asUser(admin,ownerA,"insert into public.workout_sessions(id,title,template_code) values($1,'Late legacy writer','A')",[cancelId]),/Workout cancelled/)
  const concurrentId=randomUUID()
  await workout(0,{...session,id:concurrentId},[],[])
  await peer.query('begin')
  await peer.query('set local role authenticated')
  await peer.query("select set_config('request.jwt.claim.sub',$1,true)",[ownerA])
  await peer.query('select public.training_cancel_workout($1,$2,1,$3)',[concurrentId,randomUUID(),ownerA])
  const late=asUser(admin,ownerA,"insert into public.workout_sessions(id,title,template_code) values($1,'Concurrent stale client','A')",[concurrentId])
  const rejected=assert.rejects(()=>late,/Workout cancelled/)
  await peer.query('commit');await rejected
  assert.equal((await admin.query('select id from workout_sessions where id=$1',[concurrentId])).rowCount,0)
  await assert.rejects(()=>asUser(admin,ownerB,'select public.training_save_workout($1,0,$2,\'[]\',\'[]\',\'{}\',$3)',[randomUUID(),JSON.stringify({...session,id:randomUUID()}),ownerA]),/owner changed/)
  await assert.rejects(()=>asUser(admin,ownerB,'select public.training_cancel_workout($1,$2,0,$3)',[randomUUID(),randomUUID(),ownerA]),/owner changed/)
  const legacyParent=randomUUID()
  await asUser(admin,ownerA,"insert into public.workout_sessions(id,title,template_code) values($1,'Legacy active','A')",[legacyParent])
  const legacyParentTime=(await admin.query('select updated_at::text as stamp from public.workout_sessions where id=$1',[legacyParent])).rows[0].stamp
  await assert.rejects(()=>workout(0,{...session,id:legacyParent},[],[]),/Workout conflict/)
  await workout(0,{...session,id:legacyParent,legacy_updated_at:legacyParentTime},[],[])
  const tombstoneId=randomUUID()
  await call(ownerA,tombstoneId,0,fact(45),true)
  await assert.rejects(()=>call(ownerA,tombstoneId,0,fact(45)),/Cardio conflict/)
  console.log('Product SQL: exact cardio, legacy projection, owner/FK/RLS, tombstones, CAS, retries and atomic completion passed')
}
