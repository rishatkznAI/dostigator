import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { prepareLocalSessionDraft } from './local-integration.mjs'
import { derivePlan } from './model.mjs'
const program = JSON.parse(await readFile(new URL('./program.json', import.meta.url)))

test('review snapshot keeps facts empty, preserves source, and cannot activate or mutate',()=>{
 const before=JSON.stringify(program), draft=prepareLocalSessionDraft(program,'B')
 assert.equal(draft.activeProgramAssignment,null);assert.equal(draft.activation,null)
 assert.deepEqual(draft.writes,[]);assert.deepEqual(draft.actualStrengthSets,[]);assert.equal(draft.actualCardio,null)
 assert.equal(draft.planSnapshot.cardio.parentSlot,'B');assert.equal(draft.planSnapshot.cardio.plannedMinutesForPreview,20)
 assert.equal(draft.planSnapshot.programRevisionId,program.revisionId)
 assert.equal(draft.planSnapshot.items[4].exerciseKey,'lateral_raise')
 assert.equal(draft.planSnapshot.pendingSubstitutions,undefined)
 assert.deepEqual(draft.pendingSubstitutionIds,[])
 assert.equal(JSON.stringify(program),before)
 assert.throws(()=>{draft.planSnapshot.items[0].workingSets=99},TypeError)
 assert.throws(()=>{draft.actualStrengthSets.push({weightKg:100})},TypeError)
 const changed=structuredClone(program);const detached=prepareLocalSessionDraft(changed,'A');changed.sessions[0].items[0].workingSets=1
 assert.equal(detached.planSnapshot.items[0].workingSets,3)
})
test('75 minute preparation gate keeps 20 minutes cardio and accepts reduced review when full volume exceeds',()=>{
 for (const slot of ['A','B']) {
  assert.throws(()=>prepareLocalSessionDraft(program,slot,{workSetSeconds:90}),/75/)
  const draft=prepareLocalSessionDraft(program,slot,{workSetSeconds:90,reduced:true})
  assert.equal(draft.budget.fits,true);assert.equal(draft.planSnapshot.cardio.plannedMinutesForPreview,20)
 }
})
test('removed substitutions cannot be restored via flags, metadata, or swapped exercises',()=>{
 assert.throws(()=>derivePlan(program,'B',{substitutionId:'removed-option'}),/согласования/)
 assert.throws(()=>prepareLocalSessionDraft(program,'B',{substitutionId:'removed-option'}))
 const changed=structuredClone(program);changed.pendingSubstitutions.push({id:'removed-option',enabled:false,status:'pending-user-agreement',automatic:false})
 assert.throws(()=>prepareLocalSessionDraft(changed,'B'),/согласования/)
 const swapped=structuredClone(program);swapped.sessions[1].items[4]={...swapped.sessions[1].items[4],exerciseKey:'glute_bridge'}
 assert.throws(()=>derivePlan(swapped,'B'),/согласования/)
})
test('RDL and new heavy axial exercises are rejected even when injected into proposal JSON',()=>{
 for (const exerciseKey of ['rdl','barbell_squat','good_morning','unknown-new-exercise']) {
  const changed=structuredClone(program);changed.sessions[1].items.push({...changed.sessions[1].items[0],exerciseKey})
  assert.throws(()=>prepareLocalSessionDraft(changed,'B'),/согласования/)
 }
 const optional=structuredClone(program);optional.sessions[2].optionalItems[0].variants.push({exerciseKey:'barbell_squat'})
 assert.throws(()=>derivePlan(optional,'C',{equipmentOkay:true,noDiscomfort:true,optionalSelections:{biceps:'barbell_squat'}}))
})
test('activated state and repository/history injection are rejected; legacy facts remain separate',()=>{
 for(const options of [{activate:true},{history:[{id:'synthetic-legacy'}]},{repository:{}},{syncQueue:[]}]) assert.throws(()=>prepareLocalSessionDraft(program,'A',options))
 const changed=structuredClone(program);changed.active=true
 assert.throws(()=>prepareLocalSessionDraft(changed,'A'))
 // Synthetic legacy fixture; this module has no history input or writer.
 const legacy={id:'synthetic-only',programRevisionId:'v1',sets:[{weightKg:80,reps:8}],cardioMinutes:25}
 const bytes=JSON.stringify(legacy);prepareLocalSessionDraft(program,'A');prepareLocalSessionDraft(program,'B')
 assert.equal(JSON.stringify(legacy),bytes)
})
test('review revision has distinct day/cardio IDs; previous proposal remains archived without rewriting',async()=>{
 const prior=JSON.parse(await readFile(new URL('./revisions/v2-proposal-2026-10-15-r2.json',import.meta.url)))
 assert.equal(program.supersedesRevisionId,prior.revisionId);assert.notEqual(program.revisionId,prior.revisionId)
 for(const session of program.sessions) {
  const old=prior.sessions.find(x=>x.slot===session.slot)
  assert.notEqual(session.id,old.id);assert.notEqual(session.cardio.blockId,old.cardio.blockId)
 }
 assert.equal(program.clarification.currentDiscomfort,false)
 assert.deepEqual(program.pendingSubstitutions,[])
 assert.equal(derivePlan(program,'B').items[4].exerciseKey,'lateral_raise')
})

test('review cardio choice and budget assumptions survive JSON export without becoming facts or an assigned activity',()=>{
 const draft=prepareLocalSessionDraft(program,'B',{cardioActivityForReview:'elliptical',workSetSeconds:45})
 const restored=JSON.parse(JSON.stringify(draft))
 assert.equal(restored.reviewSelections.cardioActivityKind,'elliptical')
 assert.equal(restored.planSnapshot.cardio.activityKind,null);assert.equal(restored.actualCardio,null)
 assert.equal(restored.budgetAssumptions.workSetSeconds,45)
 assert.throws(()=>prepareLocalSessionDraft(program,'B',{cardioActivityForReview:'unknown'}))
})
