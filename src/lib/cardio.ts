import type { TableRow } from '../types/trainingDatabase'
import { supabase } from './supabase'
import { localDate } from './date'
import { loadCardioReceipt } from './cardio-receipts'
import { loadCardioDetails } from './cardio-details'

export type CardioSession = TableRow<'cardio_sessions'> & {
  duration_seconds?: number | null; workout_session_id?: string | null
  speed_kmh?: number | null; incline_percent?: number | null; resistance_level?: number | null
  revision?: number; deleted_at?: string | null
  mutation_id?: string; legacy_updated_at?: string | null
  cloud_payload?: Record<string,unknown>
}
export const CARDIO_CHANGED_EVENT = 'dostigator:cardio-changed'
export const cardioKinds: Record<CardioSession['kind'], string> = {
  walk: 'Дорожка', bike: 'Велотренажёр', elliptical: 'Эллипс', outdoor: 'Быстрая прогулка', other: 'Другое кардио',
}
const cacheKey = (id: string) => `trainlog:cardio:${id}`
const queueKey = (id: string) => `trainlog:cardio-queue:${id}`
const deleteKey = (id: string) => `trainlog:cardio-delete:${id}`
const deleteMetaKey = (id: string) => `trainlog:cardio-delete-mutations:${id}`
const conflictKey = (id: string) => `trainlog:cardio-conflicts:${id}`
function read<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback } catch { return fallback } }
function records(key: string): CardioSession[] { const value=read<unknown>(key,[]); return Array.isArray(value)?value:[] }
function notify(userId: string) { window.dispatchEvent(new CustomEvent(CARDIO_CHANGED_EVENT,{detail:{userId}})) }
export const getCardioQueue = (id: string) => records(queueKey(id)).filter(r=>r.user_id===id)
export const getCardioDeletes = (id: string): string[] => { const v=read<unknown>(deleteKey(id),[]); return Array.isArray(v)?v.filter(x=>typeof x==='string'):[] }
export const getCachedCardio = (id: string) => mergeCardio(records(cacheKey(id)).filter(r=>r.user_id===id),getCardioQueue(id)).filter(r=>!r.deleted_at&&!getCardioDeletes(id).includes(r.id))
export function mergeCardio(remote: CardioSession[], pending: CardioSession[]) {
  const values=new Map(remote.map(r=>[r.id,r])); for(const row of pending) values.set(row.id,row)
  return [...values.values()].sort((a,b)=>b.activity_date.localeCompare(a.activity_date)||b.created_at.localeCompare(a.created_at))
}
export function cardioDuration(session: CardioSession): string {
  return session.duration_seconds == null ? `${session.duration_minutes} мин` : `${Math.floor(session.duration_seconds/60)} мин ${session.duration_seconds%60} сек`
}
export function validateCardio(session: CardioSession): string | null {
  const date=new Date(`${session.activity_date}T12:00:00`)
  if(!/^\d{4}-\d{2}-\d{2}$/.test(session.activity_date)||Number.isNaN(date.getTime())||localDate(date)!==session.activity_date||session.activity_date>localDate()) return 'Укажи корректную дату кардио не позже сегодняшней'
  if(!(session.kind in cardioKinds)) return 'Выбери вид кардио'
  if(session.duration_seconds!=null) {
    if(!Number.isInteger(session.duration_seconds)||session.duration_seconds<1||session.duration_seconds>86459||session.duration_minutes!==Math.floor(session.duration_seconds/60)) return 'Время: от 1 секунды до 1440 минут 59 секунд'
  } else if(!Number.isInteger(session.duration_minutes)||session.duration_minutes<1||session.duration_minutes>1440) return 'Время: целое число от 1 до 1440 минут'
  if(session.distance_km!==null&&(!Number.isFinite(session.distance_km)||session.distance_km<=0||session.distance_km>1000||Math.abs(session.distance_km*100-Math.round(session.distance_km*100))>0.000001)) return 'Дистанция: от 0,01 до 1000 км, до двух знаков после запятой'
  if(session.effort!==null&&(!Number.isInteger(session.effort)||session.effort<1||session.effort>10)) return 'Усилие: целое число от 1 до 10'
  if(session.average_pulse!==null&&(!Number.isInteger(session.average_pulse)||session.average_pulse<30||session.average_pulse>250)) return 'Пульс: целое число от 30 до 250'
  const metrics: Array<[number|null|undefined,number,number]>=[[session.speed_kmh,0.1,50],[session.incline_percent,-20,40],[session.resistance_level,0,100]]
  for(const [value,min,max] of metrics) if(value!=null&&(!Number.isFinite(value)||value<min||value>max)) return 'Проверь скорость, уклон и сопротивление'
  return typeof session.note!=='string'||session.note.length>4000?'Заметка: не больше 4000 символов':null
}
export function enqueueCardio(session: CardioSession) {
  if(getCardioDeletes(session.user_id).includes(session.id)) throw new Error('Запись ожидает удаления. Создай новую тренировку.')
  const error=validateCardio(session); if(error) throw new Error(error)
  const existing=getCachedCardio(session.user_id).find(r=>r.id===session.id)
  const row={...session,cloud_payload:undefined,revision:session.revision??existing?.revision??0,mutation_id:crypto.randomUUID(),
    legacy_updated_at:session.legacy_updated_at??existing?.legacy_updated_at??((existing?.revision??0)===0?existing?.updated_at:null)}
  localStorage.setItem(queueKey(session.user_id),JSON.stringify([...getCardioQueue(session.user_id).filter(r=>r.id!==session.id),row])); notify(session.user_id)
}
type DeleteMutation = { mutation_id: string; revision: number; legacy_updated_at: string | null; record?: ReturnType<typeof cardioCloudPayload> }
export function deleteCardio(userId: string,id: string) {
  const row=getCachedCardio(userId).find(r=>r.id===id)
  const meta=read<Record<string,DeleteMutation>>(deleteMetaKey(userId),{})
  meta[id]??={mutation_id:crypto.randomUUID(),revision:row?.revision??0,legacy_updated_at:row?.legacy_updated_at??row?.updated_at??null,record:row?cardioCloudPayload(row):undefined}
  localStorage.setItem(deleteMetaKey(userId),JSON.stringify(meta))
  localStorage.setItem(deleteKey(userId),JSON.stringify([...new Set([...getCardioDeletes(userId),id])]))
  localStorage.setItem(queueKey(userId),JSON.stringify(getCardioQueue(userId).filter(r=>r.id!==id))); notify(userId)
}
export async function loadCardio(userId: string,includeDeleted=false) {
  const atStart=records(cacheKey(userId))
  const result=await supabase.rpc('cardio_list_facts',{p_include_deleted:includeDeleted})
  if(result.error) throw new Error(`Не удалось загрузить кардио: ${result.error.message}`)
  let rows=(result.data??[]) as unknown as CardioSession[]
  if(!Array.isArray(rows)||rows.some(r=>r.user_id!==userId)) throw new Error('Получена некорректная история кардио')
  // A read started before our acknowledged write must not roll the cache back.
  const changed=records(cacheKey(userId)).filter(row=>row.user_id===userId && row.revision && JSON.stringify(row)!==JSON.stringify(atStart.find(old=>old.id===row.id))
    && row.revision>(rows.find(remote=>remote.id===row.id)?.revision??0))
  rows=mergeCardio(rows,changed)
  localStorage.setItem(cacheKey(userId),JSON.stringify(rows))
  if(!includeDeleted) for(const row of rows) {
    const receipt=loadCardioReceipt(userId,row)
    if(!row.revision && receipt && !getCardioQueue(userId).some(r=>r.id===row.id) && !getCardioDeletes(userId).includes(row.id))
      enqueueCardio({...row,duration_seconds:receipt.durationSeconds,workout_session_id:receipt.workoutId,legacy_updated_at:row.updated_at})
  }
  return includeDeleted?rows:getCachedCardio(userId)
}
export function cardioCloudPayload(session: CardioSession) {
  const receipt=loadCardioReceipt(session.user_id,session), details=loadCardioDetails(session.user_id,session.id)
  const numeric=(value:string)=>value.trim()?Number(value):null
  return {activity_date:session.activity_date,kind:session.kind,duration_minutes:session.duration_minutes,
    duration_seconds:session.duration_seconds??receipt?.durationSeconds??null,
    workout_session_id:session.workout_session_id!==undefined?session.workout_session_id:receipt?.workoutId??null,
    distance_km:session.distance_km,effort:session.effort,average_pulse:session.average_pulse,note:session.note,
    speed_kmh:session.speed_kmh!==undefined?session.speed_kmh:numeric(details.speed),incline_percent:session.incline_percent!==undefined?session.incline_percent:numeric(details.incline),
    resistance_level:session.resistance_level!==undefined?session.resistance_level:numeric(details.resistance),legacy_updated_at:session.legacy_updated_at??null}
}
export type CardioConflict = {id:string;local:CardioSession|null;remote:CardioSession|null;deleting:boolean}
export const getCardioConflicts = (userId:string):CardioConflict[]=>read(conflictKey(userId),[])
export function resolveCardioConflict(userId:string,id:string,choice:'local'|'server'|'copy') {
  const conflicts=getCardioConflicts(userId), conflict=conflicts.find(r=>r.id===id)
  if(!conflict)return
  if(choice==='local'&&(!conflict.remote||conflict.remote.deleted_at)) throw new Error('Запись удалена на сервере. Сохрани локальный результат как новое кардио.')
  if(choice==='copy' && !conflict.local?.duration_seconds) throw new Error('Для новой записи сначала уточни точное время')
  localStorage.setItem(queueKey(userId),JSON.stringify(getCardioQueue(userId).filter(r=>r.id!==id)))
  localStorage.setItem(deleteKey(userId),JSON.stringify(getCardioDeletes(userId).filter(x=>x!==id)))
  const meta=read<Record<string,DeleteMutation>>(deleteMetaKey(userId),{}); delete meta[id];localStorage.setItem(deleteMetaKey(userId),JSON.stringify(meta))
  if(conflict.remote) localStorage.setItem(cacheKey(userId),JSON.stringify(mergeCardio(records(cacheKey(userId)),[conflict.remote])))
  if(choice==='local') {
    if(conflict.deleting) deleteCardio(userId,id)
    else if(conflict.local) enqueueCardio({...conflict.local,revision:conflict.remote!.revision,legacy_updated_at:conflict.remote!.updated_at,updated_at:new Date().toISOString()})
  }
  if(choice==='copy' && conflict.local) enqueueCardio({...conflict.local,id:crypto.randomUUID(),revision:0,legacy_updated_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()})
  localStorage.setItem(`trainlog:cardio-conflict-archive:${userId}:${id}`,JSON.stringify(conflict))
  localStorage.setItem(conflictKey(userId),JSON.stringify(conflicts.filter(r=>r.id!==id))); notify(userId)
}
const runningSync=new Map<string,Promise<void>>()
export function syncCardio(userId:string):Promise<void> {
  const running=runningSync.get(userId); if(running)return running
  const run=async()=>{
    while(navigator.onLine) {
      const deleting=getCardioDeletes(userId)[0], session=deleting?undefined:getCardioQueue(userId)[0]
      if(!deleting&&!session)return
      const id=deleting??session!.id
      if(getCardioConflicts(userId).some(r=>r.id===id)) throw new Error('Конфликт кардио: сравни локальную и серверную версии')
      let meta=read<Record<string,DeleteMutation>>(deleteMetaKey(userId),{})
      if(deleting&&!meta[id]) { meta[id]={mutation_id:crypto.randomUUID(),revision:0,legacy_updated_at:null}; localStorage.setItem(deleteMetaKey(userId),JSON.stringify(meta)) }
      if(session&&!session.mutation_id) {
        session.mutation_id=crypto.randomUUID()
        localStorage.setItem(queueKey(userId),JSON.stringify(getCardioQueue(userId).map(r=>r.id===id?session:r)))
      }
      const payload=session?(session.cloud_payload??cardioCloudPayload(session)):{...meta[id].record,legacy_updated_at:meta[id].legacy_updated_at}
      if(session&&!session.cloud_payload) {
        session.cloud_payload=payload
        localStorage.setItem(queueKey(userId),JSON.stringify(getCardioQueue(userId).map(r=>r.mutation_id===session.mutation_id?session:r)))
      }
      if(session) {
        const record=payload as ReturnType<typeof cardioCloudPayload>
        const error=validateCardio({...session,...record});if(error)throw new Error(error)
        if(record.workout_session_id) {
          const {getSyncQueue,getActiveDraft}=await import('./storage')
          const parent=getSyncQueue(userId).find(r=>r.id===record.workout_session_id)??getActiveDraft(userId)
          if(parent?.id===record.workout_session_id) {
            const {syncWorkoutDraft}=await import('./trainingRepository')
            const {createWorkoutSyncQueue}=await import('./workout-sync')
            await createWorkoutSyncQueue(syncWorkoutDraft).enqueue(parent)
          }
        }
      }
      const {data,error}=await supabase.rpc('cardio_apply_fact',{p_id:id,p_mutation_id:session?.mutation_id??meta[id].mutation_id,
        p_expected_revision:session?.revision??meta[id]?.revision??0,p_record:payload,p_delete:Boolean(deleting),p_expected_owner:userId})
      if(error) {
        if(['40001','PT409'].includes(error.code??'')) {
          let remote:CardioSession|null=null
          try { const parsed=JSON.parse(error.details??'null'); if(parsed?.id===id)remote=parsed }catch{/* fetch below */}
          if(!remote) { const result=await supabase.rpc('cardio_list_facts',{p_include_deleted:true}); if(result.error)throw new Error('Не удалось прочитать конфликтующую версию. Локальная запись сохранена.'); remote=((result.data??[]) as unknown as CardioSession[]).find(r=>r.id===id)??null }
          const conflict:CardioConflict={id,local:session??null,remote,deleting:Boolean(deleting)}
          localStorage.setItem(conflictKey(userId),JSON.stringify([...getCardioConflicts(userId).filter(r=>r.id!==id),conflict]));notify(userId)
        }
        const message=error.code==='PGRST202'||error.code==='42883'?'Сервер ещё не поддерживает точное кардио. Результат остаётся на устройстве.':error.message
        throw new Error(`Не удалось синхронизировать кардио: ${message}`)
      }
      const confirmed=data as unknown as CardioSession
      if(!confirmed||confirmed.id!==id||confirmed.user_id!==userId||!confirmed.revision) throw new Error('Сервер не подтвердил кардио')
      if(session && Object.entries(payload).some(([key,value])=>key!=='legacy_updated_at' && confirmed[key as keyof CardioSession]!==value)) throw new Error('Сервер не подтвердил точное содержимое кардио')
      if(deleting && !confirmed.deleted_at) throw new Error('Сервер не подтвердил удаление кардио')
      localStorage.setItem(cacheKey(userId),JSON.stringify(mergeCardio(records(cacheKey(userId)),[confirmed])))
      if(deleting) {
        localStorage.setItem(deleteKey(userId),JSON.stringify(getCardioDeletes(userId).filter(x=>x!==id)))
        delete meta[id];localStorage.setItem(deleteMetaKey(userId),JSON.stringify(meta))
      } else {
        const queue=getCardioQueue(userId).flatMap(r=>r.id!==id?[r]:r.mutation_id===session!.mutation_id?[]:[{...r,revision:confirmed.revision}])
        localStorage.setItem(queueKey(userId),JSON.stringify(queue))
        meta=read(deleteMetaKey(userId),{})
        if(meta[id]) { meta[id].revision=confirmed.revision!;localStorage.setItem(deleteMetaKey(userId),JSON.stringify(meta)) }
      }
      notify(userId)
    }
  }
  const promise=run().finally(()=>runningSync.delete(userId));runningSync.set(userId,promise);return promise
}
