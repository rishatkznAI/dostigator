import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { DataProvider } from './context/DataContext'
import { OnboardingGate } from './context/OnboardingContext'
import { AppShell } from './components/AppShell'
import { useSyncQueue } from './hooks/useSyncQueue'

const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })))
const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })))
const ProgressPage = lazy(() => import('./pages/ProgressPage').then((module) => ({ default: module.ProgressPage })))
const GoalPage = lazy(() => import('./pages/GoalPage').then((module) => ({ default: module.GoalPage })))
const TrainingPage = lazy(() => import('./pages/TrainingPage').then((module) => ({ default: module.TrainingPage })))
const CardioPage = lazy(() => import('./pages/CardioPage').then((module) => ({ default: module.CardioPage })))
const SpaPage = lazy(() => import('./pages/SpaPage').then((module) => ({ default: module.SpaPage })))
const WorkoutPage = lazy(() => import('./pages/WorkoutPage').then((module) => ({ default: module.WorkoutPage })))
const TrainingHistoryPage = lazy(() => import('./pages/TrainingHistoryPage').then((module) => ({ default: module.TrainingHistoryPage })))
const TrainingProgressPage = lazy(() => import('./pages/TrainingProgressPage').then((module) => ({ default: module.TrainingProgressPage })))
const TrainingBodyPage = lazy(() => import('./pages/TrainingBodyPage').then((module) => ({ default: module.TrainingBodyPage })))
const TrainingPlanPage = lazy(() => import('./pages/TrainingPlanPage').then((module) => ({ default: module.TrainingPlanPage })))
const ReviewPage = lazy(() => import('./pages/ReviewPage').then((module) => ({ default: module.ReviewPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((module) => ({ default: module.HistoryPage })))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then((module) => ({ default: module.OnboardingPage })))

function LoadingScreen() {
  return <div className="loading-screen" role="status" aria-live="polite" aria-atomic="true" aria-busy="true"><span aria-hidden="true">Д</span><p>Собираем следующий шаг…</p></div>
}

function ProtectedApp() {
  const { user, loading } = useAuth()
  useSyncQueue(user?.id)
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  return <DataProvider><OnboardingGate fallback={<LoadingScreen />}><Outlet /></OnboardingGate></DataProvider>
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (user) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route element={<ProtectedApp />}>
              <Route element={<AppShell />}>
                <Route path="onboarding" element={<OnboardingPage />} />
                <Route index element={<HomePage />} />
                <Route path="progress" element={<ProgressPage />} />
                <Route path="goals" element={<Navigate to="/progress" replace />} />
                <Route path="goals/:goalId" element={<GoalPage />} />
                <Route path="habits" element={<Navigate to="/progress?tab=habits" replace />} />
                <Route path="training" element={<div className="training-module"><TrainingPage /></div>} />
                <Route path="training/cardio" element={<div className="training-module"><CardioPage /></div>} />
                <Route path="training/spa" element={<div className="training-module"><SpaPage /></div>} />
                <Route path="nutrition" element={<div className="training-module"><TrainingPlanPage /></div>} />
                <Route path="training/history" element={<div className="training-module"><TrainingHistoryPage /></div>} />
                <Route path="training/progress" element={<div className="training-module"><TrainingProgressPage /></div>} />
                <Route path="training/body" element={<div className="training-module"><TrainingBodyPage /></div>} />
                <Route path="training/nutrition" element={<Navigate to="/nutrition" replace />} />
                <Route path="workouts" element={<Navigate to="/training" replace />} />
                <Route path="review" element={<ReviewPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="history" element={<HistoryPage />} />
              </Route>
              <Route path="training/workout/:code" element={<div className="training-module"><WorkoutPage /></div>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
