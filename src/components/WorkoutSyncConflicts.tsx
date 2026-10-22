import { useEffect,useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { assertWorkoutConflictCurrent,clearWorkoutConflict,getWorkoutConflicts,rebaseWorkoutConflict,WORKOUT_CONFLICT_EVENT } from '../lib/workout-conflicts'
import { syncWorkoutDraft } from '../lib/trainingRepository'
import { createWorkoutSyncQueue } from '../lib/workout-sync'
import { clearActiveDraft,getActiveDraft,removeQueuedDraft } from '../lib/storage'
export function WorkoutSyncConflicts({userId}:{userId?:string}) {
  const [values,setValues]=useState(()=>userId?getWorkoutConflicts(userId):[]),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
  const navigate=useNavigate()
  useEffect(()=>{const refresh=()=>setValues(userId?getWorkoutConflicts(userId):[]);refresh();window.addEventListener(WORKOUT_CONFLICT_EVENT,refresh);return()=>window.removeEventListener(WORKOUT_CONFLICT_EVENT,refresh)},[userId])
  if(!userId)return null
  return <>{values.map(conflict=><section className="error-card" key={conflict.id} aria-label="Конфликт силовой тренировки"><h2>Сравни версии тренировки</h2><p>Твой ввод сохранён на устройстве. Серверная версия изменилась.</p><details><summary>Моя версия · {conflict.local.title}</summary>{conflict.local.exercises.map(ex=><div key={ex.id}><strong>{ex.exercise.name}</strong>{ex.sets.filter(s=>s.done).map(s=><p key={s.id}>{s.weightKg??'—'} кг × {s.reps??'—'} · RIR {s.rir??'не оценён'}</p>)}</div>)}</details>{conflict.remote?.session&&<details><summary>Серверная версия · {conflict.remote.session.finished_at?'завершена':'активна'}</summary>{conflict.remote.exercises.map(ex=><div key={ex.id}><strong>{ex.exercise_name}</strong>{conflict.remote!.sets.filter(s=>s.done&&s.session_exercise_id===ex.id).map((s,i)=><p key={i}>{s.weight_kg??'—'} кг × {s.reps??'—'} · RIR {s.rir??'не оценён'}</p>)}</div>)}</details>}<button type="button" className="training-secondary" onClick={()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(conflict,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`dostigator-workout-conflict-${conflict.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }}>Скачать мой ввод и сравнение</button>{conflict.remote?.session && !conflict.remote.session.finished_at && <button type="button" className="training-secondary" disabled={busy} onClick={()=>{
    if(busy)return;setBusy(true);setMessage('');void(async()=>{try{const draft=rebaseWorkoutConflict(userId,conflict.id);await createWorkoutSyncQueue(syncWorkoutDraft).enqueue(draft);removeQueuedDraft(userId,draft.id,draft.updatedAt);clearWorkoutConflict(userId,draft.id);setMessage('Сервер подтвердил выбранную версию')}catch(reason){setMessage(reason instanceof Error?reason.message:'Не удалось сохранить выбранную версию')}finally{setBusy(false)}})()
  }}>Сохранить мою версию вместо показанной</button>}{conflict.remote?.session&&<button type="button" className="training-secondary" disabled={busy} onClick={()=>{
    try{assertWorkoutConflictCurrent(userId,conflict.id);clearWorkoutConflict(userId,conflict.id);removeQueuedDraft(userId,conflict.id,conflict.local.updatedAt);if(getActiveDraft(userId)?.id===conflict.id)clearActiveDraft(userId);navigate('/training/history')}catch(reason){setMessage(reason instanceof Error?reason.message:'Ввод изменился')}
  }}>Оставить серверную версию</button>}</section>)}{message&&<p role="status">{message}</p>}</>
}
