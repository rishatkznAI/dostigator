import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SetRecorder } from '../src/components/SetRecorder'
const set={id:'set',setNumber:1,weightKg:null,reps:null,rir:null,done:false,isWarmup:false,completedAt:null}
beforeEach(()=>localStorage.clear())
afterEach(cleanup)
function mount(key='pallof_press',timed=false) {
 const onRecord=vi.fn()
 render(<SetRecorder set={set} userId="test" exerciseName="Тест" exerciseKey={key} displayNumber={1} total={2} targetText="10–12 на сторону" timed={timed} onRecord={onRecord} onCancelEdit={()=>{}} onUndo={()=>{}} onSkip={()=>{}} />)
 return onRecord
}
it('does not display an empty kg fact, records cable resistance and optional RIR',()=>{
 const record=mount();const button=screen.getByRole('button',{name:'Записать подход 1 · Тест'})
 expect(button).toBeDisabled();expect(button).toHaveTextContent('Укажи сопротивление блока');expect(screen.queryByText(/— кг/)).toBeNull()
 fireEvent.change(screen.getByRole('spinbutton',{name:/вес кг/}),{target:{value:'7.5'}});fireEvent.click(button)
 expect(record).toHaveBeenCalledWith({weightKg:7.5,reps:10,rir:null})
})
it('rejects zero cable resistance without inventing a completed set',()=>{
 const record=mount();fireEvent.change(screen.getByRole('spinbutton',{name:/вес кг/}),{target:{value:'0'}})
 fireEvent.click(screen.getByRole('button',{name:'Записать подход 1 · Тест'}));expect(record).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('больше 0')
})
it('accepts a real zero additional load and labels it explicitly',()=>{
 const record=mount('leg_press');fireEvent.change(screen.getByRole('spinbutton',{name:/вес кг/}),{target:{value:'0'}})
 const button=screen.getByRole('button',{name:'Записать подход 1 · Тест'});expect(button).toHaveTextContent('0 кг × 10');fireEvent.click(button)
 expect(record).toHaveBeenCalledWith({weightKg:0,reps:10,rir:null})
})
it('records a timed bodyweight set without displaying kg',()=>{
 const record=mount('plank',true);const button=screen.getByRole('button',{name:'Записать подход 1 · Тест'});expect(button).toHaveTextContent('10 сек');fireEvent.click(button)
 expect(record).toHaveBeenCalledWith({weightKg:0,reps:10,rir:null})
})
it('rejects fractional reps without recording a fact',()=>{
 const record=mount();fireEvent.change(screen.getByRole('spinbutton',{name:/вес кг/}),{target:{value:'5'}});fireEvent.change(screen.getByRole('spinbutton',{name:/повторы/}),{target:{value:'10.5'}})
 fireEvent.click(screen.getByRole('button',{name:'Записать подход 1 · Тест'}));expect(record).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeTruthy()
})
