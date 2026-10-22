import { beforeEach, expect, it, vi } from 'vitest'
import { programV21Templates, programV21Exercises } from '../src/lib/program-v21'
import { createWorkoutDraft, getNextMandatoryWorkout } from '../src/lib/workout'
import { getActiveDraft, saveActiveDraft, enqueueDraft, getSyncQueue } from '../src/lib/storage'
import { selectPreviousResults, getWorkoutTargets } from '../src/lib/workout-targets'
import { draftToHistory, mergeTrainingHistory } from '../src/lib/training-insights'
import { summarizeWeek, getWeekRange } from '../src/lib/week'
import { getExerciseMedia } from '../src/lib/exercise-media'
import { fixtureHistory, template as oldTemplate } from './local-browser/fixtures'

beforeEach(()=>localStorage.clear())
it.each([undefined, 'false', 'true'])('ships V2.1 in the real repository regardless of the former local flag (%s)',async(flag)=>{
  vi.stubEnv('VITE_LOCAL_PROGRAM_V21',flag)
  vi.resetModules()
  try {
    const repo=await import('../src/lib/trainingRepository')
    localStorage.setItem('trainlog:templates:v1',JSON.stringify([oldTemplate]))
    const templates=await repo.loadTemplates()
    expect(templates.map(t=>t.items.reduce((n,i)=>n+i.setCount,0))).toEqual([15,15,6])
    expect(templates.every(t=>t.programRevision==='v2.1-2026-10-22')).toBe(true)
    templates[0].items.length=0
    expect((await repo.loadTemplates())[0].items).toHaveLength(6)
    expect((await repo.loadExerciseLibrary()).some(e=>e.key==='pallof_press')).toBe(true)
    expect(JSON.parse(localStorage.getItem('trainlog:templates:v1')!)).toEqual([oldTemplate])
  } finally { vi.unstubAllEnvs() }
})
it('has exactly the requested V2.1 exercises, unique stable keys and no excluded lifts',()=>{
  expect(programV21Templates.map(t=>t.code)).toEqual(['A','B','C'])
  expect(programV21Templates[0].items.map(i=>i.exercise.key)).toEqual(['leg_press','chest_press','lat_pulldown','leg_curl','lateral_raise','pallof_press'])
  expect(programV21Templates[1].items.map(i=>i.exercise.key)).toEqual(['incline_db_press','seated_row','leg_press','leg_curl','lateral_raise','cable_hip_extension'])
  expect(programV21Templates[2].items.map(i=>i.exercise.key)).toEqual(['biceps_curl','triceps_pushdown','calf_raise'])
  expect(new Set(programV21Exercises.map(e=>e.key)).size).toBe(programV21Exercises.length)
  expect(programV21Exercises.some(e=>/rdl|bridge|hip_thrust/.test(e.key))).toBe(false)
  for(const e of programV21Exercises) {expect(e.steps.length).toBeGreaterThan(2);expect(e.mistakes.length).toBeGreaterThan(1);expect(getExerciseMedia(e.key,e.name)).not.toBeNull()}
})
it('preserves the exact legacy draft and history while creating new snapshots with V2.1 rest and rep ranges',()=>{
  const history=JSON.stringify(fixtureHistory)
  const old=createWorkoutDraft(oldTemplate,'owner');saveActiveDraft(old)
  const raw=localStorage.getItem('trainlog:active:owner')
  expect(programV21Templates[0].items).toHaveLength(6)
  expect(getActiveDraft('owner')).toEqual(old)
  expect(localStorage.getItem('trainlog:active:owner')).toBe(raw)
  expect(JSON.stringify(fixtureHistory)).toBe(history)
  for(const t of programV21Templates.slice(0,2)) {
    const draft=createWorkoutDraft(t,'new-owner');saveActiveDraft(draft)
    expect(getActiveDraft('new-owner')).toEqual(draft)
    expect(draft.exercises.map(e=>e.sets.length)).toEqual([3,3,3,2,2,2])
    expect(draft.exercises.map(e=>e.restSeconds)).toEqual([120,120,120,90,90,90])
    expect(draft.title).toContain('V2.1')
  }
})
it('matches only identical exercise keys; changed ranges and missing RIR cannot trigger weight increase',()=>{
  const prev=selectPreviousResults(fixtureHistory,programV21Exercises.map(e=>e.key),'2026-10-22T12:00:00Z')
  expect(prev.has('chest_press')).toBe(true);expect(prev.has('pallof_press')).toBe(false);expect(prev.has('cable_hip_extension')).toBe(false)
  const last=prev.get('chest_press')!
  expect(getWorkoutTargets('8–12',3,last,false,{weightStep:1}).mode).not.toBe('increase')
  expect(getWorkoutTargets('10–12',3,last,false,{weightStep:1}).mode).toBe('repeat')
})
it('completes A/B with 30 nullable-RIR facts, recovers the queue without duplicate sessions and counts A+B as the weekly goal',()=>{
  const now=new Date('2026-10-22T12:00:00Z')
  const history=programV21Templates.slice(0,2).map(t=>{
    const draft=createWorkoutDraft(t,'owner',now)
    draft.finishedAt='2026-10-22T13:00:00Z'
    draft.exercises.forEach(e=>e.sets.forEach(s=>Object.assign(s,{weightKg:10,reps:Number(e.target.match(/\d+/)![0]),rir:null,done:true,completedAt:draft.finishedAt})))
    enqueueDraft(draft);enqueueDraft(draft)
    return draftToHistory(draft)
  })
  expect(getSyncQueue('owner')).toHaveLength(2)
  expect(mergeTrainingHistory(history,getSyncQueue('owner'))).toHaveLength(2)
  expect(history.flatMap(h=>h.exercises).flatMap(e=>e.sets)).toHaveLength(30)
  const report={...getWeekRange(now),nutrition:[],activity:[],measurements:[],workouts:history.map(h=>({...h,durationMinutes:75,sets:15,volume:1000,averageRir:null}))}
  const ab=summarizeWeek(report)
  const c={...report.workouts[0],id:'C',templateCode:'C'}
  expect(summarizeWeek({...report,workouts:[...report.workouts,c]}).score).toBe(ab.score)
  expect(ab.completedA&&ab.completedB).toBe(true)
  expect(getNextMandatoryWorkout([{...history[0],templateCode:'C'},...history])).toBe(getNextMandatoryWorkout(history))
})
