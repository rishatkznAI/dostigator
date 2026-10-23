import { expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../src/lib/supabase'
import { syncWorkoutDraft, deleteWorkoutSession, loadHistory } from '../src/lib/trainingRepository'
import { createWorkoutDraft } from '../src/lib/workout'
import { programV21Templates } from '../src/lib/program-v21'
import { getActiveDraft, saveActiveDraft } from '../src/lib/storage'

// Opt-in only. Provision disposable confirmed accounts in an independent project.
// Never run this gate against production; no service-role key is used.
it.skipIf(process.env.DOSTIGATOR_AUTH_AUDIT!=='1')('real Supabase Auth: login, refresh, RPC replay, isolation, logout and re-login',async()=>{
  const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  const ref=process.env.AUDIT_PROJECT_REF,password=process.env.AUDIT_PASSWORD!
  expect(ref).toBeTruthy();expect(ref).not.toBe('vbxkcvygfakmosjvxjwh')
  expect(new URL(url).hostname).toBe(`${ref}.supabase.co`)
  expect(password).toBeTruthy()
  const peer=createClient(url,key,{auth:{storageKey:'audit-peer-auth',persistSession:false,autoRefreshToken:false}})
  const events:string[]=[]
  const subscription=supabase.auth.onAuthStateChange(event=>events.push(event)).data.subscription
  try {
    console.info('Auth gate: password login')
    const login=await supabase.auth.signInWithPassword({email:'audit-a@example.invalid',password})
    expect(login.error?.message).toBeUndefined();expect(login.data.session).toBeTruthy()
    const owner=login.data.user!.id
    const before=login.data.session!.refresh_token
    console.info('Auth gate: refresh token')
    const refreshed=await supabase.auth.refreshSession()
    expect(refreshed.error?.message).toBeUndefined()
    expect(refreshed.data.session!.refresh_token).not.toBe(before)
    expect(events).toContain('TOKEN_REFRESHED')
    const draft=createWorkoutDraft(programV21Templates[0],owner)
    draft.exercises[0].sets[0]={...draft.exercises[0].sets[0],weightKg:40,reps:10,rir:null,done:true,completedAt:new Date().toISOString()}
    saveActiveDraft(draft)
    console.info('Auth gate: save and replay')
    await syncWorkoutDraft(draft)
    const metaKey=`trainlog:workout-cloud:${owner}:${draft.id}`
    expect(JSON.parse(localStorage.getItem(metaKey)!).revision).toBe(1)
    await syncWorkoutDraft(draft)
    expect(JSON.parse(localStorage.getItem(metaKey)!).revision).toBe(1)
    console.info('Auth gate: second user isolation')
    const b=await peer.auth.signInWithPassword({email:'audit-b@example.invalid',password})
    expect(b.error?.message).toBeUndefined()
    for(const table of ['dostigator_areas','dostigator_goals','dostigator_actions','dostigator_habits','dostigator_habit_checkins','dostigator_weekly_reviews']) {
      const own=await supabase.from(table).select('id').limit(1)
      expect(own.status,table).toBe(200);expect(own.data!.length,table).toBeGreaterThan(0)
      const other=await peer.from(table).select('id')
      expect(other.status,table).toBe(200);expect(other.data,table).toEqual([])
    }
    console.info('Auth gate: peer logged in')
    const hidden=await peer.from('workout_sessions').select('*').eq('id',draft.id)
    expect(hidden.error).toBeNull();expect(hidden.data).toEqual([])
    console.info('Auth gate: peer read isolated')
    const stolen=await peer.rpc('training_save_workout',{p_mutation_id:crypto.randomUUID(),p_expected_revision:1,p_expected_owner:b.data.user!.id,p_session:{id:draft.id},p_exercises:[],p_sets:[]})
    expect(stolen.error?.code).toBe('42501')
    console.info('Auth gate: peer overwrite rejected')
    const wrongOwner=await peer.rpc('training_cancel_workout',{p_id:crypto.randomUUID(),p_mutation_id:crypto.randomUUID(),p_expected_revision:0,p_expected_owner:owner})
    expect(wrongOwner.error?.code).toBe('42501')
    const freshWrongOwner=await peer.rpc('training_save_workout',{p_mutation_id:crypto.randomUUID(),p_expected_revision:0,p_expected_owner:owner,p_session:{id:crypto.randomUUID()},p_exercises:[],p_sets:[]})
    expect(freshWrongOwner.error?.code).toBe('42501')
    const legacySave=await supabase.rpc('training_save_workout',{p_mutation_id:crypto.randomUUID(),p_expected_revision:1,p_session:{id:draft.id},p_exercises:[],p_sets:[]}).abortSignal(AbortSignal.timeout(10000))
    expect(legacySave.status).toBe(426);expect(legacySave.error?.code).toBe('PT426')
    const legacyCancel=await supabase.rpc('training_cancel_workout',{p_id:draft.id,p_mutation_id:crypto.randomUUID(),p_expected_revision:1}).abortSignal(AbortSignal.timeout(10000))
    expect(legacyCancel.error?.code).toBe('PT426')
    const cas=await supabase.rpc('training_cancel_workout',{p_id:draft.id,p_mutation_id:crypto.randomUUID(),p_expected_revision:0,p_expected_owner:owner}).abortSignal(AbortSignal.timeout(10000))
    expect(cas.status).toBe(409);expect(cas.error?.code).toBe('PT409')
    const goalId=crypto.randomUUID(),goalMutation=crypto.randomUUID()
    const goal={id:goalId,area_id:null,title:'Hosted conflict audit',description:'',why:'',kind:'goal',status:'active',progress:0,target_date:null,completed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}
    const mutateGoal=(revision:number,mutation:string,operation:string,after:object)=>supabase.rpc('dostigator_apply_mutation',{p_expected_owner:owner,p_mutation_id:mutation,p_entity_type:'goal',p_entity_id:goalId,p_operation:operation,p_label:'Isolated audit',p_expected_revision:revision,p_after:after,p_source:'ui'}).abortSignal(AbortSignal.timeout(10000))
    expect((await mutateGoal(0,goalMutation,'goal_create',goal)).error?.message).toBeUndefined()
    expect((await mutateGoal(1,crypto.randomUUID(),'goal_edit',{...goal,title:'Edited'})).error?.message).toBeUndefined()
    expect((await mutateGoal(1,crypto.randomUUID(),'goal_edit',goal)).error?.code).toBe('PT409')
    const undo=await supabase.rpc('dostigator_undo_mutation',{p_expected_owner:owner,p_original_mutation_id:goalMutation,p_mutation_id:crypto.randomUUID(),p_source:'undo'}).abortSignal(AbortSignal.timeout(10000))
    expect(undo.status).toBe(409);expect(undo.error?.code).toBe('PT409')
    const cardioId=crypto.randomUUID(),cardio={activity_date:'2026-10-21',kind:'walk',duration_minutes:20,duration_seconds:1217,workout_session_id:draft.id}
    const exact=await supabase.rpc('cardio_apply_fact',{p_id:cardioId,p_mutation_id:crypto.randomUUID(),p_expected_revision:0,p_record:cardio,p_expected_owner:owner})
    expect(exact.error?.message).toBeUndefined();expect(exact.data.duration_seconds).toBe(1217)
    const legacyCardio=await supabase.rpc('cardio_apply_fact',{p_id:cardioId,p_mutation_id:crypto.randomUUID(),p_expected_revision:1,p_record:cardio})
    expect(legacyCardio.error?.code).toBe('PT426')
    const crossedCardio=await peer.rpc('cardio_apply_fact',{p_id:crypto.randomUUID(),p_mutation_id:crypto.randomUUID(),p_expected_revision:0,p_record:cardio,p_expected_owner:owner})
    expect(crossedCardio.error?.code).toBe('42501')
    console.info('Auth gate: owner mismatch rejected')
    const finished={...draft,finishedAt:new Date().toISOString(),updatedAt:new Date(Date.now()+1000).toISOString()}
    await syncWorkoutDraft(finished)
    console.info('Auth gate: completed workout')
    expect((await loadHistory()).filter(w=>w.id===draft.id)).toHaveLength(1)
    const pending=createWorkoutDraft(programV21Templates[1],owner)
    // Commit a real request, discard its response, then replay the persisted envelope.
    const record={id:pending.id,user_id:owner,template_code:'B',title:pending.title,started_at:pending.startedAt,finished_at:null,timer_paused_duration_ms:0,readiness_discomfort:false}
    const request={stamp:pending.updatedAt,mutation:crypto.randomUUID(),revision:0,payload:{p_session:record,p_exercises:[],p_sets:[],p_deleted_set_ids:[]}}
    localStorage.setItem(`trainlog:workout-cloud:${owner}:${pending.id}`,JSON.stringify({request}))
    const committed=await supabase.rpc('training_save_workout',{...request.payload,p_mutation_id:request.mutation,p_expected_revision:0,p_expected_owner:owner})
    expect(committed.error?.message).toBeUndefined()
    console.info('Auth gate: real commit before lost response replay')
    await syncWorkoutDraft(pending)
    expect(JSON.parse(localStorage.getItem(`trainlog:workout-cloud:${owner}:${pending.id}`)!).revision).toBe(1)
    await deleteWorkoutSession(pending.id,owner)
    const resurrect=await supabase.from('workout_sessions').insert({id:pending.id,title:'Late legacy writer',template_code:'B'}).abortSignal(AbortSignal.timeout(10000))
    expect(resurrect.error?.code).toBe('PT409')
    console.info('Auth gate: sign out and revoked refresh')
    expect((await supabase.auth.signOut()).error).toBeNull()
    expect((await supabase.auth.getSession()).data.session).toBeNull()
    expect(getActiveDraft(owner)?.id).toBe(draft.id)
    await expect(syncWorkoutDraft(draft)).rejects.toThrow()
    const refreshAfterLogout=await peer.auth.refreshSession({refresh_token:refreshed.data.session!.refresh_token})
    expect(refreshAfterLogout.error).toBeTruthy()
    console.info('Auth gate: repeat login')
    const again=await supabase.auth.signInWithPassword({email:'audit-a@example.invalid',password})
    expect(again.error?.message).toBeUndefined()
    expect((await loadHistory()).filter(w=>w.id===draft.id)).toHaveLength(1)
    expect(getActiveDraft(owner)?.id).toBe(draft.id)
    const bAgain=await peer.auth.signInWithPassword({email:'audit-b@example.invalid',password})
    expect(bAgain.error?.message).toBeUndefined()
    expect((await peer.from('workout_sessions').select('id').eq('id',draft.id)).data).toEqual([])
    expect(events).toContain('SIGNED_IN');expect(events).toContain('SIGNED_OUT')
  } finally {
    subscription.unsubscribe()
    await Promise.race([Promise.all([supabase.auth.signOut(),peer.auth.signOut()]),new Promise(r=>setTimeout(r,5000))])
  }
},60000)
