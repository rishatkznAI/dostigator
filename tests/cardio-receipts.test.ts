import {beforeEach,describe,expect,it} from 'vitest'
import {saveCardioReceipt,loadCardioReceipt,workoutCardio} from '../src/lib/cardio-receipts'
import {enqueueCardio,type CardioSession} from '../src/lib/cardio'
const session:CardioSession={id:'synthetic-cardio',user_id:'receipt-owner',activity_date:'2026-10-15',kind:'elliptical',duration_minutes:25,distance_km:null,effort:null,average_pulse:null,note:'',created_at:'2026-10-15T09:00:00Z',updated_at:'2026-10-15T09:00:00Z'}
describe('exact local cardio fact receipts',()=>{
 beforeEach(()=>localStorage.clear())
 it('keeps 25:17 and the explicit strength link separately from the integer-minute cloud queue, without duplicates',()=>{
  const receipt={durationSeconds:1517,workoutId:'strength-uuid',updatedAt:session.updated_at}
  saveCardioReceipt(session.user_id,session,receipt);enqueueCardio(session);enqueueCardio(session)
  expect(workoutCardio(session.user_id,'strength-uuid')).toHaveLength(1)
  expect(loadCardioReceipt(session.user_id,session)).toEqual(receipt)
  expect(loadCardioReceipt('other-owner',session)).toBeNull()
  expect(JSON.parse(localStorage.getItem('trainlog:cardio-queue:receipt-owner')!)[0]).not.toHaveProperty('durationSeconds')
 })
 it('preserves the prior exact receipt when a later edit cannot be committed, and never applies stale metadata to a remote edit',()=>{
  saveCardioReceipt(session.user_id,session,{durationSeconds:1517,workoutId:'strength',updatedAt:session.updated_at})
  const edited={...session,duration_minutes:26,updated_at:'2026-10-15T09:05:00Z'}
  saveCardioReceipt(session.user_id,edited,{durationSeconds:1562,workoutId:'strength',updatedAt:edited.updated_at})
  expect(loadCardioReceipt(session.user_id,session)?.durationSeconds).toBe(1517)
  expect(loadCardioReceipt(session.user_id,{...edited,updated_at:'2026-10-15T09:06:00Z'})).toBeNull()
 })
 it('rejects invented seconds, other owners and minute/second disagreement',()=>{
  for(const seconds of [NaN,59,1500.5,1560])expect(()=>saveCardioReceipt(session.user_id,session,{durationSeconds:seconds,workoutId:null,updatedAt:session.updated_at})).toThrow()
  expect(()=>saveCardioReceipt('other',session,{durationSeconds:1500,workoutId:null,updatedAt:session.updated_at})).toThrow()
 })
})

it('preserves exact seconds when PostgreSQL returns the same timestamp with a different timezone notation',()=>{
 localStorage.clear()
 saveCardioReceipt(session.user_id,session,{durationSeconds:1517,workoutId:'strength',updatedAt:session.updated_at})
 expect(loadCardioReceipt(session.user_id,{...session,updated_at:'2026-10-15T09:00:00+00:00'})?.durationSeconds).toBe(1517)
})
