import { useState } from 'react'
import { exportCardioBackup, parseCardioBackup, restoreCardioBackup, type CardioBackup as Backup } from '../lib/cardio-backup'
export function CardioBackup({userId,onRestore}:{userId:string;onRestore:()=>Promise<void>}) {
  const [candidate,setCandidate]=useState<{backup:Backup;mutation:string}|null>(null)
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('')
  const run=async(task:()=>Promise<void>)=>{if(busy)return;setBusy(true);setMessage('');try{await task()}catch(reason){setMessage(reason instanceof Error?reason.message:'Не удалось обработать копию кардио')}finally{setBusy(false)}}
  return <details className="training-extras"><summary>Резервная копия кардио</summary><p>Копия содержит точное время, связь с силовой, настройки и отметки удаления. Фотографии в этот JSON не входят; синхронизированные фото хранятся в аккаунте отдельно. Для восстановления связанная силовая должна уже существовать в аккаунте. Отличающиеся серверные записи не перезаписываются.</p><button type="button" className="training-secondary" disabled={busy} onClick={()=>void run(async()=>{
    const backup=await exportCardioBackup(userId),url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}))
    const link=document.createElement('a');link.href=url;link.download=`dostigator-cardio-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    setMessage('Облачная копия кардио подготовлена')
  })}>Скачать копию кардио</button><label>Выбрать копию для восстановления<input type="file" accept="application/json,.json" disabled={busy} onChange={event=>{
    const file=event.target.files?.[0];if(!file)return
    void run(async()=>{if(file.size>10*1024*1024)throw new Error('Файл больше 10 МБ');setCandidate({backup:parseCardioBackup(JSON.parse(await file.text()),userId),mutation:crypto.randomUUID()})})
  }}/></label>{candidate&&<div><p>В копии {candidate.backup.records.length} записей. При конфликте ни одна запись кардио не изменится.</p><button type="button" className="training-secondary" disabled={busy} onClick={()=>void run(async()=>{
    const result=await restoreCardioBackup(candidate.backup,userId,candidate.mutation);setCandidate(null);await onRestore();setMessage(`Восстановлено записей кардио: ${result.restored}`)
  })}>Восстановить кардио</button><button type="button" className="text-button" disabled={busy} onClick={()=>setCandidate(null)}>Отмена</button></div>}{message&&<p role="status">{message}</p>}</details>
}
