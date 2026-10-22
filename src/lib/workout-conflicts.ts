import type { WorkoutDraft } from '../types/training'
import { getActiveDraft,getSyncQueue } from './storage'
export const WORKOUT_CONFLICT_EVENT='dostigator:workout-conflict'
export type WorkoutConflict={id:string;local:WorkoutDraft;remote:{session:{id:string;revision:number;updated_at:string;finished_at:string|null;title:string}|null;exercises:Array<{id:string;exercise_name:string}>;sets:Array<{session_exercise_id:string;weight_kg:number|null;reps:number|null;rir:number|null;done:boolean;is_warmup:boolean}>}|null}
const key=(owner:string)=>`trainlog:workout-conflicts:${owner}`
export function getWorkoutConflicts(owner:string):WorkoutConflict[] {try{const values=JSON.parse(localStorage.getItem(key(owner))??'[]');return Array.isArray(values)?values:[]}catch{return []}}
function save(owner:string,values:WorkoutConflict[]) {localStorage.setItem(key(owner),JSON.stringify(values));window.dispatchEvent(new CustomEvent(WORKOUT_CONFLICT_EVENT,{detail:{userId:owner}}))}
export function storeWorkoutConflict(draft:WorkoutDraft,details?:string) {
  let remote:WorkoutConflict['remote']=null
  try{const value=JSON.parse(details??'null');if(value?.session?.id===draft.id)remote=value}catch{/* retain local input even if the server cannot return a comparison */}
  save(draft.userId,[...getWorkoutConflicts(draft.userId).filter(r=>r.id!==draft.id),{id:draft.id,local:draft,remote}])
}
export function clearWorkoutConflict(owner:string,id:string) {
  const conflict=getWorkoutConflicts(owner).find(r=>r.id===id)
  if(conflict)localStorage.setItem(`trainlog:workout-conflict-archive:${owner}:${id}`,JSON.stringify(conflict))
  save(owner,getWorkoutConflicts(owner).filter(r=>r.id!==id))
}
export function rebaseWorkoutConflict(owner:string,id:string) {
  const conflict=getWorkoutConflicts(owner).find(r=>r.id===id)
  if(!conflict?.remote?.session||conflict.remote.session.finished_at)throw new Error('Завершённую или недоступную серверную тренировку нельзя перезаписать')
  assertWorkoutConflictCurrent(owner,id)
  const cloudKey=`trainlog:workout-cloud:${owner}:${id}`,state=JSON.parse(localStorage.getItem(cloudKey)??'{}')
  if(!state.request)throw new Error('Локальная операция недоступна. Ввод сохранён для выгрузки.')
  localStorage.setItem(cloudKey,JSON.stringify({revision:conflict.remote.session.revision,legacyUpdatedAt:conflict.remote.session.updated_at}))
  return conflict.local
}
export function assertWorkoutConflictCurrent(owner:string,id:string) {
  const conflict=getWorkoutConflicts(owner).find(r=>r.id===id)
  const active=getActiveDraft(owner),queued=getSyncQueue(owner).find(r=>r.id===id)
  if(!conflict || (active?.id===id&&active.updatedAt!==conflict.local.updatedAt) || (queued&&queued.updatedAt!==conflict.local.updatedAt))
    throw new Error('Появился новый локальный ввод. Дождись обновления сравнения перед выбором.')
}
