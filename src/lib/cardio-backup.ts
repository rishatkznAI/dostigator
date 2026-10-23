import { getCardioConflicts, getCardioDeletes, getCardioQueue, loadCardio, validateCardio, type CardioSession } from './cardio'
import { supabase } from './supabase'
export type CardioBackup = {format:'dostigator-cardio';version:1;ownerId:string;exportedAt:string;records:CardioSession[]}
export async function exportCardioBackup(userId:string):Promise<CardioBackup> {
  if(getCardioQueue(userId).length||getCardioDeletes(userId).length||getCardioConflicts(userId).length) throw new Error('Сначала синхронизируй кардио и разреши конфликты. Локальные записи сохранены.')
  return {format:'dostigator-cardio',version:1,ownerId:userId,exportedAt:new Date().toISOString(),records:await loadCardio(userId,true)}
}
export function parseCardioBackup(value:unknown,userId:string):CardioBackup {
  const backup=value as CardioBackup
  if(!backup||backup.format!=='dostigator-cardio'||backup.version!==1||backup.ownerId!==userId||!Array.isArray(backup.records)||backup.records.length>10000) throw new Error('Нужна резервная копия кардио этого аккаунта')
  const ids=new Set<string>()
  for(const record of backup.records) {
    if(record.user_id!==userId||ids.has(record.id)||validateCardio(record)) throw new Error('В резервной копии есть некорректные или повторные записи')
    ids.add(record.id)
  }
  return backup
}
export async function restoreCardioBackup(backup:CardioBackup,userId:string,importId:string) {
  parseCardioBackup(backup,userId)
  if(getCardioQueue(userId).length||getCardioDeletes(userId).length||getCardioConflicts(userId).length) throw new Error('Сначала синхронизируй текущие изменения кардио')
  const {data,error}=await supabase.rpc('cardio_restore_facts',{p_import_id:importId,p_records:backup.records})
  if(error) throw new Error(['40001','PT409'].includes(error.code??'')?'Копия отличается от текущей истории. Восстановление кардио отменено целиком.':`Не удалось восстановить кардио: ${error.message}`)
  return data as {restored:number}
}
