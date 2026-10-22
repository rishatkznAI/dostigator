// Isolated gateway used by the local browser entry only. No network client exists here.
import type { CardioSession } from '../../src/lib/cardio'
export const supabase = {auth:{getUser:async()=>({data:{user:{id:'local-training-test'}},error:null}),getSession:async()=>({data:{session:{user:{id:'local-training-test'}}},error:null})},
  async rpc(name:string,args:Record<string,unknown>) {
    if(!navigator.onLine)return {data:null,error:{message:'Тест: офлайн'}}
    const owner='local-training-test'
    const rows: Array<Record<string,unknown>>=JSON.parse(localStorage.getItem('local-test:cardio')??'[]')
    const normalize=(row:Record<string,unknown>)=>({duration_seconds:null,workout_session_id:null,speed_kmh:null,incline_percent:null,resistance_level:null,revision:0,deleted_at:null,...row})
    if(name==='cardio_list_facts')return {data:rows.map(normalize).filter(r=>args.p_include_deleted||!r.deleted_at),error:null}
    if(name!=='cardio_apply_fact')return {data:null,error:{message:'Операция недоступна в локальном тесте'}}
    const receipts=JSON.parse(localStorage.getItem('local-test:cardio-mutations')??'{}')
    const prior=receipts[String(args.p_mutation_id)]
    if(prior)return JSON.stringify(prior.args)===JSON.stringify(args)?{data:prior.data,error:null}:{data:null,error:{code:'40001',message:'Повтор mutation с другим содержимым'}}
    const old=rows.find(r=>r.id===args.p_id)
    if(Number(old?.revision??0)!==args.p_expected_revision||old?.deleted_at)return {data:null,error:{code:'40001',message:'Кардио изменилось',details:JSON.stringify(old??null)}}
    const record={...old,...args.p_record as object,id:args.p_id,user_id:owner,revision:Number(old?.revision??0)+1,
      created_at:old?.created_at??new Date().toISOString(),updated_at:new Date().toISOString(),deleted_at:args.p_delete?new Date().toISOString():null}
    localStorage.setItem('local-test:cardio',JSON.stringify([...rows.filter(r=>r.id!==args.p_id),record]))
    receipts[String(args.p_mutation_id)]={args,data:record};localStorage.setItem('local-test:cardio-mutations',JSON.stringify(receipts))
    return {data:record,error:null}
  }, from(table: string) {
  if (table !== 'cardio_sessions') {
    const empty={select:()=>empty,is:()=>empty,upsert:()=>empty,eq:()=>empty,order:()=>empty,limit:()=>empty,gte:()=>empty,lt:()=>empty,lte:()=>empty,range:()=>empty,in:()=>empty,not:()=>empty,then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(resolve({data:[],error:null}))};return empty
  }
  let action = 'select'; let payload: CardioSession | undefined; const filters: [string, unknown][] = []
  const chain = {
    select() { return chain }, order() { return chain }, eq(name: string, value: unknown) { filters.push([name, value]); return chain },
    upsert(value: CardioSession) { action = 'upsert'; payload = value; return chain }, delete() { action = 'delete'; return chain },
    then(resolve: (result: unknown) => unknown) {
      if (!navigator.onLine) return Promise.resolve(resolve({ data: null, error: { message: 'Тест: офлайн' } }))
      let records: CardioSession[] = JSON.parse(localStorage.getItem('local-test:cardio') ?? '[]')
      if (action === 'upsert' && payload) records = [...records.filter((item) => item.id !== payload!.id), payload]
      if (action === 'delete') records = records.filter((item) => !filters.every(([name, value]) => item[name as keyof CardioSession] === value))
      if (action !== 'select') localStorage.setItem('local-test:cardio', JSON.stringify(records))
      return Promise.resolve(resolve({ data: records.filter((item) => filters.every(([name, value]) => item[name as keyof CardioSession] === value)), error: null }))
    },
  }; return chain
} }
