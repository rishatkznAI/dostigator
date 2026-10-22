import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { WorkoutPage } from '../../src/pages/WorkoutPage'
import { CardioPage } from '../../src/pages/CardioPage'
import { TrainingHistoryPage } from '../../src/pages/TrainingHistoryPage'
import { TrainingProgressPage } from '../../src/pages/TrainingProgressPage'
import { useSyncQueue } from '../../src/hooks/useSyncQueue'
import { useCardioSync } from '../../src/hooks/useCardioSync'
import { DataProvider } from '../../src/context/DataContext'
import { OnboardingGate } from '../../src/context/OnboardingContext'
import { AppShell } from '../../src/components/AppShell'
import { HomePage } from '../../src/pages/HomePage'
import { TrainingPage } from '../../src/pages/TrainingPage'
import { ProgressPage } from '../../src/pages/ProgressPage'
import { ReviewPage } from '../../src/pages/ReviewPage'
import { JournalPage } from '../../src/pages/JournalPage'
import { SettingsPage } from '../../src/pages/SettingsPage'
import { SpaPage } from '../../src/pages/SpaPage'
import { TrainingBodyPage } from '../../src/pages/TrainingBodyPage'
import { GoalPage } from '../../src/pages/GoalPage'
import { HistoryPage } from '../../src/pages/HistoryPage'
import { TrainingPlanPage } from '../../src/pages/TrainingPlanPage'
import { fixtureHistory, owner } from './fixtures'
import '../../src/styles.css'
import '../../src/training.css'
import './preview.css'
localStorage.setItem(`dostigator:onboarding:v1:${owner}`,'skipped')
Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => localStorage.getItem('local-test:online') === 'true' })
if (!localStorage.getItem(`trainlog:history-cache:${owner}`)) localStorage.setItem(`trainlog:history-cache:${owner}`, JSON.stringify(fixtureHistory))
if (!localStorage.getItem('local-test:seeded')) {
  const cardio = ['2026-10-09', '2026-10-02', '2026-09-25', '2026-09-18', '2026-09-11'].map((day, index) => ({ id: `cardio-fixture-${index}`, user_id: owner, activity_date: day, kind: 'elliptical', duration_minutes: 20 - index, distance_km: null, effort: null, average_pulse: null, note: '', created_at: `${day}T12:00:00Z`, updated_at: `${day}T12:00:00Z` }))
  localStorage.setItem(`trainlog:cardio:${owner}`, JSON.stringify(cardio)); localStorage.setItem('local-test:cardio', JSON.stringify(cardio)); localStorage.setItem('local-test:seeded', 'true')
}
function LocalSync() { useSyncQueue(owner); useCardioSync(owner); return null }
createRoot(document.getElementById('root')!).render(<BrowserRouter><LocalSync /><details className="preview-nav"><summary>Локальный тест · облако отключено · {navigator.onLine?'имитация сети':'офлайн'}</summary><div><Link to="/training">V2.1 · A/B/C</Link><Link to="/training/workout/A">A · 15 подходов</Link><Link to="/training/workout/B">B · 15 подходов</Link><Link to="/training/workout/C">C · по желанию</Link><Link to="/training/history">История</Link><button onClick={()=>{localStorage.setItem('local-test:online',String(!navigator.onLine));location.reload()}}>Сменить режим сети</button></div></details><DataProvider><OnboardingGate fallback={<p>Загрузка локальных данных…</p>}><Routes><Route path="/training/workout/:code" element={<div className="training-module"><WorkoutPage /></div>}/><Route element={<AppShell/>}><Route path="/" element={<HomePage/>}/><Route path="/training" element={<div className="training-module"><TrainingPage/></div>}/><Route path="/training/cardio" element={<div className="training-module"><CardioPage/></div>}/><Route path="/training/history" element={<div className="training-module"><TrainingHistoryPage/></div>}/><Route path="/training/progress" element={<div className="training-module"><TrainingProgressPage/></div>}/><Route path="/training/body" element={<div className="training-module"><TrainingBodyPage/></div>}/><Route path="/training/spa" element={<div className="training-module"><SpaPage/></div>}/><Route path="/goals/:goalId" element={<GoalPage/>}/><Route path="/history" element={<HistoryPage/>}/><Route path="/progress" element={<ProgressPage/>}/><Route path="/review" element={<ReviewPage/>}/><Route path="/journal" element={<JournalPage/>}/><Route path="/settings" element={<SettingsPage/>}/><Route path="/nutrition" element={<div className="training-module"><TrainingPlanPage/></div>}/></Route></Routes></OnboardingGate></DataProvider></BrowserRouter>)
