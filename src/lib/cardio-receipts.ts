import { getCachedCardio, type CardioSession } from './cardio'

// A device-only receipt, versioned by the exact saved cardio revision.
// Retained for importing device receipts; canonical server fields take precedence.
export type CardioReceipt = { durationSeconds: number; workoutId: string | null; updatedAt: string }
const legacyKey = (owner: string, id: string, updatedAt: string) => `trainlog:cardio-receipt:${owner}:${id}:${updatedAt}`
const key = (owner: string, id: string, updatedAt: string) => legacyKey(owner,id,String(Date.parse(updatedAt)))
export function saveCardioReceipt(owner: string, session: CardioSession, receipt: CardioReceipt) {
 if (session.user_id !== owner || !Number.isFinite(Date.parse(session.updated_at)) || Date.parse(receipt.updatedAt) !== Date.parse(session.updated_at) || !Number.isInteger(receipt.durationSeconds) || receipt.durationSeconds < session.duration_minutes*60 || receipt.durationSeconds >= (session.duration_minutes+1)*60) throw new Error('Некорректное фактическое время кардио')
 localStorage.setItem(key(owner,session.id,session.updated_at),JSON.stringify(receipt))
}
export function loadCardioReceipt(owner: string, session: CardioSession): CardioReceipt | null {
 if (session.user_id !== owner) return null
 if (session.duration_seconds != null && Number.isInteger(session.duration_seconds) && session.duration_seconds > 0 && session.duration_seconds <= 86459 && Math.floor(session.duration_seconds/60) === session.duration_minutes) return {durationSeconds:session.duration_seconds,workoutId:session.workout_session_id ?? null,updatedAt:session.updated_at}
 if (session.revision) return null
 try {
  const value=JSON.parse(localStorage.getItem(key(owner,session.id,session.updated_at)) ?? localStorage.getItem(legacyKey(owner,session.id,session.updated_at)) ?? localStorage.getItem(legacyKey(owner,session.id,new Date(session.updated_at).toISOString())) ?? 'null')
  if (Date.parse(value?.updatedAt)===Date.parse(session.updated_at) && Number.isInteger(value.durationSeconds) && value.durationSeconds>=session.duration_minutes*60 && value.durationSeconds<(session.duration_minutes+1)*60 && (value.workoutId===null||typeof value.workoutId==='string')) return value
 } catch { /* metadata is optional; the saved cloud fact remains usable */ }
 return null
}
export function workoutCardio(owner: string, workoutId: string) {
 return getCachedCardio(owner).flatMap(session=>{
  const receipt=loadCardioReceipt(owner,session)
  return receipt?.workoutId===workoutId ? [{session,receipt}] : []
 })
}
