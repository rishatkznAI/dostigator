import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { derivePlan, estimateBudget, comparableResult, selectComparableResults, proposeProgression } from './model.mjs'
const program = JSON.parse(await readFile(new URL('./program.json', import.meta.url)))
const context = { programRevisionId: program.revisionId, slot: 'A', exerciseKey: 'leg_press', equipmentId: 'test-machine-1', weightConvention: 'machine-scale', volumeMode: 'standard', repRange: [8,12], workingSets: 3, before: '2026-10-15T09:00:00Z' }
const result = (overrides = {}) => ({ ...context, id: 'synthetic-only', finishedAt:'2026-10-12T10:00:00Z', sessionStatus: 'completed', confirmed: true, discomfort: false, exerciseSkipped: false, sets: [1,2,3].map(() => ({ weightKg: 100, reps: 10, rir: null, done: true, isWarmup: false })), ...overrides })
test('A and B preserve the exact user exercise order, count, ranges and fixed cardio day links', () => {
 const A=derivePlan(program,'A'), B=derivePlan(program,'B')
 assert.deepEqual(A.items.map((x)=>x.exerciseKey),['leg_press','chest_press','lat_pulldown','leg_curl','lateral_raise','knee_raise'])
 assert.deepEqual(B.items.map((x)=>x.exerciseKey),['incline_db_press','seated_row','leg_press','leg_curl','lateral_raise','triceps_pushdown'])
 assert.deepEqual(A.items.map((x)=>x.workingSets),[3,3,3,2,2,2]);assert.deepEqual(B.items.map((x)=>x.workingSets),[3,3,3,2,2,2])
 assert.deepEqual(A.items.map((x)=>x.repRange),[[8,12],[8,12],[8,12],[10,15],[12,20],[10,15]])
 assert.deepEqual(B.items.map((x)=>x.repRange),[[8,12],[8,12],[10,12],[10,15],[12,20],[10,15]])
 for (const plan of [A,B]) { assert.equal(plan.cardio.plannedMinutesForPreview,20);assert.equal(plan.cardio.parentSlot,plan.slot);assert.equal(plan.timeLimitMinutes,75) }
})
test('all user rest ranges and preliminary loads are preserved; no personal weight or facts are assigned',()=>{
 const A=derivePlan(program,'A'),B=derivePlan(program,'B')
 assert.deepEqual(A.items.map(x=>x.restSeconds),[[120,150],[120,120],[120,120],[90,90],[60,90],[60,60]])
 assert.deepEqual(B.items.map(x=>x.restSeconds),[[120,120],[120,120],[120,150],[90,90],[60,90],[60,90]])
 assert.deepEqual(A.items.map(x=>x.preliminaryLoad.range),[[90,100],[40,45],[40,45],[30,36],[5,6],null])
 assert.deepEqual(B.items.map(x=>x.preliminaryLoad.range),[[10,12],[42.5,47.5],[90,100],[30,36],[5,6],[17.5,20]])
 for(const item of [...A.items,...B.items])assert.equal(item.prescribedWeightKg,null)
 assert.equal(A.cardio.actual,null);assert.equal(program.active,false);assert.equal(program.activation,null)
})
test('full 75 minute budget includes upper-bound rest, all work, warmup, transitions and 20 minutes cardio',()=>{
 const A=estimateBudget(program,derivePlan(program,'A')),B=estimateBudget(program,derivePlan(program,'B'))
 assert.equal(A.workingSets,15);assert.equal(A.restMinutes,17);assert.equal(A.totalMinutes,69);assert.equal(A.reserveMinutes,6)
 assert.equal(B.restMinutes,17.5);assert.equal(B.totalMinutes,69.5);assert.equal(B.reserveMinutes,5.5)
})
test('longer sets honestly exceed budget; voluntary reduced option fits without shortening rests/cardio',()=>{
 for(const slot of ['A','B']) { const full=derivePlan(program,slot), short=derivePlan(program,slot,{reduced:true}); assert.equal(estimateBudget(program,full,90).fits,false); assert.equal(estimateBudget(program,short,90).fits,true);assert.equal(estimateBudget(program,short).workingSets,12);assert.deepEqual(full.items.map(x=>x.restSeconds),short.items.map(x=>x.restSeconds));assert.equal(short.cardio.plannedMinutesForPreview,20) }
})
test('C is optional cardio only by default, and 30–45 minute selection stays in range',()=>{
 const plan=derivePlan(program,'C');assert.equal(plan.mandatory,false);assert.equal(plan.items.length,0);assert.equal(plan.cardio.plannedMinutesForPreview,30)
 assert.equal(derivePlan(program,'C',{cardioMinutes:45}).cardio.plannedMinutesForPreview,45)
 assert.throws(()=>derivePlan(program,'C',{cardioMinutes:60}))
})
test('C requires both condition confirmations AND a valid explicit exercise choice',()=>{
 const selected={optionalSelections:{biceps:'biceps_curl',calves:'calf_raise',abs:'cable_crunch'}}
 assert.equal(derivePlan(program,'C',selected).items.length,0)
 assert.equal(derivePlan(program,'C',{...selected,equipmentOkay:true}).items.length,0)
 const plan=derivePlan(program,'C',{...selected,equipmentOkay:true,noDiscomfort:true});assert.equal(plan.items.length,3);assert.equal(plan.items.reduce((n,x)=>n+x.workingSets,0),6)
 assert.equal(derivePlan(program,'C',{equipmentOkay:true,noDiscomfort:true,optionalSelections:{abs:'plank'}}).items.length,0)
})
test('changing or missing C cannot mutate A/B or the stored proposal; RDL stays excluded',()=>{
 const before=JSON.stringify(program), A=derivePlan(program,'A')
 derivePlan(program,'C',{equipmentOkay:true,noDiscomfort:true,optionalSelections:{biceps:'biceps_curl'}})
 assert.deepEqual(derivePlan(program,'A'),A);assert.equal(JSON.stringify(program),before)
 assert.equal([...derivePlan(program,'A').items,...derivePlan(program,'B').items,...derivePlan(program,'C').items].some(x=>x.exerciseKey==='rdl'),false)
})
test('a complete confirmed result with matching metadata is comparable and stays immutable',()=>{
 const fact=result(),before=structuredClone(fact);assert.equal(comparableResult(fact,context),true);assert.equal(selectComparableResults([fact],context).length,1);assert.deepEqual(fact,before)
})
for(const [name,override] of Object.entries({legacyVersion:{programRevisionId:'v1'},otherDay:{slot:'B'},otherRange:{repRange:[10,12]},otherEquipment:{equipmentId:'other'},otherWeightConvention:{weightConvention:'two-dumbbells-total'},otherVolume:{volumeMode:'reduced-preview'},draft:{sessionStatus:'draft'},unconfirmed:{confirmed:false},discomfort:{discomfort:true},skipped:{exerciseSkipped:true},future:{finishedAt:'2026-10-16T10:00:00Z'}}))test(`progression rejects ${name}`,()=>{assert.equal(comparableResult(result(override),context),false);assert.equal(proposeProgression([result(override)],context,2.5).mode,'baseline')})
test('missing metadata, incomplete sets, warmup-only records and null result weights are not confirmed comparable facts',()=>{
 for(const sets of [result().sets.slice(0,2),result().sets.map((x,i)=>({...x,done:i!==2})),result().sets.map(x=>({...x,isWarmup:true})),result().sets.map(x=>({...x,weightKg:null}))])assert.equal(comparableResult(result({sets}),context),false)
 assert.equal(comparableResult(result({equipmentId:undefined}),context),false)
})
test('only one optional repetition is proposed and facts are unchanged',()=>{
 const fact=result(),before=structuredClone(fact),recommendation=proposeProgression([fact],context)
 assert.equal(recommendation.mode,'reps');assert.deepEqual(recommendation.targets.map(x=>x.reps),[11,10,10]);assert.deepEqual(fact,before)
})
test('weight increase needs two top-range results and an explicit small equipment step',()=>{
 const last=result({sets:result().sets.map(x=>({...x,reps:12}))}),older={...structuredClone(last),id:'older-synthetic',finishedAt:'2026-10-09T10:00:00Z'}
 assert.equal(proposeProgression([last],context,2.5).mode,'repeat');assert.equal(proposeProgression([last,older],context).mode,'repeat');assert.equal(proposeProgression([last,older],context,50).mode,'repeat')
 const proposed=proposeProgression([last,older],context,2.5);assert.equal(proposed.mode,'weight');assert.ok(proposed.targets.every(x=>x.weightKg===102.5&&x.reps===8&&x.optional))
})
test('worse results, known low reserve, reduced volume and long breaks do not propose increases',()=>{
 const older=result({id:'older',finishedAt:'2026-10-09T10:00:00Z'}),last=result({sets:result().sets.map((x,i)=>({...x,reps:i===2?9:10}))})
 assert.equal(proposeProgression([older,last],context).mode,'repeat')
 assert.equal(proposeProgression([result({sets:result().sets.map(x=>({...x,rir:1}))})],context).mode,'repeat')
 assert.equal(proposeProgression([result({finishedAt:'2026-09-01T10:00:00Z'})],context).mode,'repeat')
 const reduced={...context,volumeMode:'reduced-preview'};assert.equal(proposeProgression([result({volumeMode:'reduced-preview'})],reduced).mode,'repeat')
})

test('unknown equipment is not made comparable by repeating the same placeholder',()=>{
 const unknown={...context,equipmentId:'unknown'};assert.equal(comparableResult(result({equipmentId:'unknown'}),unknown),false)
})
