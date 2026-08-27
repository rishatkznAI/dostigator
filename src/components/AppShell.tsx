import { BarChart3, CheckSquare, CircleUserRound, Home, Target } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useData } from '../context/DataContext'

const navigation = [
  { to: '/', label: 'Сегодня', icon: Home },
  { to: '/goals', label: 'Цели', icon: Target },
  { to: '/habits', label: 'Привычки', icon: CheckSquare },
  { to: '/review', label: 'Обзор', icon: BarChart3 },
  { to: '/settings', label: 'Профиль', icon: CircleUserRound },
]

export function AppShell() {
  const { pending, error } = useData()
  return (
    <div className="app-frame">
      {(pending > 0 || error) && <div className={`sync-banner ${error ? 'error' : ''}`} role="status">
        {error ? `Работаем с сохранёнными данными · ${error}` : `Ожидают синхронизации: ${pending}`}
      </div>}
      <main className="app-main"><Outlet /></main>
      <nav className="bottom-nav" aria-label="Основная навигация">
        {navigation.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}><Icon /><span>{label}</span></NavLink>
        ))}
      </nav>
    </div>
  )
}
