import { useState } from 'react'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
const state=vi.hoisted(()=>({auth:{user:{id:'user-a'} as {id:string}|null,loading:false,sessionError:null as string|null,retrySession:vi.fn()}}))
vi.mock('./context/AuthContext',()=>({AuthProvider:({children}:any)=>children,useAuth:()=>state.auth}))
vi.mock('./context/DataContext',()=>({DataProvider:({children}:any)=>children}))
vi.mock('./context/OnboardingContext',()=>({OnboardingGate:({children}:any)=>children}))
vi.mock('./hooks/useSyncQueue',()=>({useSyncQueue:vi.fn()}))
vi.mock('./hooks/useCardioSync',()=>({useCardioSync:vi.fn()}))
vi.mock('./components/AppShell',async()=>{const {Outlet}=await import('react-router-dom');return {AppShell:()=> <Outlet/>}})
vi.mock('./pages/HomePage',()=>({HomePage:()=>{const [owner]=useState(()=>state.auth.user?.id);return <p>Mounted profile: {owner}</p>}}))
afterEach(()=>{cleanup();state.auth.user={id:'user-a'};state.auth.sessionError=null})
it('remounts protected page state when the account changes without logout',async()=>{
 const view=render(<App/>);expect(await screen.findByText('Mounted profile: user-a')).toBeInTheDocument()
 state.auth.user={id:'user-b'};view.rerender(<App/>);expect(await screen.findByText('Mounted profile: user-b')).toBeInTheDocument();expect(screen.queryByText('Mounted profile: user-a')).toBeNull()
})
it('shows a retry action instead of treating a failed session check as logout',async()=>{
 state.auth.user=null;state.auth.sessionError='Не удалось проверить сессию.'
 render(<App/>);expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить сессию.')
 fireEvent.click(screen.getByRole('button',{name:'Повторить проверку входа'}));expect(state.auth.retrySession).toHaveBeenCalledOnce()
})
